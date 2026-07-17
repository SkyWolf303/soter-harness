# Soter runtime notes (generated)

- The project CLAUDE.md's guide index lists PROMOTED Soter Skills only. ALL skills —
  staged included — are available as /commands; the full listing with descriptions is
  `skills-manifest.json` in the Soter config dir (path below), or `soter skills` in a
  terminal. Where the project carries the harness tree, each skill's body is at
  `.claude/skills/<name>/SKILL.md`; otherwise read the bundled command body itself.
  When a user request matches a skill's territory, follow that skill: the staged flag
  gates auto-invocation, not user-requested work.
- A skill's sibling assets (e.g. `skill-assets/<name>/<file>`) resolve relative to
  the Soter config dir (path below).
- Domain vocabulary (including the Sky ecosystem) is defined in the harness LEXICON
  (`.claude/LEXICON.md` where the project carries it) — consult it before answering
  domain questions, and never redefine its terms.
- The skill set is meant to GROW: when a request exposes a gap no skill covers, or a
  correction repeats, suggest forging a new skill (/forge) or landing the correction
  as a gotcha or eval case on the governing skill. Suggest — the user decides.
