# Agent Design Guide

Use this guide for UI, UX, and screen-structure tasks in this repository.

## When To Use It

Open this guide when the task involves:

- changing an existing screen layout
- adding a new screen or major panel
- changing navigation or user flow
- reusing, replacing, or introducing UI building blocks
- aligning implementation with the Pencil design source

## What To Read And When

- `design/README.md`
  Use when the task affects overall UI structure, Pencil workflow, or the source of truth for screens and components.

- `design/notes/screen-map.md`
  Use when changing a specific screen and you need to map Pencil screens to code entry points.

- `design/notes/flows.md`
  Use when changing navigation, task sequences, or state transitions in user or developer flows.

- `design/notes/component-inventory.md`
  Use when adding, reusing, or aligning UI building blocks and feature-level components.

## Practical Rules For The Agent

- Treat `design/app.pen` as the source of truth for intended screen structure.
- Before editing UI code, identify which product surface is affected and map it to the corresponding code entry point.
- Prefer existing components and patterns before inventing new UI building blocks.
- Keep user-facing flows and internal developer flows clearly separated where the design notes require it.
- When a UI change affects structure, states, or navigation, check whether the related flow and screen documentation still match the implementation.
- If the new UI direction is approved, implement it directly and keep the codebase consistent with the new solution rather than preserving old UI paths.

## Minimal Workflow

1. Determine whether the task is about screen structure, flow, or components.
2. Read only the relevant files from `design/`.
3. Map the affected design artifact to the implementation entry point.
4. Make the code change using existing patterns where possible.
5. Verify that the resulting screen, flow, and component usage still match the documented design intent.
