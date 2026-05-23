import { describe, expect, it } from 'vitest';
import { gatherSources, validatePublicHttpUrl } from '../src/sources.js';

describe('source safety', () => {
	it('blocks localhost URLs before fetching', async () => {
		await expect(validatePublicHttpUrl('http://localhost:8000/private')).rejects.toThrow(/private_hostname/);
	});

	it('blocks private IP URLs before fetching', async () => {
		await expect(validatePublicHttpUrl('http://127.0.0.1/private')).rejects.toThrow(/private_ip/);
	});

	it('accepts manual notes as non-citable source packets', async () => {
		const result = await gatherSources({ manualNotes: ['A note for orientation, not a citation.'] });
		expect(result.errors).toEqual([]);
		expect(result.sources).toHaveLength(1);
		expect(result.sources[0].kind).toBe('manual_note');
		expect(result.sources[0].reliabilitySignals).toContain('unknown');
	});
});
