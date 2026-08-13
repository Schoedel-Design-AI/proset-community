import assert from "node:assert/strict";
import test from "node:test";

import { getBucketResolvePath, resolveBucketUriWithBase } from "../../lib/bucket-uri";

test("encodes slash-delimited bucket keys in resolve paths", () => {
  assert.equal(
    getBucketResolvePath("users/example/audio/test.mp3"),
    "/api/bucket/resolve/users%2Fexample%2Faudio%2Ftest.mp3",
  );
});

test("resolves bucket URIs against a base URL with an encoded key", () => {
  assert.equal(
    resolveBucketUriWithBase("bucket://users/example/audio/test.mp3", "https://proset.ai/"),
    "https://proset.ai/api/bucket/resolve/users%2Fexample%2Faudio%2Ftest.mp3",
  );
});