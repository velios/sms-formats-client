## MODIFIED Requirements

### Requirement: Regex Workspace
The system SHALL provide a regex workspace analogous to regex101 workflow for editing and testing.
The system SHALL provide a single unified regex editor block where editable pattern text and syntax highlighting are rendered from the same source content.
The system SHALL keep highlight and text layout aligned during typing, caret movement, selection changes, and horizontal scrolling.
The system SHALL evaluate regex using JavaScript-compatible behavior in browser runtime.
The system SHALL display match details including full match and capturing groups.
The system SHALL provide human-readable explanation output derived from regex structure.
The system SHALL map clicked regex tokens to related capturing groups and highlight corresponding captured text in the active test string.

#### Scenario: Unified regex editor keeps highlight aligned
- **WHEN** a user edits regex pattern text and scrolls the pattern horizontally
- **THEN** editable text and syntax highlight remain visually aligned in one editor block
- **AND** cursor/selection positions reference the same character offsets as highlighted tokens

#### Scenario: Successful regex match
- **WHEN** regex and active example produce a match
- **THEN** the app highlights matched segments and groups in test string
- **AND** shows match/group data with indexes or offsets

#### Scenario: Click token highlights captured text
- **WHEN** a user clicks a regex token that belongs to capturing group `N`
- **THEN** the test-string panel highlights the captured range for group `N` in the active example
- **AND** the match information panel marks group `N` as active

#### Scenario: Click token without captured value
- **WHEN** a user clicks a token mapped to capturing group `N` and that group has no captured value in the current match
- **THEN** the app clears token-driven highlight for captured text in test string
- **AND** no stale highlight from a previously selected token remains active

#### Scenario: Invalid regex
- **WHEN** a user enters syntactically invalid regex
- **THEN** explanation and match panels show a clear parse error
- **AND** no stale match result is displayed as current state
