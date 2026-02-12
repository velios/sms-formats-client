## ADDED Requirements

### Requirement: Source Selection and Refresh
The system SHALL load data from the configured GitHub repository and default to the `main` branch at application start.
The system SHALL allow switching source context to either a branch name or an open pull request source branch.
The system SHALL provide a one-action way to return to `main`.
The system SHALL refresh source data without full page reload.

#### Scenario: Start on main branch
- **WHEN** a user opens the app with valid repository config
- **THEN** repository state is loaded from branch `main`
- **AND** the active source indicator shows `main`

#### Scenario: Switch source by open PR title
- **WHEN** a user searches open pull requests by title and selects a result
- **THEN** the app switches to that PR head branch
- **AND** all bank and file listings are reloaded for the selected source

#### Scenario: Refresh with local changes
- **WHEN** a user has unsaved local edits and clicks refresh
- **THEN** the app asks for confirmation
- **AND** attempts to preserve and merge local edits against refreshed remote data

### Requirement: Bank Discovery and Navigation
The system SHALL index bank entities from `src/<bank folder>/` and provide fast bank search with autocomplete.
The system SHALL provide a dedicated bank workspace view showing the active bank name at all times.

#### Scenario: Navigate to bank workspace
- **WHEN** a user selects a bank from autocomplete
- **THEN** the app opens a bank-focused workspace
- **AND** bank name is visible in page header or primary context area

### Requirement: Format File Editing
The system SHALL support editing existing format files under `formats/`.
The system SHALL support creating a new format file from a predefined template.
The system SHALL provide both raw text mode and structured mode for format editing.
The system SHALL keep synchronization between raw and structured representations through explicit user actions.

#### Scenario: Parse raw format into structured model
- **WHEN** a user edits raw format text and invokes parse action
- **THEN** regex, columns, and examples are extracted into structured fields
- **AND** parse errors are displayed if markers or sections are invalid

#### Scenario: Apply structured changes to raw file
- **WHEN** a user updates structured fields and invokes apply action
- **THEN** raw format text is regenerated using canonical markers and spacing
- **AND** the generated file remains compatible with repository format rules

### Requirement: Multiple Example Test Strings
The system SHALL support one or more `EXAMPLE` sections per format file.
The system SHALL allow selecting the active example as current test string.
The system SHALL update explanation and match information based on the active example.

#### Scenario: Switch active example
- **WHEN** a format contains multiple examples and the user selects another example
- **THEN** test string display updates to selected example
- **AND** explanation and match information are recalculated for that selection

### Requirement: Regex Workspace
The system SHALL provide a regex workspace analogous to regex101 workflow for editing and testing.
The system SHALL evaluate regex using JavaScript-compatible behavior in browser runtime.
The system SHALL display match details including full match and capturing groups.
The system SHALL provide human-readable explanation output derived from regex structure.

#### Scenario: Successful regex match
- **WHEN** regex and active example produce a match
- **THEN** the app highlights matched segments and groups in test string
- **AND** shows match/group data with indexes or offsets

#### Scenario: Invalid regex
- **WHEN** a user enters syntactically invalid regex
- **THEN** explanation and match panels show a clear parse error
- **AND** no stale match result is displayed as current state

### Requirement: Columns Builder
The system SHALL provide a columns editor based on the allowed column reference list from repository README.
The system SHALL support parameterized column forms such as `date#<format>` and `syncid#<accountType>`.
The system SHALL support reordering columns and serializing them into a semicolon-separated line.

#### Scenario: Add and reorder columns
- **WHEN** a user adds several columns from the reference list and reorders them
- **THEN** stored columns sequence matches UI order
- **AND** serialized `COLUMNS` line uses semicolon separators in that order

### Requirement: Senders File Editing
The system SHALL support plain text editing for `senders.txt` within a bank workspace.

#### Scenario: Edit senders file
- **WHEN** a user updates sender lines and saves local draft
- **THEN** `senders.txt` draft content is tracked as changed
- **AND** no additional parsing constraints are imposed beyond plain text editing

### Requirement: Create New Bank
The system SHALL support creating a new bank entity with folder structure and starter files.
The system SHALL generate `src/<bank name>_<bank id or empty>/senders.txt` and `formats/` contents from templates.

#### Scenario: Create bank with optional id
- **WHEN** a user provides bank name and optional bank id in create flow
- **THEN** a new bank folder is created under `src/`
- **AND** required starter files are created in local draft state

### Requirement: Local Validation
The system SHALL run local validation before PR publishing.
Validation SHALL include repository CI-equivalent rules for format files.
Validation SHALL prevent publishing when blocking checks fail.

#### Scenario: Block publish on validation errors
- **WHEN** any changed file violates format structure, regex matching, group count, or allowed column rules
- **THEN** publish action is blocked
- **AND** user sees file-level diagnostic messages describing failures

#### Scenario: Cross-format collision detection
- **WHEN** an example of one format matches regex of another format in the same bank
- **THEN** validation reports a blocking collision error
- **AND** publish action remains disabled until resolved

### Requirement: One-Bank Publish Scope
The system SHALL enforce that a publish operation includes changes from exactly one bank.

#### Scenario: Mixed-bank changes
- **WHEN** local draft includes modifications across multiple banks
- **THEN** publish preflight fails with explicit one-bank rule message
- **AND** user is guided to limit publish scope to one bank

### Requirement: GitHub Publish Flow Without Mandatory Login at Start
The system SHALL allow editing without authentication.
The system SHALL request GitHub credentials only at PR publish time.
The system SHALL support creating a fork branch, commit, and pull request to upstream `main`.

#### Scenario: Publish with deferred authentication
- **WHEN** a user clicks create pull request without prior auth state
- **THEN** the app prompts for GitHub token credentials
- **AND** proceeds to publish only after successful credential validation

### Requirement: Internationalization
The system SHALL support at least Russian and English UI locales using i18next.

#### Scenario: Change locale
- **WHEN** user switches locale between RU and EN
- **THEN** all registered UI text labels and messages update to selected locale

### Requirement: UI/UX Execution Autonomy
The implementation SHALL allow the implementing agent to choose concrete UI/UX visual and interaction patterns, provided all functional requirements in this spec are satisfied.
If the implementation environment provides a dedicated UI/design skill, it SHOULD be used for interface refinement.

#### Scenario: Implementer chooses visual system
- **WHEN** implementing agent develops the UI
- **THEN** it may choose component styling and layout details freely
- **AND** it must still preserve required workflows, validation behavior, and publish constraints defined above
