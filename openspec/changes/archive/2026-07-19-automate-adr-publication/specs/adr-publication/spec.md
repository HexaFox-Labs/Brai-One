## ADDED Requirements

### Requirement: Valid ADR source changes publish automatically

The host SHALL automatically reconcile the Brai New ADR static publication
after a closed write to the configured ADR source directory or Log4brains
configuration. The automation SHALL run the project ADR, documentation, and
strict OpenSpec checks before it builds and promotes a release. The user SHALL
NOT need to execute a manual publish command for an accepted ADR source change.

#### Scenario: Accepted ADR is added or updated

- **WHEN** a valid ADR source write is closed in `docs/decisions/`
- **THEN** the host automation validates, builds, and atomically promotes a new
  Brai New static release
- **AND** `adr.brai.one` serves that release without a Caddy reload or a new
  public port

#### Scenario: Source is invalid

- **WHEN** ADR, documentation, or strict OpenSpec validation fails
- **THEN** the automation SHALL fail closed
- **AND** the previously active ADR release SHALL remain served
- **AND** the failure SHALL be available in the service journal without secrets

#### Scenario: Source is unchanged or a watcher event is missed

- **WHEN** a reconciliation run sees the manifest of the last successful
  source and active release
- **THEN** it SHALL not create a duplicate release
- **AND** a periodic reconciliation SHALL eventually publish a changed source
  missed by the path watcher

### Requirement: ADR auto-publication remains least privileged

The ADR auto-publisher SHALL run the renderer as the developer-owned `mark`
identity and SHALL write only to the dedicated ADR static release root. The
automation SHALL NOT receive Caddy, Docker, NATS, Supabase, or application
credentials.

#### Scenario: Host service is inspected

- **WHEN** an operator inspects the installed auto-publish unit
- **THEN** it runs as `mark` with a restricted writable release path
- **AND** root ownership is limited to unit installation and systemd control

### Requirement: Published ADR site uses the Brai dark theme

The static ADR build SHALL include a checked-in Brai dark-theme stylesheet and
SHALL attach it to every generated HTML page. The theme SHALL be applied during
the build rather than by a runtime service or browser-local preference.

#### Scenario: Static release is built

- **WHEN** Log4brains produces the ADR static output
- **THEN** every generated HTML page references the dark-theme asset
- **AND** the output declares a dark browser color scheme

### Requirement: ADR decision dates are timezone-safe

ADR source dates SHALL be real `YYYY-MM-DD` calendar dates no later than the
current UTC date. The static renderer SHALL preserve that calendar date across
browser timezones and SHALL NOT display an accepted ADR as a future day because
of time-of-day conversion.

#### Scenario: Date-only ADR is published east of UTC

- **WHEN** an ADR dated `2026-07-19` is rendered for a browser east of UTC
- **THEN** the published site displays `Jul 19, 2026`
- **AND** it does not display `Jul 20, 2026`

#### Scenario: Future date is added to ADR source

- **WHEN** an ADR source record has a date later than the current UTC date
- **THEN** ADR validation fails before a static release is promoted
- **AND** the previous active release remains served
