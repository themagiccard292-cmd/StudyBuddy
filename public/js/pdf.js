// Reads text out of PDF or plain-text files entirely in the browser (the file is never uploaded).
async function extractPdf(file) {
  const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 150); i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let line = "";
    const lines = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else if (item.str && !item.str.endsWith(" ")) line += " ";
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n").trim());
  }
  const text = pages.filter(Boolean).join("\n\n").trim();
  if (text.length < 20) {
    throw new Error("That PDF has no selectable text (it may be a scan). Try a text-based PDF, or paste the text instead.");
  }
  return text;
}

export async function extractFileText(file) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return extractPdf(file);
  if (file.type.startsWith("text/") || /\.(txt|md|csv)$/.test(name)) return (await file.text()).trim();
  throw new Error("Use a PDF or a text file (.txt or .md).");
}
