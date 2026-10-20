import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, requireUser, routeError } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { db } from "@/lib/db";
import { extractDocumentText } from "@/lib/security/extract";
import { rateLimit } from "@/lib/security/rate-limit";
import { enqueueTask } from "@/lib/services/queue";

const maximumSize = 5 * 1024 * 1024;
const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    if (!rateLimit(`resume:${user.id}`, 10, 10 * 60_000)) throw new HttpError(429, "Too many uploads. Try again in a few minutes.");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a resume file.");
    if (!file.size || file.size > maximumSize) throw new HttpError(413, "Resume files must be between 1 byte and 5 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    // Declared type and file signature must agree; DOCX must also contain a Word document part.
    const pdf = file.type === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-";
    const docx = file.type === docxType && buffer.subarray(0, 4).toString("hex") === "504b0304" && buffer.includes("word/document.xml");
    const text = ["text/plain", "text/markdown"].includes(file.type) && !buffer.includes(0);
    if (!pdf && !docx && !text) throw new HttpError(400, "Only valid PDF, DOCX, Markdown, and plain-text resumes are accepted.");
    let sourceText: string;
    try { sourceText = pdf ? await extractDocumentText("pdf", buffer) : docx ? await extractDocumentText("docx", buffer) : buffer.toString("utf8"); }
    catch { throw new HttpError(422, "This file could not be read. Export it again as a text-based PDF or DOCX."); }
    sourceText = sourceText.replace(/\0/g, "").slice(0, 200_000).trim();
    if (!sourceText) throw new HttpError(422, "No readable text was found in this resume. Scanned images are not supported; upload a text-based file.");
    const extractionStatus = aiConfigured() ? "QUEUED" : "AI_NOT_CONFIGURED";
    const resume = await db.resume.create({ data: { userId: user.id, fileName: file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200), mimeType: file.type, size: file.size, contentHash: createHash("sha256").update(buffer).digest("hex"), sourceText, original: buffer, extractionStatus } });
    if (aiConfigured()) await enqueueTask("EXTRACT_RESUME", { id: resume.id }, `resume:${resume.id}`);
    return NextResponse.json({ resume: { id: resume.id, fileName: resume.fileName, createdAt: resume.createdAt, extractionStatus, characters: sourceText.length }, suggestions: null, extractionStatus }, { status: 202 });
  } catch (error) { return routeError(error); }
}
