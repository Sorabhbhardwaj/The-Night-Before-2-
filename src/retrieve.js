

const db = require("./db");
const { embedText } = require("./embedder");
const { TOP_K, SIMILARITY_THRESHOLD } = require("./config");

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
 *    
 *
 * @param {string} question
 * @returns {Promise<{ chunks: object[], confident: boolean }>}

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
   
    return { chunks: [], confident: false };
  }

  const secondaryBar = SIMILARITY_THRESHOLD * 0.85;
  const chunks = scored
    .slice(0, TOP_K)
    .filter((c) => c.score >= secondaryBar)
    .map(({ embedding, ...rest }) => rest); // drop the raw vector before returning — not needed downstream

  return { chunks, confident: true };
}


function getAllChunks() {
  const rows = db.prepare("SELECT * FROM chunks").all();
  return rows.map((row) => ({
    ...row,
    embedding: JSON.parse(row.embedding),
  }));
}

module.exports = { retrieve, cosineSimilarity, getAllChunks };
