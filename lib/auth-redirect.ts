export function buildReturnTo(pathname: string, params?: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry !== null && entry !== undefined) search.append(key, entry);
        }
      } else {
        search.set(key, value);
      }
    }
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildReturnToFromSearch(pathname: string, search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return pathname;

  const params = new URLSearchParams(query);
  const normalized: Record<string, string | string[]> = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    normalized[key] = values.length > 1 ? values : values[0] || "";
  }

  return buildReturnTo(pathname, normalized);
}

export function resolvePostLoginRoute(returnTo?: string | string[] | null): string {
  const candidate = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (!candidate || typeof candidate !== "string") return "/";
  if (!candidate.startsWith("/")) return "/";
  const normalizedCandidate = candidate.toLowerCase();
  if (
    normalizedCandidate.startsWith("//") ||
    normalizedCandidate === "/login" ||
    normalizedCandidate.startsWith("/login/") ||
    normalizedCandidate.startsWith("/login?") ||
    normalizedCandidate.startsWith("/login#")
  ) {
    return "/";
  }
  return candidate;
}
