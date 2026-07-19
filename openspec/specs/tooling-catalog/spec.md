# Tooling Catalog

## Purpose

The project maintains a human-readable and machine-readable catalog of tools
used by Brai New. The catalog is generated from one canonical manifest and is
kept separate from package manifests, host installation records, and normative
application contracts.

## Requirements

### Requirement: Canonical tool manifest

The project SHALL maintain one canonical JSON manifest for the tools included in
the Brai New stack. Each entry MUST have a stable unique `id`, a human-readable
name, an allowed category, a scope, a concise explanation of what the tool is,
its purpose in Brai, its usage, a status, a version or explicit version source,
at least one source reference, at least one verification command or check, and a
complete `details` block. The `details` block MUST contain `whyThisTool`,
`howItWorksHere`, at least two `capabilities`, at least two `scenarios`, at
least one `commonMistakes` item, and `relatedTools` containing valid tool ids.
It MUST also contain `whatItIsDetailed` and `whyNeededDetailed`; each field
MUST be at least 180 characters and contain at least two complete sentences.
`whatItIsDetailed` explains what kind of tool it is, its core mechanism and its
role in Brai. `whyNeededDetailed` explains the problem it solves, concrete value
and relevant boundaries or examples.

#### Scenario: RTK is represented as a complete detailed entry

- **WHEN** the stack catalog is checked
- **THEN** RTK is present with category `developer-experience`, version `0.42.4`,
  its `/srv/opt/rtk` installation source, human-readable purpose, a
  verification reference for `rtk --version`, and detailed scenarios and
  limitations

#### Scenario: Incomplete narrative is rejected

- **WHEN** an entry omits a required details field or provides fewer than two
  capabilities or scenarios
- **THEN** `stack:check` fails and identifies the entry and missing detail

#### Scenario: A short explanation is rejected

- **WHEN** either detailed explanation is missing, one sentence, or below the
  minimum content length
- **THEN** `stack:check` fails and identifies the tool and field

### Requirement: Classified generated pages

The project SHALL generate one reader-facing Markdown page per manifest entry,
with a human-readable title, what-it-is explanation, purpose, usage, category,
status, version, location/source, detailed reason for the tool, local operating
model, capabilities, scenarios, application boundaries, common mistakes,
related tools, lifecycle information, verification, and further reading. Pages
MUST be grouped in a generated category index and linked from the stack
overview. The primary «Что это такое» and «Зачем это нужно Brai» sections MUST
use the detailed explanation fields, not only one-line index text.

#### Scenario: A catalog entry produces a detailed mini-landing page

- **WHEN** `stack:generate` runs for a valid manifest
- **THEN** exactly one deterministic page exists at
  `docs/stack/tools/<id>.md` and contains the detailed sections required by
  the manifest, links back to its category and stack indexes, and links to
  related tool pages

#### Scenario: A reader can understand a tool without prior context

- **WHEN** a reader opens a generated tool page
- **THEN** the reader can understand what the tool is, why Brai needs it, and
  what concrete role it plays before reading operational details

#### Scenario: Category navigation is generated

- **WHEN** entries use more than one allowed category
- **THEN** the generator creates a category index for each used category and
  lists each tool exactly once in the matching category

### Requirement: Web-ready catalog output

The generator SHALL emit a deterministic `docs/stack/catalog.json` containing
the validated tool records, complete details blocks, related-tool ids and
category metadata without secrets. The output MUST be suitable for a later
static site build without parsing Markdown.

#### Scenario: Site data contains detailed structured records

- **WHEN** `stack:generate` completes
- **THEN** `docs/stack/catalog.json` contains categories and tool records with
  stable ids, URLs, human descriptions, details, version/status data, related
  tools and source links

#### Scenario: Secrets are excluded

- **WHEN** catalog output is generated
- **THEN** it contains no credential values, private keys, token-like values, or
  contents copied from secret files

### Requirement: Deterministic synchronization and validation

The project SHALL provide `stack:generate` for synchronization and `stack:check`
for fail-closed validation. `stack:check` MUST validate allowed categories,
unique ids and slugs, complete narrative details, related-tool references,
source references, generated parity, and links in the generated catalog. CI SHALL
run `stack:check` together with documentation checks.

The project SHALL instruct the agent to synchronize the canonical catalog and
generated output automatically in the same task after installing, upgrading or
removing a supported tool. This synchronization SHALL include classification,
detailed human explanations, source/version/location data, verification and
validation. The user SHALL NOT need to issue a special stack-generation command.

#### Scenario: Manual generated edit is detected

- **WHEN** a generated page, category index, or JSON catalog differs from the
  output of the manifest generator
- **THEN** `stack:check` fails and instructs the user to run `stack:generate`

#### Scenario: A new tool follows the detailed workflow

- **WHEN** an installed tool is added to the manifest with its category,
  explanation, purpose, details, related tools, source and verification data
- **THEN** one generation command updates its page, category index, overview
  links, and web-ready JSON record

#### Scenario: Agent installs a new supported tool

- **WHEN** an agent completes installation of a tool used by Brai
- **THEN** the agent records the tool and detailed explanation, regenerates the
  pages and JSON, and runs the relevant checks before reporting completion

#### Scenario: Installation facts are incomplete

- **WHEN** the agent cannot establish the tool's purpose, source, version or
  verification
- **THEN** the stack update is not silently omitted; the agent reports the
  missing fact and leaves generated output fail-closed
