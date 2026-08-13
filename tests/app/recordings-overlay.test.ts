import assert from "node:assert/strict";
import test from "node:test";

import { getFloatingRecordOverlaySpec } from "../../lib/recordings-overlay";

test("creates a larger spotlight pocket around the floating record button", () => {
  const spec = getFloatingRecordOverlaySpec(64);

  assert.equal(spec.buttonSize, 64);
  assert.ok(spec.spotlightSize > spec.buttonSize);
  assert.ok(spec.maskSize > spec.spotlightSize);
  assert.ok(spec.shellSize >= spec.maskSize);
  assert.ok(spec.spotlightInnerOpacity > spec.spotlightOuterOpacity);
  assert.ok(spec.maskInnerOpacity > spec.maskOuterOpacity);
});

test("scales the overlay pocket with custom button sizes", () => {
  const smallSpec = getFloatingRecordOverlaySpec(56);
  const largeSpec = getFloatingRecordOverlaySpec(72);

  assert.ok(largeSpec.spotlightSize > smallSpec.spotlightSize);
  assert.ok(largeSpec.maskSize > smallSpec.maskSize);
  assert.ok(largeSpec.shellSize > smallSpec.shellSize);
});