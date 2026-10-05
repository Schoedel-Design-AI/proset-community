import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * An all-providers-failed conversion must never look like a successful empty one.
 *
 * The incident (Barry, 2026-10-01, Android production): a 33-second recording was
 * converted to a Project Plan. The request took 46s and came back 200 with no text; the
 * client stored a "Project Plan" conversion whose content was empty, so the result both
 * looked blank and was unrecoverable. Server-side every provider had failed — the two
 * primary lanes stalled past the 20s first-token deadline, the Groq route named a model
 * that does not exist, and the OpenAI fallback had no credits.
 *
 * Why it returned 200: `stream` and `usedRoute` are assigned BEFORE an attempt can fail,
 * so after a later attempt threw they still held an earlier attempt's values, and the
 * "all providers failed" check tested those instead of the outcome.
 *
 * Both halves are pinned here, in the live file and the CE override:
 *   - server: an explicit success flag decides, and a failed attempt clears its stream
 *   - client: an empty artifact is a failure, not a conversion to save
 */
const read = (path) => readFileSync(path, "utf8");

const SERVER_SOURCES = ["server/routes.ts", "scripts/ce-export/overrides/server/routes.ts"];
const CLIENT_SOURCES = [
  "app/recording/[id].tsx",
  "scripts/ce-export/overrides/app/recording/[id].tsx",
];

test("a failed provider chain returns an error instead of an empty artifact", () => {
  for (const file of SERVER_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /let conversionSucceeded = false;/,
      `${file}: the outcome needs its own flag`,
    );
    assert.match(
      source,
      /conversionSucceeded = true;\n\s+break; \/\/ success — exit the retry loop/,
      `${file}: only a real success may set it`,
    );
    assert.match(
      source,
      /stream = null;\n\s+usedRoute = null;/,
      `${file}: a failed attempt must clear the stream and route it set`,
    );
    assert.match(
      source,
      /if \(!conversionSucceeded \|\| !stream \|\| !usedRoute\) \{/,
      `${file}: the all-providers-failed check must test the outcome`,
    );
  }
});

test("the client refuses an empty artifact instead of saving it", () => {
  for (const file of CLIENT_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /const finalContent = event\.fullContent \|\| fullContent;\n\s+\/\/[\s\S]{0,400}?if \(!finalContent\.trim\(\)\) \{\n\s+throw new Error\(/,
      `${file}: an empty done payload must not become a stored conversion`,
    );
    // The guard has to sit BEFORE the conversion object is built and added, or the
    // blank card is already persisted by the time it fires.
    const guard = source.indexOf("if (!finalContent.trim()) {");
    const stored = source.indexOf("await addConversion(recording.id, conversion);");
    assert.ok(guard > 0 && stored > guard, `${file}: the guard must run before addConversion`);
  }
});
