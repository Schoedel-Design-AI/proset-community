/**
 * Reads the user-facing reason out of an auth endpoint error body.
 *
 * The auth routes answer with more than one shape:
 *   "…"                                  — a bare string
 *   { error: "…", code: "…" }            — most routes, including the closed
 *                                          legacy credential endpoints
 *   { error: { message: "…", code } }    — nested form
 *
 * Reading only `error.message` lost the first two shapes: the caller fell back
 * to its generic "Login failed" string and the server's real reason never
 * reached the user. Extracting is separated from mapping so this stays provable
 * by a unit test rather than by reading the component.
 */
export type AuthErrorBodyRead = {
  message: string;
  code: string;
};

export function readAuthErrorBody(data: unknown): AuthErrorBodyRead {
  if (typeof data === "string") {
    return { message: data, code: "" };
  }
  if (!data || typeof data !== "object") {
    return { message: "", code: "" };
  }

  const body = data as { error?: unknown; message?: unknown; code?: unknown };
  const code = typeof body.code === "string" ? body.code : "";

  if (typeof body.error === "string") {
    return { message: body.error, code };
  }

  if (body.error && typeof body.error === "object") {
    const nested = body.error as { message?: unknown; error?: unknown; code?: unknown };
    const nestedCode = typeof nested.code === "string" ? nested.code : code;
    if (typeof nested.message === "string") {
      return { message: nested.message, code: nestedCode };
    }
    if (typeof nested.error === "string") {
      return { message: nested.error, code: nestedCode };
    }
    return { message: "", code: nestedCode };
  }

  if (typeof body.message === "string") {
    return { message: body.message, code };
  }

  return { message: "", code };
}
