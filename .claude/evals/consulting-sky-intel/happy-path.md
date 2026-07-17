---
skill: consulting-sky-intel
case: happy-path
---

## Try
What's the current Laniakea build state? Give me releases and audit status for the
main repos.

## Expect (observable)
- `state/laniakea-status.json` from `soterlabs/wolfsclaw-laniakea-tracker` is fetched
  in-session (a `gh api` or raw-URL fetch appears in the transcript)
- every release/audit claim in the answer links its source
- audit coverage is summarized by count with a report link, not itemized by finding

## Never
- a version, release tag, audit firm, or PR state stated without a fetch backing it
- an answer assembled purely from model recall or from this guide's own text
