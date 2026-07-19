import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(new URL("../..", import.meta.url).pathname);
const previewFile = resolve(projectRoot, "infrastructure/caddy/delivery.caddy");
const devFile = resolve(projectRoot, "infrastructure/caddy/delivery-dev.caddy");

const preview = Array.from({ length: 20 }, (_, index) => route(index + 1)).join(
  "\n\n",
);
const prefix = `# BEGIN BRAI-NEW DELIVERY\n\n${preview}`;
const suffix = "\n\n# END BRAI-NEW DELIVERY\n";
await writeFile(previewFile, `${prefix}${suffix}`, "utf8");
await writeFile(devFile, `${prefix}\n\n${devRoute()}${suffix}`, "utf8");

/** @param {number} slot */
function route(slot) {
  const padded = String(slot).padStart(2, "0");
  const host = `preview-${padded}.brai.one`;
  return `http://${host} {
  redir https://${host}{uri} permanent
}

${host} {
  tls {
    issuer acme {
      disable_http_challenge
    }
  }

  encode zstd gzip

  header {
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    X-Frame-Options "DENY"
  }

  # The public edge prefix is intentionally removed before the loopback-only
  # controller: its fixed HTTP contract starts at /v1, not at a Caddy path.
  handle_path /__brai-delivery/* {
    reverse_proxy 127.0.0.1:3490
  }

  @api path /api/*
  handle @api {
    import brai_unified_basic_auth
    reverse_proxy 127.0.0.1:${3510 + slot} {
      header_up -Authorization
    }
  }

  handle {
    import brai_unified_basic_auth
    reverse_proxy 127.0.0.1:${3410 + slot} {
      header_up -Authorization
    }
  }
}`;
}

function devRoute() {
  return `http://dev.brai.one {
  redir https://dev.brai.one{uri} permanent
}

dev.brai.one {
  tls {
    issuer acme {
      disable_http_challenge
    }
  }

  encode zstd gzip

  header {
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    X-Frame-Options "DENY"
  }

  @api path /api/*
  handle @api {
    import brai_unified_basic_auth
    reverse_proxy 127.0.0.1:3500 {
      header_up -Authorization
    }
  }

  handle {
    import brai_unified_basic_auth
    reverse_proxy 127.0.0.1:3400 {
      header_up -Authorization
    }
  }
}`;
}
