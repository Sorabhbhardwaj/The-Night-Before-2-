

require("dotenv").config();

module.exports = {
  LLM_PROVIDER: (process.env.LLM_PROVIDER || "groq").toLowerCase(),
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  GROQ_BASE_URL: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
  GROQ_MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  GROQ_MAX_COMPLETION_TOKENS: Number(process.env.GROQ_MAX_COMPLETION_TOKENS || process.env.GROQ_MAX_TOKENS || 1000),
  REQUEST_TIMEOUT_MS: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  VISION_TIMEOUT_MS: Number(process.env.VISION_TIMEOUT_MS || 0),
  USE_ANTHROPIC: false,

  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  OLLAMA_VISION_MODEL: process.env.OLLAMA_VISION_MODEL || "llava",
  OLLAMA_TEXT_MODEL: process.env.OLLAMA_TEXT_MODEL || "llama3.1:8b",

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",


  EMBEDDING_MODEL: "Xenova/all-MiniLM-L6-v2",
  EMBEDDING_BATCH_SIZE: Number(process.env.EMBEDDING_BATCH_SIZE || 24),

  TOP_K: Number(process.env.TOP_K || 3),


  SIMILARITY_THRESHOLD: 0.35,

  DB_PATH: require("path").join(__dirname, "..", "data", "study.db"),
};
