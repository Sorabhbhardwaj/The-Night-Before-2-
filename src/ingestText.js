

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

/**
 * Extract raw text from a PDF, page by page.
 * Fully implemented.
 * @param {string} filePath
 * @returns {Promise<{page: number, text: string}[]>}
 */
async function extractPdfPages(filePath) {
  const buffer = fs.readFileSync(filePath);


  const pages = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");
      pages.push({ page: pages.length + 1, text });
      return text;
    },
  });

  return pages;
}

/**
 * Read a markdown/text file as a single "page".
 * Fully implemented.
 * @param {string} filePath
 * @returns {{page: number, text: string}[]}
 */
function extractMarkdown(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  return [{ page: 1, text }];
}

/**
 *
 * @param {string} rawText - the full text of one page
 * @returns {string[]} - array of chunk strings
 */
function chunkPage(rawText) {
  const MAX_WORDS = 220;
  const MIN_WORDS = 15;
  const text = String(rawText || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
  const join = (left, right) => (left ? `${left}\n\n${right}` : right);

 
  const splitLongText = (value, limit) => {
    const sentences = value.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [value];
    const pieces = [];
    let buffer = "";
    const flush = () => {
      if (buffer) pieces.push(buffer.trim());
      buffer = "";
    };

    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (!clean) continue;
      if (wordCount(clean) > limit) {
        flush();
        const words = clean.split(/\s+/);
        for (let i = 0; i < words.length; i += limit) {
          pieces.push(words.slice(i, i + limit).join(" "));
        }
        continue;
      }
      const candidate = buffer ? `${buffer} ${clean}` : clean;
      if (wordCount(candidate) > limit) {
        flush();
        buffer = clean;
      } else {
        buffer = candidate;
      }
    }
    flush();
    return pieces;
  };

  // Step 1: split on markdown headings if present, keeping the heading
  // attached to its section so the chunk is self-describing.
  const lines = text.split("\n");
  const sections = [];
  let heading = "";
  let body = [];
  const commit = () => {
    const content = body.join("\n").trim();
    if (content || heading) sections.push({ heading, content });
    body = [];
  };
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) {
      commit();
      heading = line.trim();
    } else {
      body.push(line);
    }
  }
  commit();

  // Step 2: break any oversized section into paragraph-sized pieces.
  const chunks = [];
  for (const section of sections) {
    const paragraphs = section.content
      .split(/\n\s*\n/) // blank-line-separated paragraphs
      .map((p) => p.trim())
      .filter(Boolean);


    const contentLimit = Math.max(1, MAX_WORDS - wordCount(section.heading));
    const units = paragraphs.flatMap((paragraph) => splitLongText(paragraph, contentLimit));
    if (units.length === 0 && section.heading) {
      chunks.push(section.heading);
      continue;
    }

    let buffer = "";
    for (const unit of units) {
      const candidate = join(buffer, unit);
      if (wordCount(candidate) > contentLimit && buffer) {
        chunks.push(join(section.heading, buffer));
        buffer = unit;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) chunks.push(join(section.heading, buffer));
  }

 
  const merged = [];
  for (const chunk of chunks) {
    if (merged.length > 0 && wordCount(chunk) < MIN_WORDS && wordCount(join(merged[merged.length - 1], chunk)) <= MAX_WORDS) {
      merged[merged.length - 1] += `\n\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}

module.exports = { extractPdfPages, extractMarkdown, chunkPage };
