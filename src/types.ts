export type SourceKind = 'article' | 'rss_item' | 'youtube_transcript' | 'manual_note';

export type ReliabilitySignal =
	| 'peer_reviewed'
	| 'major_newsroom'
	| 'specialist_publication'
	| 'primary_source'
	| 'self_published'
	| 'user_generated'
	| 'unknown';

export interface SourcePacket {
	kind: SourceKind;
	url: string;
	canonicalUrl: string;
	title: string;
	siteName?: string;
	author?: string;
	publishedAt?: string;
	extractedAt: string;
	extractionMethod: string;
	reliabilitySignals: ReliabilitySignal[];
	wordCount: number;
	excerpt: string;
	fullText?: string;
}

export interface SourceGatherInput {
	sourceUrls?: string[];
	feedUrls?: string[];
	youtubeUrls?: string[];
	manualNotes?: string[];
	maxItems?: number;
	maxCharsPerSource?: number;
}

export interface SourceGatherResult {
	sources: SourcePacket[];
	errors: Array<{ url: string; error: string }>;
}

export interface WikipediaPageSnapshot {
	title: string;
	pageId?: number;
	missing: boolean;
	wikitext: string;
	revid?: number;
	fetchedAt: string;
}

export type ApplyTarget = 'none' | 'sandbox' | 'talk' | 'live';

export interface WikiEditPayload extends SourceGatherInput {
	pageTitle: string;
	request: string;
	language?: string;
	wikiApiUrl?: string;
	apply?: ApplyTarget;
	humanReviewed?: boolean;
	disclosure?: string;
	dry_run?: boolean;
	model?: string;
}
