# wikiEdit

Private Flue agent for drafting Wikipedia edits with source-aware, guideline-first workflow.

wikiEdit can pull article/RSS/YouTube-transcript sources, fetch the current Wikipedia wikitext, and produce:

- a policy assessment,
- a source reliability review,
- a full revised wikitext draft,
- citation markup,
- a talk-page edit request,
- optional guarded writes to a sandbox or talk page.

Live article edits are disabled by default.

## Setup

```bash
make install
cp .env.example .env
make test
make typecheck
make smoke
```

## Dry run

```bash
npm run flue:dry
```

## Run the agent

```bash
pnpm exec flue run wiki-edit --target node --id ada-edit --payload '{
  "pageTitle": "Ada Lovelace",
  "request": "Improve the lead only if the sources directly support the wording.",
  "sourceUrls": ["https://www.britannica.com/biography/Ada-Lovelace"],
  "apply": "none"
}'
```

## Apply modes

- `apply: "none"` — default; returns drafts only.
- `apply: "sandbox"` — writes draft to `User:<WIKI_USERNAME>/wikiEdit sandbox`.
- `apply: "talk"` — appends the talk-page edit request.
- `apply: "live"` — guarded; requires `WIKI_ALLOW_LIVE_EDIT=true` and payload `humanReviewed:true`.

Use a MediaWiki bot password for write modes:

```bash
WIKI_USERNAME=...
WIKI_BOT_PASSWORD=...
```

## Payload fields

- `pageTitle` (required): Wikipedia page title.
- `request` (required): desired edit, phrased narrowly.
- `sourceUrls`: article URLs to extract.
- `feedUrls`: RSS/Atom feeds to expand into recent source packets.
- `youtubeUrls`: YouTube URLs, when `DYNAMIC_WORKERS_HOST` supports `/youtube-transcript`.
- `manualNotes`: orientation notes; not citation-ready.
- `disclosure`: conflict-of-interest or paid-editing disclosure context.
- `wikiApiUrl`: defaults to English Wikipedia.
- `model`: optional Flue model override.

See `docs/wikipedia-guidelines.md` and `docs/source-pipeline.md`.
