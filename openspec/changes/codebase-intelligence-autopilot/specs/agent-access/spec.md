## ADDED Requirements

### Requirement: Host code-intelligence services have narrow host access

The host-managed Graphify and SocratiCode services SHALL run as `mark:mark`,
read only the Brai New checkout and their declared local state, and write only
their explicitly managed generated/state paths. They MUST NOT receive root,
application secrets, user sandbox roots, core database credentials, Docker
socket access or a public listener.

#### Scenario: Code intelligence process starts

- **WHEN** systemd starts a code-intelligence service
- **THEN** it runs as `mark:mark` with restrictive filesystem permissions and
  resource limits
- **AND** its HTTP listener, if enabled, binds only to `127.0.0.1`

#### Scenario: Graphify is requested over the public hostname

- **WHEN** a browser reaches `codegraph.brai.one`
- **THEN** Caddy applies the unified technical Basic Auth and TLS before
  proxying to the loopback Graphify service
- **AND** no application or Graphify port is directly reachable from the
  Internet
