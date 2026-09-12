
const { EMBEDDING_MODEL } = require("./config");

let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {

    const { pipeline } = await import("@xenova/transformers");
    embedderPromise = pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return embedderPromise;
}

/**
 * Embed a single string into a fixed-length float vector.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

/**
 * Embed a batch in one model inference call. Calling the transformer once per
 * chunk was the dominant ingestion cost for large PDFs.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  const dimension = output.dims[output.dims.length - 1];
  return texts.map((_, index) => Array.from(output.data.slice(index * dimension, (index + 1) * dimension)));
}

module.exports = { embedText, embedTexts };
