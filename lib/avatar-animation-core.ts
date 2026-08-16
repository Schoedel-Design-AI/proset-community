/**
 * Pure SVG layer-splitting for DiceBear animated avatars (2026-08-15).
 *
 * RN-free (no react-native import) so it can be unit-tested under Node.
 * See lib/avatar-animation.ts for the full design notes; this module only
 * owns the deterministic string-splitting of an animated DiceBear SVG into
 * a static base + per-element overlay layers.
 */

export type AvatarKeyframe = {
  /** Keyframe stops 0..1 (from the CSS percentages) */
  input: number[];
  /** Output values at each stop */
  output: number[];
};

export type AvatarAnimationSpec = {
  /** Cycle duration in seconds (from the CSS `animation:` declaration) */
  duration: number;
  /** What to animate on the Animated.View */
  prop: "opacity" | "translateY" | "rotate";
  keyframes: AvatarKeyframe;
};

/**
 * Class-name -> animation spec. Names are the DiceBear animation classes
 * probed from the rendered SVG of each pack (2026-08-15). The `medium`
 * variant is what the app requests (animationVariant: "medium").
 *
 * AMPLITUDES (2026-08-15 v2): DiceBear's CSS values are tuned for full-size
 * display — at 72px header size the bob (-2 units of 128) and sway (3°) were
 * sub-pixel and invisible (Barry: "eye movement but that is it"). translateY
 * values are now PHYSICAL-PIXEL targets (animatedLayerStyle scales by
 * 128/size at render, so a 5 = 5px of travel at ANY avatar size); rotations
 * are boosted to clearly visible angles. Blink stays an opacity dip (reads
 * identically to the CSS scaleY at avatar sizes, no transform-origin math).
 */
export const ANIMATION_SPECS: Record<string, AvatarAnimationSpec> = {
  // voxelBot / voxelArt: eyes flash (opacity), body stretch + head lift (translateY)
  "vb-blink-medium": {
    duration: 4.5,
    prop: "opacity",
    // 0%,92%,100% -> 0 ; 94%,98% -> 1
    keyframes: { input: [0, 0.92, 0.94, 0.98, 1], output: [0, 0, 1, 1, 0] },
  },
  "va-blink-medium": {
    duration: 4.5,
    prop: "opacity",
    keyframes: { input: [0, 0.92, 0.94, 0.98, 1], output: [0, 0, 1, 1, 0] },
  },
  "vb-upper": {
    duration: 7,
    prop: "translateY",
    // 0%,85.9%,96%,100% -> 0 ; 86%,95.9% -> -5px (physical, ~2x DiceBear)
    keyframes: { input: [0, 0.859, 0.86, 0.959, 0.96, 1], output: [0, 0, -5, -5, 0, 0] },
  },
  "va-upper": {
    duration: 7,
    prop: "translateY",
    keyframes: { input: [0, 0.859, 0.86, 0.959, 0.96, 1], output: [0, 0, -5, -5, 0, 0] },
  },
  "vb-head": {
    duration: 7,
    prop: "translateY",
    // 0%,86.9%,95%,100% -> 0 ; 87%,94.9% -> -5px
    keyframes: { input: [0, 0.869, 0.87, 0.949, 0.95, 1], output: [0, 0, -5, -5, 0, 0] },
  },
  // critters: body bob (translateY), tail sway (rotate), eyes blink (opacity)
  "dbcr-c": {
    duration: 3.4,
    prop: "translateY",
    // 0%,50%,100% -> 0 ; 25%,75% -> -4px (physical; was -2 units = ~1px)
    keyframes: { input: [0, 0.25, 0.5, 0.75, 1], output: [0, -4, 0, -4, 0] },
  },
  "dbcr-t": {
    duration: 5.2,
    prop: "rotate",
    // tail sway: 0 -> +10deg -> 0 (was 3deg = ~1px arc, invisible)
    keyframes: { input: [0, 0.5, 1], output: [0, 10, 0] },
  },
  "dbcr-eb": {
    duration: 4.6,
    prop: "opacity",
    keyframes: { input: [0, 0.92, 0.95, 0.97, 1], output: [1, 1, 0.15, 0.15, 1] },
  },
  // sprouts: plant sway (rotate), eyes blink (opacity)
  "dbsp-g": {
    duration: 4.4,
    prop: "rotate",
    // plant sway: 0 -> -8deg -> +8deg -> 0 (was 2.5deg)
    keyframes: { input: [0, 0.25, 0.75, 1], output: [0, -8, 8, 0] },
  },
  "dbsp-e": {
    duration: 4.6,
    prop: "opacity",
    keyframes: { input: [0, 0.92, 0.95, 0.97, 1], output: [1, 1, 0.15, 0.15, 1] },
  },
  // moods: eyes blink (opacity)
  "dbmo-eyes": {
    duration: 4.6,
    prop: "opacity",
    keyframes: { input: [0, 0.91, 0.94, 0.97, 1], output: [1, 1, 0.12, 0.12, 1] },
  },
};

export function getAnimationSpecForClass(className: string): AvatarAnimationSpec | undefined {
  return ANIMATION_SPECS[className];
}

export type AvatarLayer = {
  className: string;
  spec: AvatarAnimationSpec;
  /** Standalone SVG string (defs + element) for this overlay */
  xml: string;
  /** Element's approximate center in viewBox units (rotation pivot).
   *  Derived from the element's first `transform="translate(x y)"`; the
   *  CSS rotates around the element's fill-box center, and DiceBear draws
   *  use-referenced defs centered on that translate point. */
  originX?: number;
  originY?: number;
};

export type AnimatedAvatarSplit = {
  /** The full SVG with <style> and classed elements removed (static base) */
  baseXml: string;
  /** One overlay per extracted element (multiple elements can share a class) */
  layers: AvatarLayer[];
  /** viewBox copied from the source so every layer lines up */
  viewBox: string;
};

/**
 * Split an animated DiceBear SVG into a static base + animated overlays.
 * Returns null if the SVG has no style block (i.e. not an animated pack).
 * Robustness: any element that can't be extracted is skipped, never thrown.
 *
 * Two passes so nested classed elements survive:
 *   1. Collect ALL classed-element ranges first (positions stay valid).
 *   2. Build layers (outer elements exclude nested classed elements, which
 *      get their own overlays) and remove everything from the base at once.
 */
export function splitAnimatedAvatarSvg(svg: string): AnimatedAvatarSplit | null {
  const styleMatch = svg.match(/<style>[\s\S]*?<\/style>/);
  if (!styleMatch) return null;

  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 128 128";

  const defsMatch = svg.match(/<defs>[\s\S]*?<\/defs>/);
  const defs = defsMatch ? defsMatch[0] : "";

  // Strip the style block from everything we render (SvgXml ignores <style>
  // via missingTag, but keeping the SVG clean avoids surprises).
  const styleStripped = svg.replace(/<style>[\s\S]*?<\/style>/, "");

  // PASS 1: collect every classed element's exact range.
  // Lazy `[^>]*?` so a trailing `/` in the tag is captured by group 4
  // (self-closing detection). Group 3 = class attribute value.
  const ranges: { start: number; end: number; className: string; tagName: string }[] = [];
  const classRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?class="([^"]+)"[^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(styleStripped))) {
    const tagName = m[1];
    const className = m[3];
    if (!getAnimationSpecForClass(className)) continue;

    const start = m.index;
    let end = -1;
    if (m[4] === "/") {
      end = start + m[0].length; // self-closing: <path ... />
    } else {
      // Balanced single-pass scan for THIS tag name (g's nest; a failed exec
      // must NOT reset lastIndex — so scan with one regex and manual depth).
      const tagRe = new RegExp(`<(/?)${tagName}\\b[^>]*?(\\/?)>`, "g");
      tagRe.lastIndex = start + m[0].length;
      let depth = 1;
      let tm: RegExpExecArray | null;
      while ((tm = tagRe.exec(styleStripped))) {
        if (tm[1] === "/") {
          depth--;
          if (depth === 0) {
            end = tm.index + tm[0].length;
            break;
          }
        } else if (tm[2] !== "/") {
          depth++;
        }
      }
      if (end < 0) continue; // unbalanced — skip
    }

    ranges.push({ start, end, className, tagName });
  }

  if (ranges.length === 0) return null;

  // PASS 2: build layers + base. Process ranges in document order; an outer
  // element's layer excludes any nested classed element (those animate in
  // their own overlay). Removal is done bottom-up so indices stay valid.
  const layers: AvatarLayer[] = [];
  const removals: { start: number; end: number }[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    // Exclude nested classed ranges (all inside r that come after i)
    const nested = ranges
      .slice(i + 1)
      .filter((n) => n.start >= r.start && n.end <= r.end)
      .sort((a, b) => b.start - a.start);

    let elementXml = styleStripped.slice(r.start, r.end);
    for (const n of nested) {
      elementXml = elementXml.slice(0, n.start - r.start) + elementXml.slice(n.end - r.start);
    }

    // Rotation pivot: first translate(x y) inside the element (DiceBear
    // positions use-referenced defs with translate; that point ≈ fill-box
    // center). Skip chained matrix/rotate forms — translate-only is the
    // DiceBear convention for these classes.
    const trMatch = elementXml.match(/transform="translate\(([-\d.]+)[ ,]+([-\d.]+)\)"/);
    const originX = trMatch ? parseFloat(trMatch[1]) : undefined;
    const originY = trMatch ? parseFloat(trMatch[2]) : undefined;

    layers.push({
      className: r.className,
      spec: getAnimationSpecForClass(r.className)!,
      xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${defs}${elementXml}</svg>`,
      ...(originX !== undefined && originY !== undefined ? { originX, originY } : {}),
    });
    removals.push({ start: r.start, end: r.end });
  }

  // Remove all classed elements from the base (bottom-up keeps indices valid)
  let baseXml = styleStripped;
  for (const rm of removals.sort((a, b) => b.start - a.start)) {
    baseXml = baseXml.slice(0, rm.start) + baseXml.slice(rm.end);
  }

  return { baseXml, layers, viewBox };
}
