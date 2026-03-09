# Screen Map

This file links the current product surfaces to the intended Pencil screens.

## Primary Screens

| Pencil screen | Purpose | Code entry point |
| --- | --- | --- |
| `Dashboard` | Choose bank, inspect open PRs, enter workspace | `src/pages/Dashboard.tsx` |
| `BankWorkspace` | Edit formats, run checks, publish changes | `src/pages/BankWorkspace.tsx` |

## Screen Rules

- `Dashboard` should emphasize repository context, bank selection, and PR visibility.
- `BankWorkspace` should keep one dominant editing area with secondary validation and publish regions.

## Suggested Pencil Frames

Under `03_Screens`, keep one frame per screen:

- `Dashboard`
- `BankWorkspace`

Under `04_States`, add matching variants for the critical screens:

- `Dashboard / Loading`
- `Dashboard / Empty`
- `Dashboard / Error`
- `BankWorkspace / No file selected`
- `BankWorkspace / Validation issues`
- `BankWorkspace / Ready to publish`
