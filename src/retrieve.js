// Given a question, find the most relevant chunks from the corpus.
//
// The math (cosine similarity) is boilerplate and done for you. The
// decision that actually matters — where to draw the line between
// "found something relevant" and "found nothing, refuse" — is yours
// to tune. That threshold lives in config.js (SIMILARITY_THRESHOLD)
// but the logic that USES it is here.

const db = require("./db");
const { embedText } = require("./embedder");
const { TOP_K, SIMILARITY_THRESHOLD } = require("./config");

/**
 * Cosine similarity between two equal-length vectors.
 * Fully implemented.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? -1 : dot / denominator;
}

/**
 * Given a question, return the top-k most relevant chunks AND a verdict
 * on whether retrieval actually found anything usable.
 *
 * Approach:
 *   1. Embed the question, score every stored chunk by cosine
 *      similarity.
 *   2. Sort descending, take the top TOP_K.
 *   3. Confidence check: if the single best-scoring chunk doesn't
 *      clear SIMILARITY_THRESHOLD, nothing in the corpus is actually
 *      relevant — return confident: false so answer.js can
 *      short-circuit straight to NOT_COVERED without spending an LLM
 *      call on it.
 *   4. For the chunks BELOW the top one, use a slightly lower bar
 *      (threshold * 0.85) before including them in the returned set.
 *      This deliberately gives multi-document questions a bit more
 *      room — the second-most-relevant document for a "compare X and
 *      Y across two lectures" question often scores a bit lower than
 *      the top match even when it's genuinely relevant, so a single
 *      hard cutoff applied uniformly tends to starve multi-doc
 *      answers of their second source. The top-match threshold stays
 *      strict since that one determines the ANSWERED/NOT_COVERED
 *      verdict; the secondary threshold only decides what extra
 *      context accompanies an already-confident answer.
 *
 * @param {string} question
 * @returns {Promise<{ chunks: object[], confident: boolean }>}
 *   chunks: array of { doc_id, doc_type, page, text, is_handwritten,
 *           ocr_confidence, image_path, score }, best match first
 *   confident: false if nothing cleared SIMILARITY_THRESHOLD
 */
async function retrieve(question) {
  if (typeof question !== "string" || !question.trim()) {
    return { chunks: [], confident: false };
  }
  const queryEmbedding = await embedText(question);
  const allChunks = getAllChunks();

  const scored = allChunks
    .filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length === queryEmbedding.length)
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { chunks: [], confident: false };
  }

  const topScore = scored[0].score;
  const confident = topScore >= SIMILARITY_THRESHOLD;

  if (!confident) {
    // Nothing relevant enough — don't hand borderline chunks to the
    // LLM, since a model asked to "answer if possible" from weak
    // matches will often oblige anyway.
    return { chunks: [], confident: false };
  }

  const secondaryBar = SIMILARITY_THRESHOLD * 0.85;
  const chunks = scored
    .slice(0, TOP_K)
    .filter((c) => c.score >= secondaryBar)
    .map(({ embedding, ...rest }) => rest); // drop the raw vector before returning — not needed downstream

  return { chunks, confident: true };
}

/**
 * Fetch every chunk from SQLite with embeddings parsed back into arrays.
 * Fully implemented — a helper for you to use inside retrieve().
 */
function getAllChunks() {
  const rows = db.prepare("SELECT * FROM chunks").all();
  return rows.map((row) => ({
    ...row,
    embedding: JSON.parse(row.embedding),
  }));
}

module.exports = { retrieve, cosineSimilarity, getAllChunks };
