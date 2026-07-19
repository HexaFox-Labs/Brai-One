## ADDED Requirements

### Requirement: Agents preserve branch-level preview ownership

An agent working on a runtime task SHALL push changes to its assigned
primary-repository integration branch and report the exact commit that the
preview controller deploys. Agents collaborating on one integration branch
MUST NOT allocate separate previews for their individual commits.

#### Scenario: Several agents contribute to one feature branch

- **WHEN** multiple agents push successive commits to the same feature branch
- **THEN** all qualifying preview updates use the branch's existing slot lease
- **AND** the acceptance status identifies the latest deployed commit

#### Scenario: Agent changes only documentation

- **WHEN** an agent pushes a classified documentation-only commit
- **THEN** it reports the reduced check result
- **AND** it does not request a preview or acceptance gate
