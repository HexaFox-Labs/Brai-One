## ADDED Requirements

### Requirement: Managed code-intelligence tooling is registered with lifecycle evidence

The project SHALL record every installed code-intelligence tool and its managed
service lifecycle in the host deployment registry and the canonical tooling
catalog. The record MUST identify verified version, location, usage, health
check and operational boundaries without secrets.

#### Scenario: Graphify and SocratiCode installation completes

- **WHEN** Graphify or SocratiCode is installed, upgraded or removed for Brai
  New
- **THEN** `/home/mark/DEPLOYMENT.md` and the canonical stack manifest describe
  the verified lifecycle and checks in the same change
- **AND** generated stack pages and catalog validation complete before the
  change is reported finished
