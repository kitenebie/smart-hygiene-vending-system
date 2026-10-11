# Ponytail defaults

Use Ponytail's **full** mode for this project unless the user asks for normal mode or another level.

- Prefer the smallest complete change. Reuse existing code, platform features, and installed dependencies; do not add abstraction, configuration, or packages without a current need.
- Before editing, inspect the code touched and its callers, tests, fixtures, config, and exports. Preserve validation, error handling, security, accessibility, and hardware-calibration behavior.
- For non-trivial new logic, add one focused test or self-check. Document a known short-term limitation as `shortcut: <limit>, <when to upgrade>`.
- Keep updates and final replies concise: state the result, files changed, verification, and any risk or intentionally skipped work. Do not reproduce large files, logs, or unchanged context.
