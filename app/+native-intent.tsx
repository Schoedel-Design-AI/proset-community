export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  void initial;
  if (!path) return "/";
  if (path.startsWith("/")) return path;

  try {
    const url = new URL(path);
    const pathname = `/${[url.hostname, url.pathname.replace(/^\/+/, "")].filter(Boolean).join("/")}`;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return `/${path.replace(/^\/+/, "")}`;
  }
}
