import { NextRequest } from "next/server";
import { HttpError, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
type Context = { params: Promise<{ id: string }> };
// The original upload is preserved exactly as received; generated documents never overwrite it.
export async function GET(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const resume = await db.resume.findFirst({ where: { id, userId: user.id }, select: { fileName: true, mimeType: true, original: true, sourceText: true } });
    if (!resume) throw new HttpError(404, "Resume not found.");
    const body = resume.original ? new Uint8Array(resume.original) : new TextEncoder().encode(resume.sourceText);
    return new Response(body, { headers: { "Content-Type": resume.original ? resume.mimeType : "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${resume.fileName.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  } catch (error) { return routeError(error); }
}
