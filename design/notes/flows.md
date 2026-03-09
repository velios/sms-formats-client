# Product Flows

## 1. Developer Workspace Flow

Primary goal: reach a specific bank workspace and safely edit SMS formats.

Sequence:

1. Open `Dashboard`.
2. Confirm repository and source context.
3. Choose a bank or open a recent PR.
4. Enter `BankWorkspace`.
5. Select a format file or sender list.
6. Edit content and run quick checks.
7. Review validation and publishing state.
8. Publish or update the PR branch.

## 2. PR Review Flow

Primary goal: inspect open PR health and continue work from an active change.

Sequence:

1. Open `Dashboard`.
2. Scan PR list, labels, approvals, and validation issues.
3. Open a PR-backed workspace.
4. Review changed files and validation feedback.
5. Apply edits or publish follow-up updates.

## 3. SMS Game Flow

Primary goal: guide a non-developer user through the markup game without exposing internal tooling complexity.

Sequence:

1. Enter `SmsMarkupGame`.
2. Read context and task instructions.
3. Progress through markup steps.
4. Receive feedback and result state.

## Flow-to-Pencil Mapping

- `01_Flows / Developer Workspace Flow`
- `01_Flows / PR Review Flow`
- `01_Flows / SMS Game Flow`

Keep flow boards lightweight:

- main entry point
- key decision nodes
- state transitions
- blocking conditions
