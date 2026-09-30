# Agent instructions

## Work

- Use Russian with users and in documentation; English in code, comments and instructions.
- State assumptions and resolve blocking ambiguity before editing.
- Implement only requested work with the smallest working solution; match existing style.
- Remove artifacts made obsolete by your changes; leave unrelated code alone.
- After an agreed redesign, replace old paths completely; code compatibility is unnecessary.
- Define checks before editing and run them before finishing. Verify changed screens/interactions in a browser.

## Writing

- Keep project instructions in AGENTS.md; CLAUDE.md contains only `@AGENTS.md`.
- Use the shortest complete text. Comments explain only non-obvious reasons.
- README contains purpose, quickstart and essential links. Put lasting technical guidance in `docs/`, linked from README or relevant agent instructions. Remove duplicates and obsolete material.
- Keep decisions and validation in the PR or existing documentation.

## References

- Issues/PRDs: use `gh`; read [tracker conventions](docs/agents/issue-tracker.md). For triage, read [labels](docs/agents/triage-labels.md).
- Domain exploration: read [domain instructions](docs/agents/domain.md), then the glossary and relevant ADRs.
- Before creating, changing or reviewing UI/styles, read [UI conventions](docs/ui-design.md).
- For tests, content, caching or bot setup, read [development notes](docs/development.md).

## Project identity

- project: sms-formats
- registry: https://github.com/velios/zen-hub/blob/main/docs/registry.md
