import { NextRequest } from "next/server";
import { HttpError, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { parseMarkdown, toDocx, toHtml, toPdf } from "@/lib/services/document-export";
type Context = { params: Promise<{ id: string }> };
const attachment = (name: string) => ({ "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const document = await db.generatedDocument.findFirst({ where: { id, userId: user.id } });
    if (!document) throw new HttpError(404, "Document not found.");
    const format = request.nextUrl.searchParams.get("format") ?? "md"; const base = `${document.kind}-${document.language}-v${document.version}`.replace(/[^a-z0-9-]/gi, "_"); const blocks = parseMarkdown(document.markdown);
    if (format === "html") return new Response(toHtml(blocks, document.language, document.kind), { headers: { "Content-Type": "text/html; charset=utf-8", ...attachment(`${base}.html`) } });
    if (format === "pdf") return new Response(new Uint8Array(await toPdf(blocks)), { headers: { "Content-Type": "application/pdf", ...attachment(`${base}.pdf`) } });
    if (format === "docx") return new Response(new Uint8Array(await toDocx(blocks)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ...attachment(`${base}.docx`) } });
    if (format !== "md") throw new HttpError(400, "Unsupported format. Use md, html, pdf or docx.");
    return new Response(document.markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8", ...attachment(`${base}.md`) } });
  } catch (error) { return routeError(error); }
}
