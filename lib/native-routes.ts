/**
 * Native route table for the local navigation adapter (`lib/navigation.tsx`).
 *
 * React Navigation screens are registered under their *template* name
 * (`thought-thread/[id]`), but `router.push()` hands the adapter an already
 * *resolved* path (`/thought-thread/abc123`). Anything that is not translated
 * back to a registered screen name is silently dropped by
 * `navigationRef.navigate()` in a release build — the tap looks dead, with no
 * error and no visible feedback.
 *
 * That is exactly how issues #193 and #199 presented: the cloud icon on the
 * recording screen and the "+" on the Thought Threads screen both push
 * `/thought-thread/[id]`, and only `recording/[id]` had a translation.
 *
 * Every dynamic native route MUST be listed in `DYNAMIC_NATIVE_ROUTES`, and
 * every registered screen MUST be listed in `NATIVE_ROUTE_NAMES`. The contract
 * test `tests/lib/native-routes.test.ts` fails if this table and the navigator
 * in `lib/navigation.tsx` drift apart, so a new screen cannot regress into a
 * dead button again.
 */

export interface DynamicNativeRoute {
  /** Leading path segment of the resolved href, e.g. `thought-thread`. */
  prefix: string;
  /** Registered React Navigation screen name, e.g. `thought-thread/[id]`. */
  screen: string;
  /** Param name carried by the dynamic segment, e.g. `id`. */
  param: string;
}

export const NOT_FOUND_ROUTE = "+not-found";

export const DYNAMIC_NATIVE_ROUTES: readonly DynamicNativeRoute[] = [
  { prefix: "recording", screen: "recording/[id]", param: "id" },
  { prefix: "thought-thread", screen: "thought-thread/[id]", param: "id" },
];

/** Screen names registered on the native stack, in navigator order. */
export const NATIVE_ROUTE_NAMES: readonly string[] = [
  "index",
  "login",
  "record",
  "recordings",
  "combine",
  "thought-threads",
  "thought-thread/[id]",
  "recording/[id]",
  "files",
  "music",
  "settings",
  "settings/account",
  "settings/ai-config",
  "settings/integrations",
  "settings/preferences",
  "settings/developer",
  "admin",
  "privacy",
  "refund",
  "documentation",
  "terms",
  "reset-password",
  "force-change-password",
  "verify-email",
  "mfa-setup",
  "choose-plan",
  NOT_FOUND_ROUTE,
];

export interface NativeRouteTarget {
  screen: string;
  params: Record<string, string>;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function pathSegments(pathname: string): string[] {
  const [pathPart = ""] = pathname.split("?");
  return pathPart.split("/").filter(Boolean).map(decodeSegment);
}

function matchDynamicRoute(segments: string[]): { route: DynamicNativeRoute; value: string } | null {
  if (segments.length < 2) return null;
  const route = DYNAMIC_NATIVE_ROUTES.find((candidate) => candidate.prefix === segments[0]);
  if (!route || !segments[1]) return null;
  return { route, value: segments[1] };
}

/**
 * Params carried by the *path* of a resolved href, e.g. `{ id }` for
 * `/thought-thread/abc123`. Query-string params are handled separately.
 */
export function dynamicRouteParams(pathname: string): Record<string, string> {
  const matched = matchDynamicRoute(pathSegments(pathname));
  return matched ? { [matched.route.param]: matched.value } : {};
}

/**
 * Translate a resolved href (`/thought-thread/abc123?tab=source`) into the
 * registered screen name plus merged path and query params. Unknown paths
 * resolve to `+not-found` so a broken link shows the not-found screen instead
 * of failing silently.
 */
export function resolveNativeRoute(resolvedHref: string): NativeRouteTarget {
  const [pathPart = "", query = ""] = resolvedHref.split("?");
  const segments = pathSegments(pathPart);
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => {
    params[key] = value;
  });

  const matched = matchDynamicRoute(segments);
  if (matched) {
    params[matched.route.param] = matched.value;
    return { screen: matched.route.screen, params };
  }

  const screen = segments.join("/") || "index";
  if (!NATIVE_ROUTE_NAMES.includes(screen)) {
    return { screen: NOT_FOUND_ROUTE, params };
  }
  return { screen, params };
}
