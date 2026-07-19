# Local CI

`pnpm ci` first runs the access policy and then lint, typecheck, tests and builds through the local Nx task graph. Nx Cloud is disabled. Integration suites create short-lived Docker containers and must set `NODE_ENV=test`.

The access policy scans the real source tree and recursively checks generated/cache directories for the exact owner, owner access, special files, and unsafe symlink targets. Only Codex-managed placeholder directories (`.git`, `.agents`, `.codex`) are omitted from the portable CI scan; the production developer-launch preflight audits the real host checkout, including its actual `.git` directory. The policy also renders Docker Compose with every profile, checks every Dockerfile's final `USER`, and rejects host runtime sockets, recursive permission repair and privileged project builds. It reports violations and never changes ownership or modes.

Run `pnpm preflight:access` on the Brai host before deployment to require the workspace boundary to be owner-only and every scanned entry to be owned by the exact Linux account `mark:mark`. This host-only check intentionally fails on generic CI runners where that account does not exist; the portable consistency check remains part of `pnpm ci`.

The `@brai/deployment` test target separately renders the production Compose
model and proves that all seven images are digest references, no build context
or source bind exists, and the only published ports bind to loopback. It also
checks the fixed migration/health/rollback sequence and the protected GitHub
Environment handoff.
