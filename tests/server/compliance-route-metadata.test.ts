import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

// Regression guard for server/index.ts compliance-route metadata. The SPA
// shell (web-build/index.html) serves the landing marketing title on every
// route; Google Play's data-safety fetcher and crawlers read the static
// HTML without running JS, so /privacy, /refund, /terms must get a
// route-specific <title> + meta description server-side.
const server = readFileSync(join(process.cwd(), "server", "index.ts"), "utf8");

const complianceRoutes = ["/privacy", "/refund", "/terms"];

test("compliance routes get server-side route-specific titles", () => {
  assert.match(server, /compliancePageMeta/);
  for (const route of complianceRoutes) {
    assert.ok(
      server.includes(`"${route}": {`),
      `${route} missing from compliancePageMeta in server/index.ts`,
    );
  }
});

test("compliance titles are bilingual and branded", () => {
  // EN + ES titles present, each containing "Proset"
  for (const route of complianceRoutes) {
    const block = server.slice(
      server.indexOf(`"${route}": {`),
      server.indexOf("\n      },", server.indexOf(`"${route}": {`)),
    );
    for (const field of ["enTitle", "esTitle", "enDescription", "esDescription"]) {
      assert.ok(block.includes(`${field}: "`), `${route} missing ${field}`);
    }
    assert.match(block, /enTitle: "[^"]*Proset"/);
    assert.match(block, /esTitle: "[^"]*Proset"/);
  }
});

test("compliance shell replaces all marketing meta tags", () => {
  // Substring checks (not regex) — the source's own regex literal contains
  // escaped slashes (\/) that are easy to mis-escape in a test regex.
  const required = [
    `/<title>`,                  // <title>
    `<meta name="description"`,  // meta description
    `og:title`,                  // og:title
    `og:description`,            // og:description
    `twitter:title`,             // twitter:title
    `twitter:description`,       // twitter:description
    `complianceShellCache`,      // cache
  ];
  for (const fragment of required) {
    assert.ok(server.includes(fragment), `missing replacement for: ${fragment}`);
  }
});
