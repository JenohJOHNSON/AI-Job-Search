import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { currentUser } from "@/lib/security/session";

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Authentication required.");
  return user;
}
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) throw new HttpError(403, "Origin rejected.");
}
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > 1_000_000) throw new HttpError(413, "Request is too large.");
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Invalid JSON."); }
  return schema.parse(value);
}
export function routeError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  console.error(JSON.stringify({ level: "error", message: "route_error", error: error instanceof Error ? error.message : "unknown" }));
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}
