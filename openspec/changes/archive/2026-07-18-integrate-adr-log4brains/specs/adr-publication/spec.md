## ADDED Requirements

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
