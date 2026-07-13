#!/usr/bin/env node

// Compatibility entrypoint for environments that still invoke `node server.js`.
// The only supported server is the built, authenticated API runtime.

import fs from "node:fs";
import path from "node:path";

const entry = path.resolve("artifacts/api-server/dist/index.mjs");
if (!fs.existsSync(entry)) {
  console.error(
    "server.js: built API server not found. Run `pnpm run build:api` before starting.",
  );
  process.exit(78);
}

await import(entry);
