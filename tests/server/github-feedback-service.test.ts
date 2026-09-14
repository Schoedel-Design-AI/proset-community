import assert from "node:assert/strict";
import test from "node:test";
import { buildIssueDescription } from "../../server/github-feedback-service";

const base = {
  category: "Bug",
  message: "Downloading conversions is silent.",
  userName: "Barry",
  userEmail: "schoedelb@gmail.com",
  reportedFrom: "Android app 1.0.69 (build 106) · Android 17 · Pixel 10 Pro XL",
  accountSurfaces: "Android + Web",
  crossSurface: true,
};

test("feedback issue body embeds a single screenshot as a hosted image URL", () => {
  const body = buildIssueDescription({
    ...base,
    imageUrls: ["https://proset.ai/api/feedback/image/2026-09-04/00000000-0000-4000-8000-000000000000.png"],
  });

  assert.match(body, /## Screenshot/);
  assert.match(
    body,
    /!\[Screenshot\]\(https:\/\/proset\.ai\/api\/feedback\/image\/2026-09-04\/00000000-0000-4000-8000-000000000000\.png\)/,
  );
});

test("feedback issue body embeds multiple screenshots", () => {
  const body = buildIssueDescription({
    ...base,
    imageUrls: [
      "https://proset.ai/api/feedback/image/2026-09-04/aaaaaa-1.png",
      "https://proset.ai/api/feedback/image/2026-09-04/bbbbbb-2.jpg",
    ],
  });

  assert.match(body, /## Screenshots/); // plural heading
  assert.match(body, /!\[Screenshot\]\(https:\/\/proset\.ai\/api\/feedback\/image\/2026-09-04\/aaaaaa-1\.png\)/);
  assert.match(body, /!\[Screenshot\]\(https:\/\/proset\.ai\/api\/feedback\/image\/2026-09-04\/bbbbbb-2\.jpg\)/);
});

test("feedback issue body omits the screenshot section when no image is attached", () => {
  const body = buildIssueDescription({
    category: "Design",
    message: "Post-conversion view could use more spacing.",
  });

  assert.doesNotMatch(body, /## Screenshot/);
  assert.doesNotMatch(body, /!\[Screenshot\]/);
  assert.match(body, /## Message/);
  assert.match(body, /Post-conversion view could use more spacing/);
});
