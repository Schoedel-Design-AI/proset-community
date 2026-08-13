import assert from "node:assert/strict";

const BACKEND_PORT = process.env.BACKEND_PORT || "5000";
const BASE_URL =
  process.env.SMOKE_TEST_BASE_URL || `http://localhost:${BACKEND_PORT}`;

const VALID_EMAIL = process.env.SMOKE_TEST_EMAIL || "";
const VALID_PASSWORD = process.env.SMOKE_TEST_PASSWORD || "";
const HAS_VALID_CREDS = Boolean(VALID_EMAIL && VALID_PASSWORD);

interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`  \u2713 ${name} (${Date.now() - start}ms)`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      name,
      passed: false,
      error: message,
      durationMs: Date.now() - start,
    });
    console.log(`  \u2717 ${name} (${Date.now() - start}ms)`);
    console.log(`    Error: ${message}`);
  }
}

function skip(name: string, reason: string): void {
  results.push({ name, passed: true, skipped: true, durationMs: 0 });
  console.log(`  - ${name} (skipped: ${reason})`);
}

async function fetchManual(path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { redirect: "manual" });
}

async function waitForPort(url: string, timeoutMs = 60000, intervalMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function main() {
  console.log(`\nWaiting for backend at ${BASE_URL} to be ready...`);
  await waitForPort(BASE_URL);
  console.log("Backend is ready.");

  const totalStart = Date.now();

  console.log(`\nSmoke Tests \u2014 ${BASE_URL}`);
  if (!HAS_VALID_CREDS) {
    console.log(
      "  (Set SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD for valid-login tests)\n",
    );
  } else {
    console.log("");
  }

  console.log("Group 1: Health Check");

  await test("GET /health returns healthy with subsystem checks", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.status, "healthy", `Status was "${body.status}"`);
    assert.ok(body.timestamp, "Missing timestamp field");
    assert.ok(body.checks, "Missing checks object");

    for (const subsystem of ["database", "stripe", "email", "auth"]) {
      assert.ok(
        body.checks[subsystem],
        `Missing ${subsystem} check in response`,
      );
    }

    assert.equal(body.checks.database.status, "ok", "Database check not ok");
    assert.ok(
      typeof body.checks.database.latencyMs === "number",
      "Missing database latency metric",
    );
    assert.equal(body.checks.auth.status, "ok", "Auth check not ok");
  });

  await test("GET /api/health returns ok with uptime, memory, and deployment metadata", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(typeof body.uptime, "number", "uptime is not a number");
    assert.ok(body.uptime > 0, "uptime should be positive");
    assert.equal(typeof body.memoryMB, "number", "memoryMB is not a number");
    assert.ok(body.memoryMB > 0, "memoryMB should be positive");
    assert.ok(body.deployment, "deployment metadata is missing");
    assert.equal(typeof body.deployment.version, "string", "deployment version is not a string");
    assert.ok("gitSha" in body.deployment, "deployment.gitSha field is missing");
  });

  console.log("\nGroup 2: Deep Link Routes Serve SPA");

  const deepLinkRoutes = [
    "/reset-password",
    "/verify-email",
    "/login",
    "/settings",
  ];

  for (const route of deepLinkRoutes) {
    await test(`${route} serves Expo SPA HTML directly`, async () => {
      const res = await fetch(`${BASE_URL}${route}`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const html = await res.text();
      assert.ok(html.includes("<html"), "Response is not HTML");
      assert.ok(html.includes("<script"), "SPA script tags missing");
    });
  }

  await test("deep-link route preserves query string in SPA", async () => {
    const res = await fetch(
      `${BASE_URL}/reset-password?token=smoke_test_token_123`,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const html = await res.text();
    assert.ok(html.includes("<html"), "Response is not HTML");
  });

  console.log("\nGroup 3: Login Flow");

  await test("GET /app/login serves Expo SPA HTML", async () => {
    const res = await fetch(`${BASE_URL}/app/login`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") || "";
    assert.ok(ct.includes("text/html"), `Content-Type: ${ct}`);
    const html = await res.text();
    assert.ok(
      html.includes("<!DOCTYPE html>") || html.includes("<html"),
      "Response is not HTML",
    );
    assert.ok(html.includes("<script"), "SPA script tags missing");
  });

  await test(
    "POST /api/auth/sign-in/email rejects invalid credentials",
    async () => {
      const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "smoke-test-invalid@nonexistent-domain.test",
          password: "InvalidPassword123!",
        }),
      });
      assert.ok(res.status >= 400, `Expected 4xx, got ${res.status}`);
      const body = await res.json();
      assert.ok(
        body.message || body.error || body.code,
        "Response missing error details",
      );
    },
  );

  if (HAS_VALID_CREDS) {
    await test(
      "POST /api/auth/sign-in/email succeeds with valid credentials",
      async () => {
        const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: VALID_EMAIL,
            password: VALID_PASSWORD,
          }),
        });
        assert.ok(
          res.status >= 200 && res.status < 300,
          `Expected 2xx, got ${res.status}`,
        );
        const body = await res.json() as { token?: string; user?: { id?: string } };
        const setCookie = res.headers.get("set-cookie") || "";
        assert.ok(
          Boolean(body.token) || setCookie.length > 0,
          "No bearer token or session cookie returned after valid login",
        );
        const sessionHeaders: Record<string, string> = body.token
          ? { Authorization: `Bearer ${body.token}` }
          : { Cookie: setCookie.split(";")[0] };
        const sessionRes = await fetch(`${BASE_URL}/api/auth/me`, {
          headers: sessionHeaders,
        });
        assert.equal(
          sessionRes.status,
          200,
          `Authenticated session verification returned ${sessionRes.status}`,
        );
        const sessionBody = await sessionRes.json() as { id?: string; user?: { id?: string } };
        assert.ok(
          sessionBody.id || sessionBody.user?.id || body.user?.id,
          "Authenticated session response is missing a user ID",
        );
      },
    );
  } else {
    skip(
      "valid-login + session verification",
      "SMOKE_TEST_EMAIL / SMOKE_TEST_PASSWORD not set",
    );
  }

  console.log("\nGroup 4: Password Reset Flow");

  await test(
    "POST /api/auth/forget-password returns 200 or 429 (rate-limited)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/auth/forget-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "smoke-test-reset@nonexistent-domain.test",
        }),
      });
      assert.ok(
        res.status === 200 || res.status === 429,
        `Expected 200 or 429 (rate-limited), got ${res.status}`,
      );
    },
  );

  await test(
    "GET /api/auth/check-reset-token returns valid:false for bad token",
    async () => {
      const res = await fetch(
        `${BASE_URL}/api/auth/check-reset-token?token=invalid_smoke_token`,
      );
      assert.equal(res.status, 200);
      const body = await res.json() as { valid: boolean };
      assert.equal(body.valid, false, "Expected valid:false for invalid token");
    },
  );

  await test("GET /app/reset-password serves Expo SPA HTML", async () => {
    const res = await fetch(`${BASE_URL}/app/reset-password`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("<html"), "Response is not HTML");
    assert.ok(html.includes("<script"), "SPA script tags missing");
  });

  await test(
    "GET /app/reset-password?token=invalid serves page without crash",
    async () => {
      const res = await fetch(
        `${BASE_URL}/app/reset-password?token=invalid_smoke_test_token`,
      );
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const html = await res.text();
      assert.ok(html.includes("<html"), "Response is not HTML");
      assert.ok(html.includes("<script"), "SPA script tags missing");
    },
  );

  console.log("\nGroup 5: Email Verification Flow");

  await test("/verify-email serves Expo SPA HTML directly", async () => {
    const res = await fetch(`${BASE_URL}/verify-email`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const html = await res.text();
    assert.ok(html.includes("<html"), "Response is not HTML");
    assert.ok(html.includes("<script"), "SPA script tags missing");
  });

  await test("GET /app/verify-email serves Expo SPA HTML", async () => {
    const res = await fetch(`${BASE_URL}/app/verify-email`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("<html"), "Response is not HTML");
    assert.ok(html.includes("<script"), "SPA script tags missing");
  });

  const totalMs = Date.now() - totalStart;
  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n" + "\u2550".repeat(50));
  const parts = [`${passed} passed`, `${failed} failed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  console.log(`Results: ${parts.join(", ")} (${totalMs}ms total)`);
  console.log("\u2550".repeat(50));

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((f) => !f.passed)) {
      console.log(`  \u2717 ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log("\nAll smoke tests passed!");
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Smoke test runner failed:", message);
  process.exit(1);
});
