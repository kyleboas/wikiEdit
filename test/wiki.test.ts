import { describe, expect, it } from 'vitest';
import { assertApplyAllowed, talkPageTitle } from '../src/wiki.js';

describe('wiki safeguards', () => {
	it('maps article titles to talk pages', () => {
		expect(talkPageTitle('Ada Lovelace')).toBe('Talk:Ada Lovelace');
		expect(talkPageTitle('User:Example')).toBe('User talk:Example');
	});

	it('requires an explicit environment gate for live edits', () => {
		const old = process.env.WIKI_ALLOW_LIVE_EDIT;
		delete process.env.WIKI_ALLOW_LIVE_EDIT;
		expect(() => assertApplyAllowed('live', true)).toThrow(/disabled/);
		process.env.WIKI_ALLOW_LIVE_EDIT = 'true';
		expect(() => assertApplyAllowed('live', false)).toThrow(/humanReviewed/);
		if (old === undefined) delete process.env.WIKI_ALLOW_LIVE_EDIT;
		else process.env.WIKI_ALLOW_LIVE_EDIT = old;
	});
});
