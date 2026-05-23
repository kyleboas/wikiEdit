# Wikipedia editing guardrails

wikiEdit drafts edits against these Wikipedia principles:

- Neutral point of view: write proportionately and without advocacy.
- Verifiability: every challenged or likely-to-be-challenged claim needs a published source.
- Reliable sources: prefer independent, editorially controlled secondary sources; use primary sources only for simple, non-controversial facts about themselves.
- No original research: do not combine sources to imply a conclusion no source states.
- Biographies of living persons: use especially high-quality sources and avoid contentious material unless strongly sourced.
- Conflict of interest / paid editing: disclose the relationship and request changes on the talk page rather than directly editing when appropriate.
- No promotion: avoid marketing language, puffery, and resume-like detail.
- Due weight: do not overemphasize minor coverage, announcements, or self-published claims.

Operational default: the agent drafts a full revised wikitext plus a talk-page request. It does not write to Wikipedia unless explicitly invoked with `apply=sandbox`, `apply=talk`, or guarded `apply=live`.
