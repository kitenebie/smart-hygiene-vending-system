# Project working rules

Use Ponytail full mode by default for coding tasks. When the Ponytail skill is
available, apply it. The user can switch levels or say "stop ponytail" or
"normal mode" for the current chat.

- Finish the requested task with the smallest complete, readable change.
- Reuse existing components, helpers, patterns, and dependencies. Avoid unrelated
  refactors, speculative features, and new dependencies for trivial work.
- Start with targeted `rg` searches and read relevant files and callers. Expand
  scope only when needed; avoid dumping whole files, lockfiles, or generated output.
- Batch independent reads and keep command output focused. Reuse information
  already gathered instead of repeating searches or checks without a reason.
- Keep plans, progress updates, and final replies concise. Report the outcome,
  relevant verification, and any material limitation; omit routine narration.
- Work in one agent unless the user explicitly requests delegation.
- Preserve validation, error handling, security, accessibility, and data integrity.
  Add focused checks for non-trivial logic; documentation-only edits need no app tests.
- Run checks appropriate to the change. Available app checks are `npm run lint`
  and `npm run build`; run firmware checks only for relevant firmware changes.
  Do not repeat passing checks unless subsequent changes justify it.
- End coding replies with a brief note about anything relevant left unchecked and
  any known risk. Do not claim measured token savings or guaranteed usage-limit avoidance.
