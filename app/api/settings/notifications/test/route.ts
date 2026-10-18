import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { rateLimit } from "@/lib/security/rate-limit";
import { sendTestNotification } from "@/lib/services/notifications";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const { channel } = await parseBody(request, z.object({ channel: z.enum(["EMAIL", "TELEGRAM"]) }).strict());
    if (!rateLimit(`notify-test:${user.id}`, 5, 10 * 60_000)) throw new HttpError(429, "Too many test messages. Try again in a few minutes.");
    try { await sendTestNotification(channel); } catch (error) { throw new HttpError(502, `The test message could not be delivered: ${(error as Error).message}`); }
    return NextResponse.json({ sent: true });
  } catch (error) { return routeError(error); }
}
