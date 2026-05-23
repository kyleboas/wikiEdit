import { Readability } from '@mozilla/readability';
import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';
import { lookup } from 'node:dns/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ReliabilitySignal, SourceGatherInput, SourceGatherResult, SourcePacket } from './types.js';

const USER_AGENT = 'wikiEdit/0.1 (+https://github.com/kyleboas/wikiEdit; source research assistant)';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ITEMS = 12;
const DEFAULT_MAX_CHARS_PER_SOURCE = 24_000;

const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'localhost.localdomain',
	'host.docker.internal',
	'metadata.google.internal',
]);

const PAYWALL_SIGNALS = [
	'subscribe to continue',
	'subscribe to read',
	'sign in to read',
	'this article is for subscribers',
	'members only',
	'premium content',
	'unlock this article',
];

const BOILERPLATE_LINE_PATTERNS = [
	/we use cookies/i,
	/accept all cookies/i,
	/manage your cookie settings/i,
	/sign up for our newsletter/i,
	/get .* delivered to your inbox/i,
];

function isPrivateIPv4(ip: string): boolean {
	const parts = ip.split('.').map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a, b] = parts;
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		a === 0 ||
		a >= 224
	);
}

function isPrivateIPv6(ip: string): boolean {
	const normalized = ip.toLowerCase();
	return (
		normalized === '::1' ||
		normalized === '::' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe80:') ||
		normalized.startsWith('ff')
	);
}

function isPrivateIp(ip: string): boolean {
	return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

export async function validatePublicHttpUrl(rawUrl: string, label = 'url'): Promise<string> {
	const cleaned = String(rawUrl || '').trim();
	let parsed: URL;
	try {
		parsed = new URL(cleaned);
	} catch (error) {
		throw new Error(`${label}: invalid_url`);
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label}: unsupported_url_scheme`);
	if (!parsed.hostname) throw new Error(`${label}: missing_hostname`);
	if (parsed.username || parsed.password) throw new Error(`${label}: embedded_credentials_not_allowed`);
	const host = parsed.hostname.toLowerCase();
	if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
		throw new Error(`${label}: private_hostname_not_allowed`);
	}
	if (isPrivateIp(host)) throw new Error(`${label}: private_ip_not_allowed`);
	const records = await lookup(host, { all: true, verbatim: true });
	if (records.some((record) => isPrivateIp(record.address))) {
		throw new Error(`${label}: private_resolved_ip_not_allowed`);
	}
	return parsed.toString();
}

async function fetchText(url: string, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'): Promise<string> {
	let currentUrl = await validatePublicHttpUrl(url, 'fetch');
	for (let redirect = 0; redirect < 5; redirect += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
		try {
			const response = await fetch(currentUrl, {
				headers: { accept, 'user-agent': USER_AGENT },
				redirect: 'manual',
				signal: controller.signal,
			});
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				const location = response.headers.get('location');
				if (!location) throw new Error(`redirect_without_location:${response.status}`);
				currentUrl = await validatePublicHttpUrl(new URL(location, currentUrl).toString(), 'redirect');
				continue;
			}
			if (!response.ok) throw new Error(`http_${response.status}`);
			return await response.text();
		} finally {
			clearTimeout(timeout);
		}
	}
	throw new Error('too_many_redirects');
}

function cleanText(text: string): string {
	const withoutBoilerplate = text
		.split('\n')
		.filter((line) => !BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line.trim())))
		.join('\n');
	return withoutBoilerplate.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function hasPaywallSignals(text: string): boolean {
	const lower = text.toLowerCase();
	return PAYWALL_SIGNALS.some((signal) => lower.includes(signal));
}

function classifyReliability(url: string, siteName = ''): ReliabilitySignal[] {
	const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	const haystack = `${host} ${siteName}`.toLowerCase();
	const signals: ReliabilitySignal[] = [];
	if (/\.edu$|\.gov$|\.ac\.|pubmed|doi\.org|jstor|springer|sciencedirect|nature\.com|tandfonline|sagepub|wiley/.test(haystack)) {
		signals.push('peer_reviewed');
	}
	if (/reuters|apnews|bbc|nytimes|washingtonpost|guardian|ft\.com|economist|npr|pbs|wsj/.test(haystack)) {
		signals.push('major_newsroom');
	}
	if (/official|press-release|investor|sec\.gov|company|university|museum|library/.test(haystack)) {
		signals.push('primary_source');
	}
	if (/medium\.com|substack\.com|wordpress\.com|blogspot\.com|youtube\.com|youtu\.be/.test(haystack)) {
		signals.push('self_published');
	}
	if (/reddit|quora|wikia|fandom|x\.com|twitter\.com|facebook/.test(haystack)) {
		signals.push('user_generated');
	}
	if (signals.length === 0) signals.push('unknown');
	return signals;
}

function truncate(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, maxChars).trim()}\n\n[truncated]`;
}

function textFromHtml(html: string, url: string): { text: string; title: string; siteName?: string; byline?: string; method: string } {
	const dom = new JSDOM(html, { url });
	const reader = new Readability(dom.window.document);
	const article = reader.parse();
	if (article?.textContent && article.textContent.trim().length > 300 && !hasPaywallSignals(article.textContent)) {
		return {
			text: cleanText(article.textContent),
			title: article.title || dom.window.document.title || url,
			siteName: article.siteName || undefined,
			byline: article.byline || undefined,
			method: 'readability',
		};
	}
	const text = cleanText(dom.window.document.body?.textContent || '');
	return { text, title: dom.window.document.title || url, method: 'html_strip' };
}

export async function extractArticle(url: string, options: { maxChars?: number } = {}): Promise<SourcePacket> {
	const canonicalUrl = await validatePublicHttpUrl(url, 'article');
	const html = await fetchText(canonicalUrl);
	const extracted = textFromHtml(html, canonicalUrl);
	const text = truncate(extracted.text, options.maxChars ?? DEFAULT_MAX_CHARS_PER_SOURCE);
	const wordCount = text.split(/\s+/).filter(Boolean).length;
	return {
		kind: 'article',
		url,
		canonicalUrl,
		title: extracted.title,
		siteName: extracted.siteName,
		author: extracted.byline,
		extractedAt: new Date().toISOString(),
		extractionMethod: extracted.method,
		reliabilitySignals: classifyReliability(canonicalUrl, extracted.siteName),
		wordCount,
		excerpt: truncate(text, 4_000),
		fullText: text,
	};
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

function asArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function pickText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && '#text' in value) return String((value as Record<string, unknown>)['#text'] || '');
	return '';
}

function stripTags(value: string): string {
	return cleanText(value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '));
}

async function extractRssFeed(feedUrl: string, maxItems: number, maxCharsPerSource: number): Promise<SourcePacket[]> {
	const canonicalFeed = await validatePublicHttpUrl(feedUrl, 'feed');
	const xml = await fetchText(canonicalFeed, 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8');
	const parsed = parser.parse(xml) as any;
	const channel = parsed?.rss?.channel;
	const rssItems = asArray<Record<string, unknown>>(channel?.item).map((item) => ({
		title: pickText(item.title) || 'Untitled RSS item',
		url: pickText(item.link) || pickText(item.guid),
		publishedAt: pickText(item.pubDate),
		fallback: stripTags(pickText(item['content:encoded']) || pickText(item.description)),
		siteName: pickText(channel?.title),
	}));
	const atomItems = asArray<Record<string, unknown>>(parsed?.feed?.entry).map((entry) => {
		const links = asArray<Record<string, unknown>>((entry as any).link);
		const href = links.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href'];
		return {
			title: pickText(entry.title) || 'Untitled Atom item',
			url: String(href || ''),
			publishedAt: pickText(entry.published) || pickText(entry.updated),
			fallback: stripTags(pickText(entry.content) || pickText(entry.summary)),
			siteName: pickText(parsed?.feed?.title),
		};
	});
	const packets: SourcePacket[] = [];
	for (const item of [...rssItems, ...atomItems].slice(0, maxItems)) {
		if (!item.url) continue;
		try {
			const packet = await extractArticle(new URL(item.url, canonicalFeed).toString(), { maxChars: maxCharsPerSource });
			packet.kind = 'rss_item';
			packet.title = packet.title || item.title;
			packet.siteName = packet.siteName || item.siteName;
			packet.publishedAt = packet.publishedAt || item.publishedAt;
			if (packet.wordCount < 120 && item.fallback) {
				packet.excerpt = truncate(item.fallback, 4_000);
				packet.fullText = truncate(item.fallback, maxCharsPerSource);
				packet.wordCount = item.fallback.split(/\s+/).filter(Boolean).length;
				packet.extractionMethod = 'rss_fallback';
			}
			packets.push(packet);
			await sleep(250);
		} catch {
			const canonicalUrl = await validatePublicHttpUrl(new URL(item.url, canonicalFeed).toString(), 'rss_item');
			const text = truncate(item.fallback, maxCharsPerSource);
			packets.push({
				kind: 'rss_item',
				url: item.url,
				canonicalUrl,
				title: item.title,
				siteName: item.siteName,
				publishedAt: item.publishedAt,
				extractedAt: new Date().toISOString(),
				extractionMethod: 'rss_fallback',
				reliabilitySignals: classifyReliability(canonicalUrl, item.siteName),
				wordCount: text.split(/\s+/).filter(Boolean).length,
				excerpt: truncate(text, 4_000),
				fullText: text,
			});
		}
	}
	return packets;
}

function youtubeVideoId(rawUrl: string): string | null {
	try {
		const url = new URL(rawUrl);
		if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || null;
		if (url.hostname.includes('youtube.com')) return url.searchParams.get('v') || url.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || null;
	} catch {
		return null;
	}
	return null;
}

async function fetchYoutubeTranscript(rawUrl: string, maxChars: number): Promise<SourcePacket> {
	const canonicalUrl = await validatePublicHttpUrl(rawUrl, 'youtube');
	const videoId = youtubeVideoId(canonicalUrl);
	if (!videoId) throw new Error('youtube: missing_video_id');
	const host = process.env.DYNAMIC_WORKERS_HOST;
	const secret = process.env.DYNAMIC_WORKERS_SECRET || process.env.TRANSCRIPT_API_KEY;
	if (!host || !secret) throw new Error('youtube: DYNAMIC_WORKERS_HOST and secret not configured');
	const endpoint = new URL('/youtube-transcript', host).toString();
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}`, 'user-agent': USER_AGENT },
		body: JSON.stringify({ video_id: videoId }),
	});
	if (!response.ok) throw new Error(`youtube_transcript_http_${response.status}`);
	const json = (await response.json()) as { transcript?: string; text?: string; title?: string };
	const transcript = truncate(cleanText(json.transcript || json.text || ''), maxChars);
	return {
		kind: 'youtube_transcript',
		url: rawUrl,
		canonicalUrl,
		title: json.title || `YouTube transcript ${videoId}`,
		extractedAt: new Date().toISOString(),
		extractionMethod: 'dynamic_worker_youtube_transcript',
		reliabilitySignals: ['self_published'],
		wordCount: transcript.split(/\s+/).filter(Boolean).length,
		excerpt: truncate(transcript, 4_000),
		fullText: transcript,
	};
}

export async function gatherSources(input: SourceGatherInput): Promise<SourceGatherResult> {
	const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS;
	const maxCharsPerSource = input.maxCharsPerSource ?? DEFAULT_MAX_CHARS_PER_SOURCE;
	const sources: SourcePacket[] = [];
	const errors: Array<{ url: string; error: string }> = [];
	const seen = new Set<string>();

	const addPackets = (packets: SourcePacket[]) => {
		for (const packet of packets) {
			const key = packet.canonicalUrl.toLowerCase();
			if (seen.has(key) || sources.length >= maxItems) continue;
			seen.add(key);
			sources.push(packet);
		}
	};

	for (const note of input.manualNotes || []) {
		const text = truncate(cleanText(note), maxCharsPerSource);
		if (!text) continue;
		const canonicalUrl = `manual-note:${sources.length + 1}`;
		addPackets([
			{
				kind: 'manual_note',
				url: canonicalUrl,
				canonicalUrl,
				title: `Manual note ${sources.length + 1}`,
				extractedAt: new Date().toISOString(),
				extractionMethod: 'payload_manual_note',
				reliabilitySignals: ['unknown'],
				wordCount: text.split(/\s+/).filter(Boolean).length,
				excerpt: truncate(text, 4_000),
				fullText: text,
			},
		]);
	}

	for (const feedUrl of input.feedUrls || []) {
		if (sources.length >= maxItems) break;
		try {
			addPackets(await extractRssFeed(feedUrl, maxItems - sources.length, maxCharsPerSource));
		} catch (error) {
			errors.push({ url: feedUrl, error: error instanceof Error ? error.message : String(error) });
		}
	}

	for (const sourceUrl of input.sourceUrls || []) {
		if (sources.length >= maxItems) break;
		try {
			addPackets([await extractArticle(sourceUrl, { maxChars: maxCharsPerSource })]);
		} catch (error) {
			errors.push({ url: sourceUrl, error: error instanceof Error ? error.message : String(error) });
		}
	}

	for (const youtubeUrl of input.youtubeUrls || []) {
		if (sources.length >= maxItems) break;
		try {
			addPackets([await fetchYoutubeTranscript(youtubeUrl, maxCharsPerSource)]);
		} catch (error) {
			errors.push({ url: youtubeUrl, error: error instanceof Error ? error.message : String(error) });
		}
	}

	return { sources, errors };
}
