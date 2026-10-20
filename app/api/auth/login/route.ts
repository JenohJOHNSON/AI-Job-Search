import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { createSession } from "@/lib/security/session";
const schema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) }).strict();
// Verifying against a dummy hash for unknown emails keeps response time independent of whether the account exists.
let dummyHash: Promise<string> | undefined;
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!rateLimit(`login:${clientKey(request)}`, 8, 15 * 60_000)) throw new HttpError(429, "Too many login attempts. Try again later.");
    const input = await parseBody(request, schema); const email = input.email.toLowerCase();
    if (!rateLimit(`login-account:${email}`, 12, 15 * 60_000)) throw new HttpError(429, "Too many login attempts. Try again later.");
    const user = await db.user.findUnique({ where: { email } });
    dummyHash ??= hashPassword("not-a-real-password-for-timing-only");
    const valid = await verifyPassword(input.password, user?.passwordHash ?? await dummyHash);
    if (!user || !valid) throw new HttpError(401, "Email or password is incorrect.");
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email } });
  } catch (error) { return routeError(error); }
}
