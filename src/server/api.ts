import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { ServiceError } from "./services/common";

/** Wraps a route handler body with consistent error responses. */
export async function apiHandler(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api] unexpected error", e);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}

/** RFC 6266 filename encoding for Content-Disposition. */
export function contentDisposition(type: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
