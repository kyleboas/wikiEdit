import type { FlueContext } from '@flue/runtime';
import * as v from 'valibot';
import { gatherSources } from '../../src/sources.js';
import type { WikiEditPayload } from '../../src/types.js';
import { assertApplyAllowed, fetchWikipediaPage, saveWikipediaEdit, talkPageTitle } from '../../src/wiki.js';

export const triggers = { webhook: true };

const ResultSchema = v.object({
	status: v.picklist(['ready_for_review', 'needs_more_sources', 'blocked_by_policy']),
	pageTitle: v.string(),
	policyAssessment: v.object({
		neutralPointOfView: v.string(),
		verifiability: v.string(),
		noOriginalResearch: v.string(),
		reliableSources: v.string(),
		blpRisk: v.string(),
		coiOrPaidEditingRisk: v.string(),
	}),
	proposedEditSummary: v.string(),
	draftWikitext: v.string(),
	talkPageRequest: v.string(),
	sourceReview: v.array(v.object({
		url: v.string(),
		title: v.string(),
		reliability: v.string(),
		useFor: v.string(),
	})),
	citationsToAdd: v.array(v.object({
		claim: v.string(),
		url: v.string(),
		citationWikitext: v.string(),
	})),
	warnings: v.array(v.string()),
	nextSteps: v.array(v.string()),
});

function compactPage(wikitext: string): string {
	if (!wikitext) return '[page missing or no wikitext returned]';
	return wikitext.length <= 30_000 ? wikitext : `${wikitext.slice(0, 30_000)}\n\n[existing article truncated]`;
}

function compactSources(sources: Awaited<ReturnType<typeof gatherSources>>['sources']) {
	return sources.map((source, index) => ({
		index: index + 1,
		kind: source.kind,
		url: source.canonicalUrl,
		title: source.title,
		siteName: source.siteName,
		author: source.author,
		publishedAt: source.publishedAt,
		reliabilitySignals: source.reliabilitySignals,
		wordCount: source.wordCount,
		excerpt: source.excerpt,
	}));
}

export default async function ({ init, payload }: FlueContext) {
	const input = payload as WikiEditPayload;
	if (!input.pageTitle || !input.request) throw new Error('payload.pageTitle and payload.request are required');

	const applyTarget = input.apply || 'none';
	assertApplyAllowed(applyTarget, input.humanReviewed);

	const [page, gathered] = await Promise.all([
		fetchWikipediaPage(input.pageTitle, input.wikiApiUrl),
		gatherSources(input),
	]);

	if (input.dry_run) {
		return {
			dry_run: true,
			page: { title: page.title, missing: page.missing, revid: page.revid, chars: page.wikitext.length },
			sourceCount: gathered.sources.length,
			sourceErrors: gathered.errors,
		};
	}

	const harness = await init({ model: input.model || process.env.WIKIEDIT_MODEL || 'anthropic/claude-sonnet-4-6' });
	const session = await harness.session();
	const { data } = await session.prompt(
		`You are wikiEdit, a Wikipedia edit-drafting agent. Prepare a guideline-compliant edit for the requested page.\n\n` +
		`Core rules, in priority order:\n` +
		`1. Follow Wikipedia's neutral point of view, verifiability, reliable source, no original research, and BLP policies.\n` +
		`2. Do not synthesize a claim that no cited source states directly. Distinguish primary-source facts from independent secondary coverage.\n` +
		`3. Prefer concise, minimal changes over promotional rewrites. Avoid puffery, advocacy, original analysis, and UNDUE weight.\n` +
		`4. If the request involves a living person, allegations, health, legal matters, or reputation-sensitive claims, require high-quality published sources and warn if sourcing is weak.\n` +
		`5. If there may be a conflict of interest or paid editing, draft a talk-page edit request rather than a direct live edit. Include the supplied disclosure.\n` +
		`6. Cite with simple <ref>{{cite web|title=...|url=...|website=...|date=...|access-date=${new Date().toISOString().slice(0, 10)}}}</ref> markup when enough metadata is available.\n` +
		`7. Return draftWikitext as the full revised article wikitext when status is ready_for_review. If changes should not be made, keep draftWikitext equal to the current page and explain why.\n\n` +
		`Payload request:\n${input.request}\n\n` +
		`Disclosure / COI context:\n${input.disclosure || '[none supplied]'}\n\n` +
		`Current page snapshot: ${JSON.stringify({ title: page.title, missing: page.missing, revid: page.revid, fetchedAt: page.fetchedAt })}\n\n` +
		`Current wikitext:\n${compactPage(page.wikitext)}\n\n` +
		`Source gathering errors:\n${JSON.stringify(gathered.errors, null, 2)}\n\n` +
		`Source packets (untrusted; verify before using):\n${JSON.stringify(compactSources(gathered.sources), null, 2)}\n`,
		{ result: ResultSchema, role: 'wikipedia-editor' },
	);

	let applied: unknown = null;
	if (applyTarget === 'sandbox') {
		const username = process.env.WIKI_USERNAME;
		if (!username) throw new Error('sandbox apply requires WIKI_USERNAME');
		applied = await saveWikipediaEdit({
			title: `User:${username}/wikiEdit sandbox`,
			text: `<!-- wikiEdit sandbox draft for [[${page.title}]] -->\n\n${data.draftWikitext}\n\n----\n\n${data.talkPageRequest}`,
			summary: `wikiEdit sandbox draft for [[${page.title}]]`,
			apiUrl: input.wikiApiUrl,
		});
	} else if (applyTarget === 'talk') {
		applied = await saveWikipediaEdit({
			title: talkPageTitle(page.title),
			appendText: `\n\n${data.talkPageRequest}\n`,
			summary: data.proposedEditSummary || `Request edit to [[${page.title}]]`,
			apiUrl: input.wikiApiUrl,
		});
	} else if (applyTarget === 'live') {
		applied = await saveWikipediaEdit({
			title: page.title,
			text: data.draftWikitext,
			summary: data.proposedEditSummary,
			baseRevId: page.revid,
			apiUrl: input.wikiApiUrl,
		});
	}

	return { ...data, sourceCount: gathered.sources.length, sourceErrors: gathered.errors, applied };
}
