## ADDED Requirements

### Requirement: Durable changes include ADR impact review

The agent SHALL run the project documentation governance workflow before
finishing a durable change and SHALL include its ADR decision in the change
evidence. A durable change SHALL NOT be archived while required ADR work or the
explicit no-ADR rationale is missing.

#### Scenario: Change with an architectural decision

- **WHEN** a durable Change introduces or changes an architectural decision
- **THEN** the agent creates or updates the corresponding ADR
- **AND** the final report links the ADR, OpenSpec capability, and verification

#### Scenario: Change with no ADR requirement

- **WHEN** a durable Change is reviewed and no new architectural decision is
  introduced
- **THEN** the agent records an explicit no-ADR rationale in its governance
  evidence
- **AND** the Change can proceed only after the normal documentation checks pass
