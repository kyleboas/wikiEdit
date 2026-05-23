import { gatherSources } from '../src/sources.js';
import { assertApplyAllowed, talkPageTitle } from '../src/wiki.js';

const result = await gatherSources({
	manualNotes: ['Smoke test note. This is orientation only and should not be treated as a citation.'],
	maxItems: 1,
});

if (result.sources.length !== 1) throw new Error('expected one manual source packet');
assertApplyAllowed('none');

console.log(JSON.stringify({ ok: true, sourceCount: result.sources.length, talkPage: talkPageTitle('Wikipedia') }, null, 2));
