// Thin wrapper around Ollama's local HTTP API. Fully implemented — this
// is plumbing, not a design decision. Swap in Anthropic calls inside
// ingestHandwriting.js / answer.js if you set USE_ANTHROPIC = true in
// config.js; this file only needs to exist for the free/local path.

const fetch = require("node-fetch");
const fs = require("fs");
const https = require("https");
const {
  LLM_PROVIDER, GROQ_API_KEY, GROQ_BASE_URL, GROQ_MODEL, GROQ_MAX_COMPLETION_TOKENS,
  REQUEST_TIMEOUT_MS, VISION_TIMEOUT_MS, OLLAMA_BASE_URL, OLLAMA_VISION_MODEL, OLLAMA_TEXT_MODEL,
} = require("./config");

// Keeps the TLS connection alive so subsequent questions avoid a new handshake.
const groqAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });
const MAX_GROQ_ATTEMPTS = 3;

function retryDelayMs(response, attempt) {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return Math.ceil(retryAfterSeconds * 1000);
  return 1500 * (2 ** attempt);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function generateGroqText(prompt) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Add it to .env and restart the server.");
  }

  for (let attempt = 0; attempt < MAX_GROQ_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      agent: groqAgent,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        // GPT-OSS reasons before answering. Low effort keeps responses fast,
        // while 1000 completion tokens leaves room to close the JSON object.
        reasoning_effort: "low",
        reasoning_format: "hidden",
        max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
        // Do not request Groq's strict JSON validator here. Some generations
        // from gpt-oss-20b are rejected by it before reaching our resilient
        // parser, producing a 400 json_validate_failed response. The prompt
        // already requests JSON and answer.js safely strips/parses it.
      }),
    });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error("Groq returned no answer content.");
        return content;
      }
      const detail = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_GROQ_ATTEMPTS - 1) {
        await sleep(retryDelayMs(res, attempt));
        continue;
      }
      throw new Error(`Groq generation failed: ${res.status} ${detail}`);
    } catch (err) {
      if (err.name === "AbortError") throw new Error(`Groq request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Send a text-only prompt to the local Ollama text model.
 * @param {string} prompt
 * @returns {Promise<string>} raw model response text
 */
async function generateText(prompt) {
  if (LLM_PROVIDER === "groq") return generateGroqText(prompt);
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_TEXT_MODEL,
      prompt,
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama text generation failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.response;
}

/**
 * Send an image + prompt to the local Ollama vision model.
 * @param {string} imagePath absolute path to a jpg/png file
 * @param {string} prompt
 * @returns {Promise<string>} raw model response text
 */
async function generateVision(imagePath, prompt) {
  const imageBase64 = fs.readFileSync(imagePath, { encoding: "base64" });
  const controller = new AbortController();
  // A zero value deliberately means unlimited time for a local Ollama OCR
  // run. This avoids discarding handwritten material on slower hardware.
  const timeout = VISION_TIMEOUT_MS > 0
    ? setTimeout(() => controller.abort(), VISION_TIMEOUT_MS)
    : null;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        prompt,
        images: [imageBase64],
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama vision generation failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Handwritten OCR timed out after ${VISION_TIMEOUT_MS / 1000} seconds.`);
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

module.exports = { generateText, generateVision, generateGroqText };
