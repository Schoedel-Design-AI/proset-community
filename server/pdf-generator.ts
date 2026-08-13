import PDFDocument from "pdfkit";

const MAX_PDF_CONTENT_CHARS = 500_000;

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/([*_])(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1");
}

export async function generateMarkdownPdf(
  content: string,
  title = "document",
): Promise<Buffer> {
  if (!content.trim()) {
    throw new Error("Please add some content first.");
  }
  if (content.length > MAX_PDF_CONTENT_CHARS) {
    throw new Error("This document is too large to export as one PDF.");
  }

  const document = new PDFDocument({
    autoFirstPage: true,
    bufferPages: true,
    margins: { top: 54, right: 54, bottom: 54, left: 54 },
    info: {
      Title: title,
      Creator: "Proset",
      Producer: "Proset",
    },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));

  const completed = new Promise<Buffer>((resolve, reject) => {
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);
  });

  let inCodeBlock = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      document.font("Courier").fontSize(9).fillColor("#1a1a1a");
      document.text(rawLine || " ", { lineGap: 2 });
      continue;
    }

    if (!trimmed) {
      document.moveDown(0.55);
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const size = heading[1].length === 1 ? 20 : heading[1].length === 2 ? 16 : 13;
      document
        .moveDown(heading[1].length === 1 ? 0.45 : 0.25)
        .font("Helvetica-Bold")
        .fontSize(size)
        .fillColor("#0a1628")
        .text(cleanInlineMarkdown(heading[2]), { lineGap: 3 })
        .moveDown(0.25);
      continue;
    }

    const task = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    const numbered = trimmed.match(/^(\d+\.)\s+(.+)$/);
    document.font("Helvetica").fontSize(11).fillColor("#1a1a1a");
    if (task) {
      document.text(`${task[1].toLowerCase() === "x" ? "☑" : "☐"}  ${cleanInlineMarkdown(task[2])}`, {
        indent: 12,
        lineGap: 3,
      });
    } else if (bullet) {
      document.text(`•  ${cleanInlineMarkdown(bullet[1])}`, { indent: 12, lineGap: 3 });
    } else if (numbered) {
      document.text(`${numbered[1]}  ${cleanInlineMarkdown(numbered[2])}`, {
        indent: 12,
        lineGap: 3,
      });
    } else {
      document.text(cleanInlineMarkdown(trimmed), { lineGap: 3 });
    }
  }

  const pageRange = document.bufferedPageRange();
  for (let index = 0; index < pageRange.count; index += 1) {
    document.switchToPage(pageRange.start + index);
    document
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666666")
      .text(
        `${index + 1} / ${pageRange.count}`,
        54,
        document.page.height - 38,
        { width: document.page.width - 108, align: "center", lineBreak: false },
      );
  }

  document.end();
  return completed;
}
