// Central place to control which backend (free/local vs paid API) the
// pipeline uses. Nothing else in the codebase should hardcode a model
// name or provider — always import from here.

require("dotenv").config();

module.exports = {
  // Fast hosted answer generation. Set LLM_PROVIDER=ollama to use the
  // original local answer model instead.
  LLM_PROVIDER: (process.env.LLM_PROVIDER || "groq").toLowerCase(),
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  GROQ_BASE_URL: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
  GROQ_MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  // GPT-OSS uses completion tokens for both reasoning and the final JSON.
  // 400 can cut off the JSON before its closing brace.
  GROQ_MAX_COMPLETION_TOKENS: Number(process.env.GROQ_MAX_COMPLETION_TOKENS || process.env.GROQ_MAX_TOKENS || 1000),
  REQUEST_TIMEOUT_MS: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  // 0 means no timeout: preferred for slower local Ollama computers so
  // handwritten pages finish instead of being skipped.
  VISION_TIMEOUT_MS: Number(process.env.VISION_TIMEOUT_MS || 0),
  // Flip this to true if you've set ANTHROPIC_API_KEY in .env and want
  // Claude's vision model for OCR / Claude for answer generation instead
  // of local Ollama models. Left false by default to keep the project
  // fully free to run.
  USE_ANTHROPIC: false,

  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  OLLAMA_VISION_MODEL: process.env.OLLAMA_VISION_MODEL || "llava",
  OLLAMA_TEXT_MODEL: process.env.OLLAMA_TEXT_MODEL || "llama3.1:8b",

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",

  // Embedding model — runs locally via @xenova/transformers regardless
  // of the USE_ANTHROPIC switch above. Always free.
  EMBEDDING_MODEL: "Xenova/all-MiniLM-L6-v2",
  // Process several chunks per model call during ingestion. Lower this on
  // low-memory machines; 24 is a fast, conservative default.
  EMBEDDING_BATCH_SIZE: Number(process.env.EMBEDDING_BATCH_SIZE || 24),

  // How many chunks to retrieve per question before handing them to the
  // answer-generation step.
  // Fewer, more relevant excerpts make Groq prompts much smaller and faster.
  TOP_K: Number(process.env.TOP_K || 3),

  // Cosine similarity cutoff below which we treat retrieval as "found
  // nothing relevant" and short-circuit straight to NOT_COVERED without
  // even calling the LLM. THIS IS THE NUMBER THE WHOLE PROJECT HINGES ON.
  // You need to tune this empirically against your eval set — see
  // src/retrieve.js for where it's used and eval/eval.js for how to
  // measure the tradeoff.
  SIMILARITY_THRESHOLD: 0.35,

  DB_PATH: require("path").join(__dirname, "..", "data", "study.db"),
};
