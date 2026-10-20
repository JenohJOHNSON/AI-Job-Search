import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import { extractDocumentText } from "@/lib/security/extract";
import { parseMarkdown, runs, toDocx, toHtml, toPdf } from "@/lib/services/document-export";
import { buildJobFilter, number } from "@/lib/services/job-filter";

async function samplePdf(text: string) {
  const document = new PDFDocument(); const chunks: Buffer[] = []; document.on("data", chunk => chunks.push(chunk as Buffer)); document.text(text); document.end();
  await new Promise<void>(resolve => document.on("end", () => resolve())); return Buffer.concat(chunks);
}

describe("CV text extraction in a bounded worker thread", () => {
  it("reads a text PDF", async () => { expect(await extractDocumentText("pdf", await samplePdf("Synthetic CV. Data engineer with SSIS and SQL Server."))).toContain("SSIS and SQL Server"); });
  it("reads a DOCX", async () => {
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Synthetic CV. Python and Azure Data Factory.")] })] }] }));
    expect(await extractDocumentText("docx", buffer)).toContain("Python and Azure Data Factory");
  });
  it("rejects corrupt documents without crashing the caller", async () => {
    await expect(extractDocumentText("pdf", Buffer.from("%PDF-1.4 not really a pdf"))).rejects.toThrow();
    await expect(extractDocumentText("docx", Buffer.from("PK\u0003\u0004 garbage"))).rejects.toThrow();
  });
  it("enforces a hard timeout", async () => { await expect(extractDocumentText("pdf", await samplePdf("x"), 1)).rejects.toThrow(/too long|could not be read/); });
});

describe("generated document export", () => {
  const markdown = "# Lettre\n\nBonjour **l'équipe**,\nsuite du paragraphe.\n\n## Compétences\n- SQL Server\n- SSIS\n\nCordialement";
  it("parses headings, lists, paragraphs and inline bold", () => {
    expect(parseMarkdown(markdown)).toEqual([{ type: "h1", text: "Lettre" }, { type: "p", text: "Bonjour **l'équipe**, suite du paragraphe." }, { type: "h2", text: "Compétences" }, { type: "li", text: "SQL Server" }, { type: "li", text: "SSIS" }, { type: "p", text: "Cordialement" }]);
    expect(runs("a **b** c")).toEqual([{ text: "a ", bold: false }, { text: "b", bold: true }, { text: " c", bold: false }]);
  });
  it("escapes HTML so generated text can never inject markup", () => {
    const html = toHtml(parseMarkdown("# <script>alert(1)</script>\n- <img src=x onerror=alert(1)>"), "fr", "cv"); expect(html).not.toContain("<script>"); expect(html).not.toContain("<img"); expect(html).toContain("&lt;script&gt;");
  });
  it("produces real PDF and DOCX files", async () => {
    const blocks = parseMarkdown(markdown); const pdf = await toPdf(blocks); const docx = await toDocx(blocks);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(docx.subarray(0, 2).toString()).toBe("PK");
    expect(await extractDocumentText("docx", docx)).toContain("SQL Server"); expect(await extractDocumentText("pdf", pdf)).toContain("Compétences".slice(0, 5));
  });
});

describe("job list filters", () => {
  it("ignores malformed values instead of failing", () => {
    expect(() => buildJobFilter(new URLSearchParams("status=NOPE&score=abc&salaryMin=&publishedDays=x&view=x&remoteType=BAD"))).not.toThrow();
    expect(number("abc")).toBeNull(); expect(number("")).toBeNull(); expect(number("12")).toBe(12);
  });
  it("hides dismissed and closed jobs by default and exposes them through views", () => {
    expect(JSON.stringify(buildJobFilter(new URLSearchParams()))).toContain("dismissedAt");
    expect(JSON.stringify(buildJobFilter(new URLSearchParams("view=dismissed")))).toContain('"not":null');
    expect(JSON.stringify(buildJobFilter(new URLSearchParams("view=closed")))).toContain("REMOVED");
    expect(JSON.stringify(buildJobFilter(new URLSearchParams("view=all")))).toBe("{}");
  });
  it("applies score, source, work style and salary filters", () => {
    const filter = JSON.stringify(buildJobFilter(new URLSearchParams("score=70&provider=lever&remoteType=REMOTE&salaryMin=45000&view=all")));
    for (const part of ['"rankScore":{"gte":70}', '"provider":"lever"', '"remoteType":"REMOTE"', "45000"]) expect(filter).toContain(part);
  });
});
