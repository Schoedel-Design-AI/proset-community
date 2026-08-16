import assert from "node:assert/strict";
import test from "node:test";
import { getAuthenticatorDisplayName, getAuthenticatorQrLabel } from "../../lib/auth-env-label";

function withDomain(domain: string | undefined, run: () => void) {
  const prev = process.env.AIFORMS_PUBLIC_DOMAIN;
  if (domain === undefined) delete process.env.AIFORMS_PUBLIC_DOMAIN;
  else process.env.AIFORMS_PUBLIC_DOMAIN = domain;
  try {
    run();
  } finally {
    if (prev === undefined) delete process.env.AIFORMS_PUBLIC_DOMAIN;
    else process.env.AIFORMS_PUBLIC_DOMAIN = prev;
  }
}

test("staging domain yields 'Proset Staging' factor name", () => {
  withDomain("stage.example.com", () => {
    assert.equal(getAuthenticatorDisplayName(), "Proset Staging");
    assert.equal(getAuthenticatorQrLabel(), "Proset Staging");
  });
});

test("production domain yields 'Proset' factor name", () => {
  withDomain("proset.ai", () => {
    assert.equal(getAuthenticatorDisplayName(), "Proset");
  });
});

test("unknown or missing domain falls back to 'Proset'", () => {
  withDomain(undefined, () => {
    assert.equal(getAuthenticatorDisplayName(), "Proset");
  });
  withDomain("localhost:8081", () => {
    assert.equal(getAuthenticatorDisplayName(), "Proset");
  });
});
