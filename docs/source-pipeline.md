# Source pipeline

wikiEdit borrows the useful parts of the Tactics Journal research pipeline without bringing over its database/report stack.

## Inputs

Payload fields:

- `sourceUrls`: article URLs to fetch and extract.
- `feedUrls`: RSS/Atom feeds; feed items are treated as discovery and then full article pages are fetched when possible.
- `youtubeUrls`: optional YouTube transcript URLs via the same Dynamic Workers-style `/youtube-transcript` gateway used by the research pipeline.
- `manualNotes`: orientation only; never treated as citation-ready evidence.

## Extraction cascade

1. Validate public HTTP(S) URL and block localhost, private IPs, `.local`, `.internal`, embedded credentials, and private DNS resolutions.
2. Fetch with a browser-like user agent and manual redirect validation.
3. Extract article text with Mozilla Readability.
4. Fall back to HTML text stripping or RSS summary text.
5. Strip common cookie/newsletter boilerplate and flag paywall-like text.
6. Build compact source packets for the Flue agent: title, site, author, date, reliability signals, word count, excerpt, and URL.

## Reliability classification

The deterministic classifier is intentionally conservative. It only emits rough signals such as `peer_reviewed`, `major_newsroom`, `primary_source`, `self_published`, `user_generated`, or `unknown`. The Flue agent must still decide whether a source is appropriate for the exact Wikipedia claim.
