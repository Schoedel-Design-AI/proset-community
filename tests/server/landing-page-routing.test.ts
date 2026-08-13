import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const landingTemplate = readFileSync(
  join(process.cwd(), "server/templates/landing-page.html"),
  "utf8",
);
const edgeWorker = readFileSync(
  join(process.cwd(), "pages/_worker.js"),
  "utf8",
);
const loginScreen = readFileSync(join(process.cwd(), "app/login.tsx"), "utf8");
const translations = readFileSync(join(process.cwd(), "lib/i18n.tsx"), "utf8");

test("landing login links route directly to login", () => {
  assert.match(landingTemplate, /href="\/login\?from=landing" data-i18n="nav-login"/);
});

test("landing sign-up links route to registration tab", () => {
  assert.match(landingTemplate, /href="\/login\?tab=signup&from=landing" id="nav-signup-button"/);
  assert.match(landingTemplate, /href="\/login\?tab=signup&from=landing" class="hero-cta" id="hero-cta-button"/);
  assert.match(landingTemplate, /signupBtn\.href = '\/login\?tab=signup&from=landing';/);
  assert.match(landingTemplate, /heroCta\.href = '\/login\?tab=signup&from=landing';/);
});

test("landing mobile language switcher is defined", () => {
  assert.match(landingTemplate, /class="mobile-lang-row"/);
  assert.match(landingTemplate, /id="lang-btn-en-mobile"/);
  assert.match(landingTemplate, /id="lang-btn-es-mobile"/);
  assert.match(landingTemplate, /getElementById\('lang-btn-en-mobile'\)/);
  assert.match(landingTemplate, /getElementById\('lang-btn-es-mobile'\)/);
});

test("landing presents concise public pricing in English and Spanish", () => {
  assert.match(landingTemplate, /id="pricing"/);
  assert.match(landingTemplate, /"pricing-title": "Choose your plan\."/);
  assert.match(landingTemplate, /"pricing-title": "Elige tu plan\."/);
  assert.match(landingTemplate, /<s>\$9\.99<\/s> \$5/);
  assert.match(landingTemplate, /<s>\$19\.99<\/s> \$10/);
  assert.match(landingTemplate, /Academic Pack · \$4\.99\/month value/);
  assert.match(landingTemplate, /Academic Pack · valor de \$4\.99\/mes/);
});

test("landing keeps free signup concise without publishing account allowances", () => {
  assert.doesNotMatch(landingTemplate, /hero-cta-trial-desc|hero-fine-trial/);
  assert.doesNotMatch(landingTemplate, /plan-free-feature-/);
  assert.doesNotMatch(
    landingTemplate,
    /3 transcriptions|5 conversions|3 transcripciones|5 conversiones/,
  );
});

test("registration does not publish free account allowances before use", () => {
  assert.doesNotMatch(loginScreen, /login\.trialLimits|free tier limits notice/);
  assert.doesNotMatch(
    translations,
    /Your free account includes|Tu cuenta gratuita incluye/,
  );
});

test("landing does not advertise unfinished task-tool integrations", () => {
  assert.doesNotMatch(landingTemplate, /Task Sync|Sincroniza tareas/);
  assert.doesNotMatch(landingTemplate, /Todoist|Linear|Asana|Google Tasks/);
  assert.match(landingTemplate, /"benefit-3-title": "Web & Android"/);
  assert.match(landingTemplate, /"benefit-3-title": "Web y Android"/);
});

test("landing uses concise conversion copy and canonical metadata", () => {
  assert.match(landingTemplate, /rel="canonical" href="https:\/\/proset\.ai\/"/);
  assert.match(landingTemplate, /landing-page\.css\?v=6/);
  assert.match(landingTemplate, /"hero-cta-default": "Start free"/);
  assert.match(landingTemplate, /"hero-cta-default": "Empieza gratis"/);
  assert.doesNotMatch(landingTemplate, /\\·/);
});

test("edge router sends public pricing requests to the landing pricing section", () => {
  assert.match(edgeWorker, /path === "\/pricing" \|\| path === "\/pricing\/"/);
  assert.match(edgeWorker, /Response\.redirect\(new URL\("\/#pricing", url\)\.toString\(\), 302\)/);
});

test("landing translation keys stay in English and Spanish parity", () => {
  const match = landingTemplate.match(/en:\s*\{([\s\S]*?)\n\s*\},\n\s*es:\s*\{([\s\S]*?)\n\s*\}\n\s*\};/);
  assert.ok(match, "translation object should contain English and Spanish blocks");
  const keys = (block: string) => [...block.matchAll(/^\s*"([^"]+)":/gm)].map((entry) => entry[1]);
  assert.deepEqual(keys(match[1]), keys(match[2]));
});
