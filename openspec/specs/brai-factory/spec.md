# brai-factory Specification

## Purpose

Определяет первый микросервисный вертикальный срез Brai Factory: создание и
просмотр Activity через защищённый web, Gateway, NATS и service-owned
Supabase schema.

## Requirements

### Requirement: Activity creation is durably acknowledged

The Gateway MUST return success only after `brai-factory` has confirmed the
Activity write in its private Supabase schema.

#### Scenario: Activity is created

- **WHEN** a valid create command is sent through the same-origin API
- **THEN** Gateway returns `201` with the stored Activity

#### Scenario: Idempotent create is repeated

- **WHEN** the same payload and idempotency key are repeated
- **THEN** the existing Activity is returned without a duplicate
- **AND** a different payload with that key returns conflict

#### Scenario: Factory or database is unavailable

- **WHEN** NATS has no responder or persistence fails
- **THEN** Gateway returns service unavailable instead of false success

### Requirement: Activity listing is cursor paginated

The Gateway SHALL list Activities newest first with bounded cursor pagination.

#### Scenario: First page is requested

- **WHEN** no cursor is supplied
- **THEN** at most 50 Activities are returned newest first
- **AND** a next cursor is included when more rows exist

#### Scenario: Next page is requested

- **WHEN** a valid next cursor is supplied
- **THEN** the next page has no omissions or duplicates
- **AND** an invalid cursor is rejected as a validation error

### Requirement: Service boundaries use NATS and least privilege

Gateway MUST NOT receive database credentials, web MUST NOT receive NATS or
database credentials, and inter-service application traffic SHALL use NATS.

#### Scenario: Activity request crosses service boundaries

- **WHEN** Gateway handles an Activity request
- **THEN** it communicates with `brai-factory` only through NATS
- **AND** only `brai-factory` connects to its private Supabase schema

#### Scenario: Runtime network exposure is inspected

- **WHEN** the Compose runtime is deployed
- **THEN** NATS and Supabase do not gain public host ports

### Requirement: Protected web UI supports the Activity workflow

The protected static web UI SHALL allow users to create and view the shared
Activity list on desktop and mobile.

#### Scenario: User creates an Activity

- **WHEN** a user submits a valid form by pointer or keyboard
- **THEN** the saved Activity appears in the list
- **AND** a failed save does not clear the form

#### Scenario: Activity list changes

- **WHEN** another Activity is created
- **THEN** polling refreshes the first page within ten seconds without duplicates

#### Scenario: Long description is shown

- **WHEN** an Activity has a long description
- **THEN** the user can expand and collapse it in the Russian dark-only UI
