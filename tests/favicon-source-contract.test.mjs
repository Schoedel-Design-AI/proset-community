import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const canonicalFaviconPath = new URL("../public/favicon.png", import.meta.url);
const documentationFaviconPath = new URL(
  "../docs-site/static/img/favicon.png",
  import.meta.url,
);
const faviconReferenceFiles = [
  "../index.html",
  "../public/index.html",
  "../public/index-es.html",
  "../server/templates/landing-page.html",
];

test("the canonical public favicon is a 64px PNG", () => {
  const favicon = fs.readFileSync(canonicalFaviconPath);

  assert.equal(favicon.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(favicon.readUInt32BE(16), 64);
  assert.equal(favicon.readUInt32BE(20), 64);
});

test("the documentation site uses the canonical public favicon", () => {
  assert.deepEqual(
    fs.readFileSync(documentationFaviconPath),
    fs.readFileSync(canonicalFaviconPath),
  );

  const config = fs.readFileSync(
    new URL("../docs-site/docusaurus.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /favicon: ['"]\/img\/favicon\.png['"]/);
});

test("all Proset web entry points use the canonical public favicon", () => {
  for (const relativePath of faviconReferenceFiles) {
    const contents = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(contents, /href="\/favicon\.png"/, relativePath);
    assert.match(
      contents,
      /rel="apple-touch-icon" href="\/favicon\.png"/,
      relativePath,
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"),
  );
  const faviconIcon = manifest.icons.find((icon) => icon.sizes === "64x64");

  assert.equal(faviconIcon?.src, "/favicon.png");
});
