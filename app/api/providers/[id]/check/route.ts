import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { checkProvider } from "@/lib/services/providers";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const { id } = await context.params;
    if (!rateLimit(`provider-check:${user.id}`, 20, 10 * 60_000)) throw new HttpError(429, "Too many connectivity checks. Try again in a few minutes.");
    if (!(await db.providerSetting.count({ where: { id } }))) throw new HttpError(404, "Provider not found.");
    return NextResponse.json(await checkProvider(id));
  } catch (error) { return routeError(error); }
}
