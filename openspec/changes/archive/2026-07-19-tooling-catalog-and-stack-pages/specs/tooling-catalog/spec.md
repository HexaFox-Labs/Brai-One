## ADDED Requirements

### Requirement: Canonical tool manifest

The project SHALL maintain one canonical JSON manifest for the tools included in
the Brai New stack. Each entry MUST have a stable unique `id`, a human-readable
name, an allowed category, a scope, a concise explanation of what the tool is,
its purpose in Brai, its usage, a status, a version or explicit version source,
at least one source reference, and at least one verification command or check.

#### Scenario: RTK is represented as a complete entry

- **WHEN** the stack catalog is checked
- **THEN** RTK is present with category `developer-experience`, version `0.42.4`,
  its `/srv/opt/rtk` installation source, human-readable purpose, and a
  verification reference for `rtk --version`

#### Scenario: Incomplete entry is rejected

- **WHEN** an entry omits a required human or source field
- **THEN** `stack:check` fails and identifies the entry and missing field

### Requirement: Classified generated pages

The project SHALL generate one reader-facing Markdown page per manifest entry,
with a human-readable title, what-it-is explanation, purpose, usage, category,
status, version, location/source, limitations when known, and verification.
Pages MUST be grouped in a generated category index and linked from the stack
overview.

#### Scenario: A catalog entry produces a mini-landing page

- **WHEN** `stack:generate` runs for a valid manifest
- **THEN** exactly one deterministic page exists at
  `docs/stack/tools/<id>.md` and the page links back to its category and stack
  indexes

#### Scenario: Category navigation is generated

- **WHEN** entries use more than one allowed category
- **THEN** the generator creates a category index for each used category and
  lists each tool exactly once in the matching category

### Requirement: Web-ready catalog output

The generator SHALL emit a deterministic `docs/stack/catalog.json` containing
the validated tool records and category metadata without secrets. The output
MUST be suitable for a later static site build without parsing Markdown.

#### Scenario: Site data contains structured tool records

- **WHEN** `stack:generate` completes
- **THEN** `docs/stack/catalog.json` contains categories and tool records with
  stable ids, URLs, human descriptions, version/status data, and source links

#### Scenario: Secrets are excluded

- **WHEN** catalog output is generated
- **THEN** it contains no credential values, private keys, token-like values, or
  contents copied from secret files

### Requirement: Deterministic synchronization and validation

The project SHALL provide `stack:generate` for synchronization and `stack:check`
for fail-closed validation. `stack:check` MUST validate allowed categories,
unique ids and slugs, source references, generated parity, and links in the
generated catalog. CI SHALL run `stack:check` together with documentation checks.

#### Scenario: Manual generated edit is detected

- **WHEN** a generated page, category index, or JSON catalog differs from the
  output of the manifest generator
- **THEN** `stack:check` fails and instructs the user to run `stack:generate`

#### Scenario: A new tool follows the same workflow

- **WHEN** an installed tool is added to the manifest with its category,
  explanation, purpose, source and verification data
- **THEN** one generation command updates its page, category index, overview
  links, and web-ready JSON record
