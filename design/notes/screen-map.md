# Screen Map

This file links the current product surfaces to the intended Pencil screens.

## Primary Screens

| Pencil screen | Purpose | Code entry point |
| --- | --- | --- |
| `Dashboard` | Choose bank, inspect open PRs, enter workspace | `src/pages/Dashboard.tsx` |
| `BankWorkspace` | Edit formats, run checks, publish changes | `src/pages/BankWorkspace.tsx` |
| `SmsMarkupGame` | User-facing markup game flow | `src/pages/SmsMarkupGame.tsx` |
| `HomeHub` | Optional split-entry landing between user and developer modes | `src/pages/HomeHub.tsx` |

## Screen Rules

- `Dashboard` should emphasize repository context, bank selection, and PR visibility.
- `BankWorkspace` should keep one dominant editing area with secondary validation and publish regions.
- `SmsMarkupGame` should stay separate from internal tooling patterns.
- `HomeHub` remains optional unless product navigation returns to a dual-entry model.

## Suggested Pencil Frames

Under `03_Screens`, keep one frame per screen:

- `Dashboard`
- `BankWorkspace`
- `SmsMarkupGame`
- `HomeHub`

Under `04_States`, add matching variants for the critical screens:

- `Dashboard / Loading`
- `Dashboard / Empty`
- `Dashboard / Error`
- `BankWorkspace / No file selected`
- `BankWorkspace / Validation issues`
- `BankWorkspace / Ready to publish`
- `SmsMarkupGame / Intro`
- `SmsMarkupGame / In progress`
- `SmsMarkupGame / Result`
