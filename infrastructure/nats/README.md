# NATS

Single-node NATS runs Core request/reply with JetStream enabled. Version 1 creates no streams. The file store is bounded to 1 GiB and persisted in the `brai-nats-data` Docker volume.

Gateway, Factory, `brai-access`, and the trusted runtime controller use four
separate credentials with exact subject permissions. Production values live
only in `/etc/brai-new/nats.env`.

The browser-facing Gateway may publish access requests but cannot publish any
server-only runtime subject. `brai-access` is the only publisher of launch,
exact run termination, and durable user-environment provisioning commands;
the runtime credential may subscribe to those exact subjects and may reply
only to the access-service inbox. Neither side receives wildcard permissions
outside its own inbox.
