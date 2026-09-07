import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, routeError } from "@/lib/api";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { emptyCandidateProfile } from "@/lib/schemas";
import { hashPassword } from "@/lib/security/password";
import { createSession } from "@/lib/security/session";
import { ensureProviders } from "@/lib/services/providers";
const schema = z.object({ email: z.string().email().max(320), password: z.string().min(12).max(200), setupSecret: z.string().min(1).max(500) }).strict();
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const input = await parseBody(request, schema); if (await db.user.count()) throw new HttpError(409, "Initial setup is already complete."); if (!equal(input.setupSecret, config().SETUP_SECRET)) throw new HttpError(403, "The setup secret is invalid."); const user = await db.user.create({ data: { email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), profile: { create: { data: emptyCandidateProfile } } } }); await ensureProviders(); await createSession(user.id); return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 }); } catch (error) { return routeError(error); } }
