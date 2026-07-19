## MODIFIED Requirements

### Requirement: Canonical tool manifest

The canonical tool manifest SHALL contain detailed human explanations for every
tool. Each entry's `details.whatItIsDetailed` MUST explain the category of thing
the tool is, its core mechanism or responsibility, and its role in Brai in at
least two complete sentences. `details.whyNeededDetailed` MUST explain the
problem it solves for Brai, the concrete value it provides, and relevant
boundaries or examples in at least two complete sentences.

#### Scenario: A short explanation is rejected

- **WHEN** either detailed explanation is missing, one sentence, or below the
  minimum content length
- **THEN** `stack:check` fails and identifies the tool and field

#### Scenario: RTK has a useful human explanation

- **WHEN** the catalog is read
- **THEN** RTK explains that it is a command-output wrapper, how it reduces
  context noise, why that matters for the agent, and when raw output remains
  necessary

### Requirement: Detailed generated pages

Each generated tool page SHALL render the detailed explanation fields in the
primary «Что это такое» and «Зачем это нужно Brai» sections. The page MAY retain
short summaries for indexes, but the primary sections MUST not be populated only
from one-line index text.

#### Scenario: A reader can understand a tool without prior context

- **WHEN** a reader opens a generated tool page
- **THEN** the reader can understand what the tool is, why Brai needs it, and
  what concrete role it plays before reading operational details

### Requirement: Automatic agent installation synchronization

The project SHALL instruct the agent to synchronize the canonical catalog and
generated output automatically in the same task after installing, upgrading or
removing a supported tool. This synchronization SHALL include classification,
detailed human explanations, source/version/location data, verification and
validation. The user SHALL NOT need to issue a special stack-generation command.

#### Scenario: Agent installs a new supported tool

- **WHEN** an agent completes installation of a tool used by Brai
- **THEN** the agent records the tool and detailed explanation, regenerates the
  pages and JSON, and runs the relevant checks before reporting completion

#### Scenario: Installation facts are incomplete

- **WHEN** the agent cannot establish the tool's purpose, source, version or
  verification
- **THEN** the stack update is not silently omitted; the agent reports the
  missing fact and leaves generated output fail-closed
