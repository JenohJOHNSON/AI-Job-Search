import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";

// Generated documents are stored as Markdown; these helpers render the same content to HTML, PDF and DOCX.
export type Block = { type: "h1" | "h2" | "h3" | "li" | "p"; text: string };
export type Run = { text: string; bold: boolean };

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []; let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") }); paragraph = []; };
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim(); const heading = line.match(/^(#{1,3})\s+(.*)$/); const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!line) flush();
    else if (heading) { flush(); blocks.push({ type: `h${heading[1]!.length}` as Block["type"], text: heading[2]! }); }
    else if (item) { flush(); blocks.push({ type: "li", text: item[1]! }); }
    else paragraph.push(line);
  }
  flush(); return blocks;
}
export function runs(text: string): Run[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part.replace(/[*_`]/g, ""), bold: false });
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function toHtml(blocks: Block[], language: string, title: string) {
  const inline = (text: string) => runs(text).map(run => run.bold ? `<strong>${escapeHtml(run.text)}</strong>` : escapeHtml(run.text)).join("");
  let html = ""; let open = false;
  for (const block of blocks) {
    if (block.type !== "li" && open) { html += "</ul>"; open = false; }
    if (block.type === "li") { if (!open) { html += "<ul>"; open = true; } html += `<li>${inline(block.text)}</li>`; } else html += `<${block.type === "p" ? "p" : block.type}>${inline(block.text)}</${block.type === "p" ? "p" : block.type}>`;
  }
  if (open) html += "</ul>";
  return `<!doctype html><html lang="${escapeHtml(language)}"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body><main style="max-width:48rem;margin:3rem auto;padding:0 1rem;font:16px/1.55 system-ui,sans-serif;color:#1c1c1c">${html}</main></body></html>`;
}

export async function toPdf(blocks: Block[]) {
  const document = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 54, left: 58, right: 58 }, info: { Title: "Élan generated document" } });
  const chunks: Buffer[] = []; document.on("data", chunk => chunks.push(chunk as Buffer));
  const sizes = { h1: 18, h2: 14, h3: 12, p: 10.5, li: 10.5 } as const;
  for (const block of blocks) {
    const parts = runs(block.text); const heading = block.type.startsWith("h"); const size = sizes[block.type];
    if (heading) document.moveDown(0.6);
    parts.forEach((part, index) => document.font(heading || part.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).text((block.type === "li" && index === 0 ? "•  " : "") + part.text, { continued: index < parts.length - 1, indent: block.type === "li" ? 12 : 0, lineGap: 3 }));
    document.moveDown(heading ? 0.3 : 0.5);
  }
  document.end(); await new Promise<void>((resolve, reject) => { document.on("end", resolve); document.on("error", reject); });
  return Buffer.concat(chunks);
}

export async function toDocx(blocks: Block[]) {
  const levels = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;
  const children = blocks.map(block => new Paragraph({ ...(block.type in levels ? { heading: levels[block.type as keyof typeof levels] } : {}), ...(block.type === "li" ? { bullet: { level: 0 } } : {}), spacing: { after: 120 }, children: runs(block.text).map(run => new TextRun({ text: run.text, bold: run.bold })) }));
  return Packer.toBuffer(new Document({ creator: "Élan", title: "Élan generated document", sections: [{ children }] }));
}
