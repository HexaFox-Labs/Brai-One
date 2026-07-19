# Workers

Background workers live here. A worker joins `brai-supabase` only when it belongs to a database-owning bounded context and receives that context's least-privilege database role. All application communication with other services still goes through NATS.
