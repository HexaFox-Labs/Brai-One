# User project routing domain

This package is the deterministic, credential-free domain boundary for user
project ingress. The trusted authentication adapter imports
`@brai/user-project-routing/trusted-adapter` and creates a symbol-branded,
module-registered actor context only after server-side authentication. Plain
JSON, JSON round-trips, and copied symbol properties cannot create a trusted
context. Command schemas reject caller-supplied actor, owner, context, or access
profile fields. Project/environment ownership is always loaded from the
repository.

The domain emits active desired state as only:

```text
valid_until + hostname -> { environment_id, port }
```

It never accepts an upstream hostname/IP/path/socket, and never handles Caddy,
DNS-provider, Docker, NATS, or platform credentials. A separate trusted ingress
controller may consume `buildDesiredState()` and resolve an `environment_id`
through its own inventory.

## Persistence contract

Repository adapters must implement the documented atomic compare-and-set and
hostname uniqueness contract. Every write rechecks current project/environment
ownership inside the same transaction, including after asynchronous DNS
verification. Generated-route creation, challenge creation, challenge
activation, revoke, and delete are retry-safe. A matching retry is idempotent;
a different intent for the same canonical hostname is a collision. Desired
state comes from a consistent ownership join and excludes ownership-lost routes.
Every desired-state document is a short lease. The ingress controller must
remove it at `valid_until` unless a newer document arrives; a stale controller
therefore cannot preserve routes forever.

Custom domains stay inactive until the injected trusted verifier returns an
exact receipt for the stored challenge. All `brightos.world` names are reserved
for platform-generated routes; custom-domain input cannot claim technical
subdomains. Each desired-state refresh rechecks the exact ownership proof for
every custom domain. A missing, stale, mismatched, or failed DNS proof omits that
route, and the preceding desired-state lease expires within five minutes by
default.

An activated challenge is also the hard upper bound for that proof: after its
`expires_at`, the route is omitted even if the old TXT value still exists. A
route can continue only after deletion and a new verification with a freshly
generated token. This first foundation deliberately prefers a bounded manual
renewal over treating one old TXT record as permanent proof of DNS control. A
future controller may make nonce rotation seamless, but it may not extend the
old proof deadline.

Expired custom proof and lost project ownership also stop reserving a hostname.
Every atomic route/challenge reservation first tombstones stale routes and
cancels stale pending challenges in the same repository transaction. This keeps
history without allowing an abandoned user or project to squat a generated or
custom hostname forever.

## Deliberate limitations

- This package does not mutate Caddy or DNS and does not contain a controller.
- It defines the repository contract but not a production database adapter.
- It does not decide how an environment is connected to the ingress network.
- TLS issuance, rate limits, abuse controls, and DNS propagation retry policy
  belong to the future ingress controller, not this domain.
