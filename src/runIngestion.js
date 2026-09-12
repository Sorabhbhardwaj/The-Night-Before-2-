

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const { embedTexts } = require("./embedder");
const { EMBEDDING_BATCH_SIZE } = require("./config");
const { extractPdfPages, extractMarkdown, chunkPage } = require("./ingestText");
const { transcribeHandwriting } = require("./ingestHandwriting");

const CORPUS_DIR = path.join(__dirname, "..", "corpus");

const insertChunk = db.prepare(`
  INSERT INTO chunks (doc_id, doc_type, page, text, is_handwritten, ocr_confidence, image_path, embedding)
  VALUES (@doc_id, @doc_type, @page, @text, @is_handwritten, @ocr_confidence, @image_path, @embedding)
`);

const upsertDoc = db.prepare(`
  INSERT INTO documents (doc_id, filename, doc_type, page_count, content_hash)
  VALUES (@doc_id, @filename, @doc_type, @page_count, @content_hash)
  ON CONFLICT(doc_id) DO UPDATE SET page_count = @page_count, content_hash = @content_hash
`);

const insertChunks = db.transaction((rows) => {
  for (const row of rows) insertChunk.run(row);
});

async function storeChunks(docId, docType, pages, opts = {}) {
  const { isHandwritten = false, imagePath = null, ocrConfidence = null, contentHash = null } = opts;
  const pending = [];
  for (const { page, text } of pages) {
    const pieces = isHandwritten ? [text] : chunkPage(text);
    for (const chunkText of pieces) {
      if (!chunkText || !chunkText.trim()) continue;
      pending.push({ page, text: chunkText });
    }
  }

  console.log(`  Creating embeddings for ${pending.length} chunks in batches of ${EMBEDDING_BATCH_SIZE}...`);
  const rows = [];
  for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.text));
    rows.push(...batch.map((chunk, index) => ({
      doc_id: docId,
      doc_type: docType,
      page: chunk.page,
      text: chunk.text,
      is_handwritten: isHandwritten ? 1 : 0,
      ocr_confidence: ocrConfidence,
      image_path: imagePath,
      embedding: JSON.stringify(embeddings[index]),
    })));
    console.log(`  Embedded ${Math.min(start + batch.length, pending.length)}/${pending.length} chunks`);
  }
  // One SQLite transaction is much faster than committing every chunk.
  insertChunks(rows);

  upsertDoc.run({
    doc_id: docId,
    filename: docId,
    doc_type: docType,
    page_count: pages.length,
    content_hash: contentHash,
  });
}

function contentHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isCurrent(docId, hash) {
  const row = db.prepare("SELECT content_hash FROM documents WHERE doc_id = ?").get(docId);
  return Boolean(row && row.content_hash === hash);
}

async function ingestFolder(folder, docType, seen) {
  const dir = path.join(CORPUS_DIR, folder);
  if (!fs.existsSync(dir)) return;

  for (const filename of fs.readdirSync(dir)) {
    const filePath = path.join(dir, filename);
    if (!fs.statSync(filePath).isFile()) continue;
    console.log(`Ingesting ${docType}: ${filename}`);

    const hash = contentHash(filePath);
    seen.add(filename);
    if (isCurrent(filename, hash)) {
      console.log("  Unchanged — skipped.");
      continue;
    }
    removeDocument(filename);

    if (filename.toLowerCase().endsWith(".pdf")) {
      const pages = await extractPdfPages(filePath);
      await storeChunks(filename, docType, pages, { contentHash: hash });
    } else if (filename.toLowerCase().endsWith(".md") || filename.toLowerCase().endsWith(".txt")) {
      const pages = extractMarkdown(filePath);
      await storeChunks(filename, docType, pages, { contentHash: hash });
    } else {
      console.warn(`  Skipping unrecognized file type: ${filename}`);
    }
  }
}

async function ingestHandwrittenFolder(seen) {
  const dir = path.join(CORPUS_DIR, "handwritten");
  if (!fs.existsSync(dir)) return;

  for (const filename of fs.readdirSync(dir)) {
    if (!/\.(jpg|jpeg|png)$/i.test(filename)) continue;
    const filePath = path.join(dir, filename);
    const hash = contentHash(filePath);
    seen.add(filename);
    if (isCurrent(filename, hash)) {
      console.log(`Handwritten page unchanged — skipped: ${filename}`);
      continue;
    }
    removeDocument(filename);
    try {
      await ingestHandwrittenFile(filename, hash);
    } catch (err) {
      // One difficult page should not block all other study material.
      console.warn(`  Skipped handwritten page ${filename}: ${err.message}`);
    }
  }
}

/**
 * Ingest a single PDF that's already sitting in corpus/<folder>/, by
 * filename. Used both by the full ingest run and by the single-file
 * upload route in server.js so a newly-uploaded file doesn't require
 * wiping and re-ingesting the whole corpus.
 * @param {string} filename - e.g. "lecture3.pdf"
 * @param {"pdf"|"slides"} docType
 */
async function ingestSinglePdfFile(filename, docType) {
  const folder = docType === "slides" ? "slides" : "lectures";
  const filePath = path.join(CORPUS_DIR, folder, filename);
  console.log(`Ingesting ${docType}: ${filename}`);
  const pages = await extractPdfPages(filePath);
  await storeChunks(filename, docType, pages, { contentHash: contentHash(filePath) });
  return { chunksAdded: pages.reduce((sum, p) => sum + chunkPage(p.text).length, 0), pageCount: pages.length };
}

/** Index a browser-uploaded .md or .txt study note as one citable page. */
async function ingestSingleTextFile(filename) {
  const filePath = path.join(CORPUS_DIR, "notes", filename);
  console.log(`Ingesting text note: ${filename}`);
  const pages = extractMarkdown(filePath);
  await storeChunks(filename, "markdown", pages, { contentHash: contentHash(filePath) });
  return { chunksAdded: pages.reduce((sum, p) => sum + chunkPage(p.text).length, 0), pageCount: pages.length };
}

/**
 * Ingest a single handwritten photo that's already sitting in
 * corpus/handwritten/, by filename.
 * @param {string} filename - e.g. "page3.jpg"
 */
async function ingestHandwrittenFile(filename, knownHash = null) {
  const filePath = path.join(CORPUS_DIR, "handwritten", filename);
  console.log(`Transcribing handwritten page: ${filename}`);
  const { text, confidence } = await transcribeHandwriting(filePath);
  await storeChunks(filename, "handwritten", [{ page: 1, text }], {
    isHandwritten: true,
    imagePath: path.join("handwritten", filename),
    ocrConfidence: confidence,
    contentHash: knownHash || contentHash(filePath),
  });
  return { confidence };
}

/**
 * Remove any existing chunks/document row for a doc_id before
 * re-ingesting it — used when a file is re-uploaded with the same
 * name, so it doesn't end up duplicated in search results.
 */
function removeDocument(docId) {
  db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(docId);
  db.prepare("DELETE FROM documents WHERE doc_id = ?").run(docId);
}

async function main() {
  console.log("Checking corpus for new or changed files...");
  const seen = new Set();
  await ingestFolder("lectures", "pdf", seen);
  await ingestFolder("slides", "slides", seen);
  await ingestFolder(".", "markdown", seen); // notes.md sitting at /corpus root
  await ingestFolder("notes", "markdown", seen); // browser-uploaded .md/.txt notes
  await ingestHandwrittenFolder(seen);

  // Remove indexed material whose source file no longer exists.
  const removeStale = db.transaction(() => {
    for (const { doc_id } of db.prepare("SELECT doc_id FROM documents").all()) {
      if (!seen.has(doc_id)) removeDocument(doc_id);
    }
  });
  removeStale();

  const count = db.prepare("SELECT COUNT(*) as c FROM chunks").get().c;
  console.log(`\nDone. ${count} chunks stored in ${require("./config").DB_PATH}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Ingestion failed:", err);
    process.exit(1);
  });
}

module.exports = { main, ingestSinglePdfFile, ingestSingleTextFile, ingestHandwrittenFile, removeDocument };
