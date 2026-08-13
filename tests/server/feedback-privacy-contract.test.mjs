import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routesSource = await readFile(
  new URL("../../server/routes.ts", import.meta.url),
  "utf8",
);

test("feedback creates an internal GitHub issue without exposing its URL", () => {
  const routeStart = routesSource.indexOf('app.post("/api/feedback"');
  const routeEnd = routesSource.indexOf("const requireAdmin", routeStart);
  const feedbackRoute = routesSource.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0, "feedback route must exist");
  assert.match(feedbackRoute, /await createFeedbackGitHubIssue\(feedbackOpts\)/);
  assert.match(feedbackRoute, /res\.json\(\{ success: true \}\)/);
  assert.doesNotMatch(feedbackRoute, /workItemUrl/);
  assert.doesNotMatch(feedbackRoute, /web_url/);
});
