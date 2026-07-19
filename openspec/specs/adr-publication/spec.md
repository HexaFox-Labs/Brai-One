# adr-publication Specification

## Purpose

Defines how Brai New ADR content is built, staged, published, protected, and
rolled back without importing or serving the legacy ADR catalog.

## Requirements

### Requirement: ADR publication is generated from Brai New

The published ADR site SHALL be built from the current Brai New checkout and
SHALL not depend on the legacy project checkout at runtime. Generated output
SHALL be staged as a versioned static release outside the live source checkout
and promoted atomically to the active Brai New ADR root.

#### Scenario: New static release

- **WHEN** an ADR publication is requested
- **THEN** Log4brains builds from Brai New `docs/decisions/`
- **AND** the output is placed in a new versioned/staged release
- **AND** the live site is not partially replaced during the build

#### Scenario: Legacy data is preserved but unused

- **WHEN** the Brai New ADR site is promoted
- **THEN** the legacy static root remains untouched for rollback or historical
  inspection
- **AND** the new publication does not expose legacy ADR records

### Requirement: adr.brai.one uses the Brai New publication

The canonical `adr.brai.one` HTTPS route SHALL serve the active Brai New ADR
release, SHALL retain the unified Caddy Basic Auth policy, and SHALL not expose
the static site through a new public application port. HTTP requests SHALL
continue to redirect to HTTPS.

#### Scenario: Authenticated canonical route

- **WHEN** an authorized operator requests `https://adr.brai.one/`
- **THEN** Caddy authenticates the request with the unified technical-subdomain
  credentials
- **AND** the response is the Brai New Log4brains site

#### Scenario: Unauthenticated route

- **WHEN** a request reaches `https://adr.brai.one/` without valid Caddy
  credentials
- **THEN** Caddy returns the existing authentication challenge
- **AND** no ADR content is disclosed

#### Scenario: Rollback

- **WHEN** the new ADR publication fails smoke or canary verification
- **THEN** the route can be switched back to the preserved legacy root
- **AND** the failed new release is not presented as the active site

### Requirement: ADR publication reconciles accepted source automatically

The host SHALL automatically reconcile the Brai New ADR static publication
after a closed write to `docs/decisions/` or its Log4brains configuration. It
SHALL run ADR, documentation and strict OpenSpec checks before building and
atomically promoting a release. An unchanged successful source SHALL not create
a duplicate release; a periodic reconciliation SHALL cover a missed path event.

#### Scenario: Valid ADR source changes

- **WHEN** a valid ADR source write is closed
- **THEN** the least-privilege host automation validates, builds and promotes a
  new static release without a manual publish command or Caddy reload

#### Scenario: Validation or build fails

- **WHEN** a required check or static build fails
- **THEN** the automation fails closed and leaves the previous active release
  in place
- **AND** its journal records the failure without secrets

### Requirement: Static ADR output uses the Brai dark theme

The generated ADR website SHALL include a checked-in dark-theme stylesheet and
reference it from every generated HTML page. Theme application SHALL happen in
the static build and SHALL NOT require a runtime service or a browser setting.

#### Scenario: Static release is built

- **WHEN** Log4brains has generated an ADR static release
- **THEN** every generated HTML page references the dark-theme asset
- **AND** the output declares a dark browser color scheme

### Requirement: ADR decision dates are timezone-safe

An ADR source date SHALL be a real `YYYY-MM-DD` calendar date no later than the
current UTC date. The static renderer SHALL preserve that calendar date across
browser timezones; it SHALL NOT display an accepted ADR as a future day because
of a time-of-day conversion.

#### Scenario: Date-only ADR is published east of UTC

- **WHEN** an ADR dated `2026-07-19` is rendered for a browser east of UTC
- **THEN** the published site displays `Jul 19, 2026`
- **AND** it does not display `Jul 20, 2026`

#### Scenario: Future date is added to ADR source

- **WHEN** an ADR source record has a date later than the current UTC date
- **THEN** the ADR validation fails before a static release is promoted
- **AND** the previous active release remains served
