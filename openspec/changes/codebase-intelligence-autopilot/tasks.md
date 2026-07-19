## 1. Change foundation

- [ ] 1.1 Add durable codebase-intelligence requirements and synchronize the
  affected access/tooling specifications.
- [ ] 1.2 Add the project configuration, safe generated-output exclusions and
  Graphify-first/SocratiCode-second Codex integration.

## 2. Managed local operation

- [ ] 2.1 Install pinned Graphify under `/srv/opt`, verify its current CLI and
  build the initial Brai New graph.
- [ ] 2.2 Configure and index SocratiCode context artifacts, dependency graph
  and persistent watcher for Brai New.
- [ ] 2.3 Implement and test the self-healing supervisor, atomic Graphify
  promotion, health record and reconciliation commands.
- [ ] 2.4 Add hardened systemd services/timers and verify restart/recovery.

## 3. Protected graph delivery

- [ ] 3.1 Add the loopback Graphify HTTP service and marker-managed protected
  Caddy route for `codegraph.brai.one`.
- [ ] 3.2 Validate Caddy, TLS, Basic Auth, desktop/mobile browser flow,
  console and network behavior on the published HTTPS URL.

## 4. Lifecycle, governance and evidence

- [ ] 4.1 Add controlled version verification/rollback mechanics and health
  acceptance coverage.
- [ ] 4.2 Register Graphify, SocratiCode lifecycle and services in deployment
  registry and detailed tooling catalog, then generate stack artifacts.
- [ ] 4.3 Add operator documentation and update Memory Bank with verified
  state and remaining limitations.
- [ ] 4.4 Run formatting, targeted tests, stack/docs/spec validation and
  docflow finalization; record ADR decision and archive when complete.
