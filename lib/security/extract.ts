import { Worker } from "node:worker_threads";

// Untrusted documents are parsed in a short-lived worker thread with a memory cap and a hard timeout, so a malformed or
// hostile file can only kill that thread, never the web process. `pdf-parse/lib/pdf-parse.js` is required directly because
// the package entry point runs a debug routine that reads a test file when it has no parent module.
const source = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  try {
    const data = Buffer.from(workerData.data);
    let text;
    if (workerData.kind === "pdf") text = (await require("pdf-parse/lib/pdf-parse.js")(data, { max: 100 })).text;
    else text = (await require("mammoth").extractRawText({ buffer: data })).value;
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
