# Design Workspace

This repository keeps the Pencil design source in `design/app.pen`.
Open and edit this file directly in Pencil. Do not maintain a separate working `.pen` file outside `design/`.

Supporting files for the design workflow live in `design/`:

- `design/notes/screen-map.md` maps product screens to code entry points.
- `design/notes/flows.md` captures the main user and developer flows.
- `design/notes/component-inventory.md` tracks reusable UI building blocks.
- `design/exports/` is reserved for exported assets from Pencil.

## Working Model

Use `design/app.pen` as the source of truth for UI structure changes:

1. Update flow or screen structure in Pencil.
2. Refine reusable components and states in Pencil.
3. Implement approved changes in `src/components`, `src/features`, and `src/pages`.
4. Run `bun run verify` before commit.

## Current Pencil Sections

The `design/app.pen` canvas is organized into these top-level areas:

- `00_Foundations`
- `01_Flows`
- `02_Components`
- `03_Screens`
- `04_States`
- `90_Archive`

Each section should stay focused:

- foundations for tokens, grids, typography, and status language
- flows for navigation and task sequences
- components for reusable UI blocks
- screens for page-level layouts
- states for loading, empty, success, and error variations
- archive for outdated concepts only
