import { Worker } from "node:worker_threads";

// Untrusted documents are parsed in a short-lived worker thread with a memory cap and a hard timeout, so a malformed or
// hostile file can only kill that thread, never the web process. PDFs use the maintained pdf.js "legacy" build (no canvas,
// eval and font loading disabled); DOCX uses mammoth. The page count is bounded as well.
const source = `
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
async function pdfText(data) {
  const entry = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "legacy", "build", "pdf.mjs");
  const pdfjs = await import(pathToFileURL(entry).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  let text = "";
  for (let number = 1; number <= Math.min(document.numPages, 100); number++) {
    const content = await (await document.getPage(number)).getTextContent();
    text += content.items.map(item => (item.str || "") + (item.hasEOL ? "\\n" : " ")).join("") + "\\n";
  }
  await document.destroy();
  return text;
}
(async () => {
  try {
    const data = Buffer.from(workerData.data);
    const text = workerData.kind === "pdf" ? await pdfText(data) : (await require("mammoth").extractRawText({ buffer: data })).value;
    parentPort.postMessage({ ok: true, text });
  } catch (error) { parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }); }
})();`;

export type ResumeKind = "pdf" | "docx";

export function extractDocumentText(kind: ResumeKind, data: Buffer, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { kind, data }, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("The document took too long to read.")); }, timeoutMs);
    const done = (callback: () => void) => { clearTimeout(timer); void worker.terminate(); callback(); };
    worker.once("message", (message: { ok: boolean; text?: string; error?: string }) => done(() => message.ok ? resolve(message.text ?? "") : reject(new Error(message.error || "The document could not be read."))));
    worker.once("error", error => done(() => reject(new Error(`The document could not be read: ${error.message}`))));
    worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error("The document could not be read.")); });
  });
}
