# Chrome DevTools Caddy authentication

The shared Chrome DevTools MCP Caddy-auth bridge deliberately uses an exact
host allowlist before it reads the protected credential file. After installing
or upgrading that bridge, add the Brai Factory production host with:

```bash
sudo node infrastructure/chrome-devtools/install-factory-caddy-auth.mjs --install
node infrastructure/chrome-devtools/install-factory-caddy-auth.mjs --check
```

The overlay adds `factory.brai.one` and `codegraph.brai.one`. It does not read, copy, or print the
Basic Auth username, password, or encoded Authorization header.
