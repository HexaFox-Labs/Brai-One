-- Keep the service role bounded even when application-side pool settings are
-- missing or misconfigured. These are role defaults, so every direct and
-- pooled session starts with the same server-enforced limits.
ALTER ROLE brai_factory_runtime CONNECTION LIMIT 10;

ALTER ROLE brai_factory_runtime
  SET statement_timeout TO '4s';
ALTER ROLE brai_factory_runtime
  SET lock_timeout TO '2s';
ALTER ROLE brai_factory_runtime
  SET idle_in_transaction_session_timeout TO '5s';
