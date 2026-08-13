#!/bin/sh
set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  echo "Waiting for PostgreSQL..."
  node <<'NODE'
const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
const deadline = Date.now() + 90_000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase() {
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.end();
      return;
    } catch (error) {
      try { await client.end(); } catch {}
      console.error(`Database not ready yet: ${error.message}`);
      await sleep(2_000);
    }
  }

  console.error("Database did not become ready within 90 seconds.");
  process.exit(1);
}

waitForDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
fi

if [ "${RUN_DB_MIGRATE:-0}" = "1" ]; then
  echo "Running Drizzle migrations..."
  npm run db:migrate
elif [ "${RUN_DB_PUSH:-0}" = "1" ]; then
  echo "Running Drizzle schema push (development only)..."
  npm run db:push
fi

exec node server_dist/index.js
