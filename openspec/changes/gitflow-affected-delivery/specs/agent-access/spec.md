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
