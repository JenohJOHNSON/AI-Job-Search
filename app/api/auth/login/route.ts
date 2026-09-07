import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/security/password";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSession } from "@/lib/security/session";
const schema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) }).strict();
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const key = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"; if (!rateLimit(`login:${key}`, 8, 15 * 60_000)) throw new HttpError(429, "Too many login attempts. Try again later."); const input = await parseBody(request, schema); const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } }); if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, "Email or password is incorrect."); await createSession(user.id); return NextResponse.json({ user: { id: user.id, email: user.email } }); } catch (error) { return routeError(error); } }
