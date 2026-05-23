import type { ApplyTarget, WikipediaPageSnapshot } from './types.js';

const DEFAULT_API_URL = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'wikiEdit/0.1 (+https://github.com/kyleboas/wikiEdit; Wikipedia-compliant edit assistant)';

class CookieJar {
	private cookies = new Map<string, string>();

	store(headers: Headers): void {
		// Node's fetch exposes combined set-cookie on some versions and getSetCookie on newer undici.
		const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
		const values = getSetCookie ? getSetCookie.call(headers) : [headers.get('set-cookie') || ''];
		for (const value of values) {
			for (const rawCookie of String(value || '').split(/,(?=[^;,]+=)/)) {
				const [pair] = rawCookie.split(';');
				const eq = pair.indexOf('=');
				if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
			}
		}
	}

	header(): string {
		return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
	}
}

function apiUrl(raw?: string): string {
	return String(raw || process.env.WIKI_API_URL || DEFAULT_API_URL);
}

async function getJson<T>(api: string, params: Record<string, string>, jar?: CookieJar): Promise<T> {
	const url = new URL(api);
	for (const [key, value] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value);
	const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...(jar ? { cookie: jar.header() } : {}) } });
	jar?.store(response.headers);
	if (!response.ok) throw new Error(`wiki_get_http_${response.status}`);
	return (await response.json()) as T;
}

async function postJson<T>(api: string, body: Record<string, string>, jar: CookieJar): Promise<T> {
	const response = await fetch(api, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'user-agent': USER_AGENT,
			cookie: jar.header(),
		},
		body: new URLSearchParams({ format: 'json', formatversion: '2', ...body }).toString(),
	});
	jar.store(response.headers);
	if (!response.ok) throw new Error(`wiki_post_http_${response.status}`);
	return (await response.json()) as T;
}

export async function fetchWikipediaPage(title: string, rawApiUrl?: string): Promise<WikipediaPageSnapshot> {
	const api = apiUrl(rawApiUrl);
	const json = await getJson<{
		query?: { pages?: Array<{ title: string; pageid?: number; missing?: boolean; revisions?: Array<{ revid?: number; content?: string; slots?: { main?: { content?: string } } }> }> };
	}>(api, {
		action: 'query',
		prop: 'revisions',
		titles: title,
		rvprop: 'ids|content',
		rvslots: 'main',
	});
	const page = json.query?.pages?.[0];
	const revision = page?.revisions?.[0];
	return {
		title: page?.title || title,
		pageId: page?.pageid,
		missing: Boolean(page?.missing),
		wikitext: revision?.slots?.main?.content || revision?.content || '',
		revid: revision?.revid,
		fetchedAt: new Date().toISOString(),
	};
}

async function login(api: string): Promise<CookieJar> {
	const username = process.env.WIKI_USERNAME;
	const password = process.env.WIKI_BOT_PASSWORD || process.env.WIKI_PASSWORD;
	if (!username || !password) throw new Error('wiki credentials missing: set WIKI_USERNAME and WIKI_BOT_PASSWORD');
	const jar = new CookieJar();
	const tokenResponse = await getJson<{ query?: { tokens?: { logintoken?: string } } }>(api, {
		action: 'query',
		meta: 'tokens',
		type: 'login',
	}, jar);
	const loginToken = tokenResponse.query?.tokens?.logintoken;
	if (!loginToken) throw new Error('wiki login token missing');
	const loginResponse = await postJson<{ login?: { result?: string; reason?: string } }>(api, {
		action: 'login',
		lgname: username,
		lgpassword: password,
		lgtoken: loginToken,
	}, jar);
	if (loginResponse.login?.result !== 'Success') throw new Error(`wiki login failed: ${loginResponse.login?.reason || loginResponse.login?.result}`);
	return jar;
}

async function getCsrfToken(api: string, jar: CookieJar): Promise<string> {
	const json = await getJson<{ query?: { tokens?: { csrftoken?: string } } }>(api, { action: 'query', meta: 'tokens' }, jar);
	const token = json.query?.tokens?.csrftoken;
	if (!token) throw new Error('wiki csrf token missing');
	return token;
}

export function talkPageTitle(title: string): string {
	if (title.startsWith('Talk:')) return title;
	if (title.includes(':')) {
		const [namespace, rest] = title.split(/:(.*)/s);
		return `${namespace} talk:${rest}`;
	}
	return `Talk:${title}`;
}

export async function saveWikipediaEdit(input: {
	title: string;
	text?: string;
	appendText?: string;
	summary: string;
	baseRevId?: number;
	apiUrl?: string;
}): Promise<{ title: string; result: string; oldRevId?: number; newRevId?: number }>{
	const api = apiUrl(input.apiUrl);
	const jar = await login(api);
	const token = await getCsrfToken(api, jar);
	const body: Record<string, string> = {
		action: 'edit',
		title: input.title,
		summary: input.summary,
		token,
		nocreate: '0',
	};
	if (input.text !== undefined) body.text = input.text;
	if (input.appendText !== undefined) body.appendtext = input.appendText;
	if (input.baseRevId) body.baserevid = String(input.baseRevId);
	const json = await postJson<{ edit?: { result?: string; oldrevid?: number; newrevid?: number } }>(api, body, jar);
	if (json.edit?.result !== 'Success') throw new Error(`wiki edit failed: ${JSON.stringify(json)}`);
	return { title: input.title, result: json.edit.result, oldRevId: json.edit.oldrevid, newRevId: json.edit.newrevid };
}

export function assertApplyAllowed(target: ApplyTarget, humanReviewed?: boolean): void {
	if (target === 'none') return;
	if (target === 'live') {
		if (process.env.WIKI_ALLOW_LIVE_EDIT !== 'true') throw new Error('live edits disabled: set WIKI_ALLOW_LIVE_EDIT=true');
		if (!humanReviewed) throw new Error('live edits require payload.humanReviewed=true');
	}
}
