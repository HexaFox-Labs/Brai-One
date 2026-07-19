## ADDED Requirements

### Requirement: Delivery credentials are event-bound and least privilege

Deployment, registry and preview credentials SHALL be available only to
trusted primary-repository workflows with the minimum required permission and
protected-environment gate. A public fork, issue, comment, arbitrary dispatch
input or untrusted workflow artifact MUST NOT obtain a delivery credential or
invoke a host deployment command.

#### Scenario: Trusted production promotion submits a manifest

- **WHEN** a protected release promotion is approved for the exact release
  revision
- **THEN** only the production job receives the deployment SSH material
- **AND** the host accepts only the fixed manifest receiver command

#### Scenario: Untrusted event attempts deployment

- **WHEN** an external repository event or untrusted artifact requests preview
  or deployment work
- **THEN** the request is rejected before credential material is available
- **AND** no host command is invoked

### Requirement: Initial Access foundation precedes migration-role provisioning

The delivery controller SHALL run the checked-in one-time Access foundation
with its bootstrap credential before it creates or logs into the bounded Access
migrator. This ordered step applies only to a fresh Dev or preview database.

#### Scenario: New preview restores a Dev data snapshot

- **WHEN** the controller initializes a new preview database from the data-only
  snapshot
- **THEN** it recreates the Access foundation and checksum ledger before
  provisioning, passwording and auditing preview-local Access migration roles
- **AND** the preview remains unavailable if the foundation step fails
