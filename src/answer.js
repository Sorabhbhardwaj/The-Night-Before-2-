// Turns retrieved chunks into a final structured answer.
//
// This is the step responsible for two of the three required "states":
// ANSWERED and NOT_COVERED (the third, CONTRADICTED, only applies if
// you extend this for contradiction detection — optional here since
// this project's brief doesn't require it, unlike the rulebook project).

const { generateText } = require("./ollamaClient");

function buildPrompt(question, chunks) {
  const excerptsBlock = chunks
    .map((c, i) => {
      const label = `[Source ${i + 1}: ${c.doc_id}${c.page != null ? `, page ${c.page}` : ""}]`;
      return `${label}\n${c.text}`;
    })
    .join("\n\n---\n\n");

  return `You are a study assistant answering a student's exam-prep question using ONLY the excerpts below, taken from their own course materials.

STRICT RULES:
- Answer using ONLY the information in the excerpts. Do not use any outside knowledge, even if you are confident you know the correct answer from training data.
- If the excerpts do not contain enough information to answer the question, you MUST respond with status "NOT_COVERED" — do not guess, infer beyond what's written, or fill gaps with general knowledge.
- Every claim in your answer must be traceable to a specific excerpt. Cite every source excerpt you actually used.
- If multiple excerpts contribute to the answer, cite all of them.

EXCERPTS:
${excerptsBlock}

QUESTION: ${question}

Respond with ONLY a JSON object in exactly this shape, and nothing else — no markdown code fences, no explanation before or after:
{
  "status": "ANSWERED" or "NOT_COVERED",
  "answer": "your answer in plain text, or a brief note if NOT_COVERED",
  "citations": [
    { "doc_id": "exact doc_id from the source label", "page": <page number or null>, "excerpt": "a short (under 20 word) quote or paraphrase of the relevant part" }
  ]
}
If status is "NOT_COVERED", citations should be an empty array.`;
}

/**
 * Best-effort parse of the model's response into the expected shape.
 * Local models sometimes wrap JSON in markdown fences or add stray
 * text before/after — this strips common wrappers before parsing, and
 * falls back to a safe NOT_COVERED-shaped error object rather than
 * throwing, so a single malformed response doesn't crash the request.
 */
function parseModelResponse(raw) {
  let cleaned = String(raw || "").trim();

  // Strip ```json ... ``` or ``` ... ``` fences if present.
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Extract one balanced object rather than using a greedy regex: braces
  // inside an answer string or a second object after it must not corrupt it.
  const start = cleaned.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        cleaned = cleaned.slice(start, i + 1);
        break;
      }
    }
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      status: parsed.status === "ANSWERED" ? "ANSWERED" : "NOT_COVERED",
      answer: typeof parsed.answer === "string" ? parsed.answer : "",
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    };
  } catch (err) {
    return {
      status: "ERROR",
      answer: "The model's response couldn't be parsed as valid JSON. Raw response: " + raw.slice(0, 300),
      citations: [],
    };
  }
}

// Models occasionally cite a displayed source label ("Source 1"), change the
// filename's case, or serialize a page number as a string.  Those references
// still refer to a retrieved excerpt, so resolve them before deciding that an
// otherwise grounded answer has no usable citation.
function resolveCitation(citation, chunks) {
  if (!citation || typeof citation !== "object") return null;

  const sourceLabel = String(citation.doc_id || citation.source || "").match(/^\s*source\s*(\d+)\s*$/i);
  if (sourceLabel) return chunks[Number(sourceLabel[1]) - 1] || null;

  const citedId = String(citation.doc_id || citation.source || "").trim().toLowerCase();
  const citedPage = citation.page == null || citation.page === ""
    ? null
    : Number(citation.page);
  return chunks.find((chunk) => {
    if (String(chunk.doc_id).trim().toLowerCase() !== citedId) return false;
    return citedPage == null || Number(chunk.page) === citedPage;
  }) || null;
}

/**
 * Given a question and the chunks retrieve() found for it, produce a
 * structured answer.
 *
 * @param {string} question
 * @param {{ chunks: object[], confident: boolean }} retrieval - output of retrieve()
 * @returns {Promise<{ status: "ANSWERED"|"NOT_COVERED"|"ERROR", answer: string, citations: object[] }>}
 */
async function generateAnswer(question, retrieval) {
  // Retrieval already found nothing relevant — no point spending an
  // LLM call asking it to notice the same thing.
  if (!retrieval.confident || retrieval.chunks.length === 0) {
    return {
      status: "NOT_COVERED",
      answer: "Your course materials don't appear to cover this. Nothing in the corpus matched closely enough to answer confidently.",
      citations: [],
    };
  }

  const prompt = buildPrompt(question, retrieval.chunks);
  const raw = await generateText(prompt);
  const parsed = parseModelResponse(raw);

  // Backfill citation metadata (ocr_confidence, image_path) from the
  // original retrieved chunks, since the model only echoes back
  // doc_id/page/excerpt and the frontend needs the rest to render
  // the handwritten-page image + confidence badge correctly.
  if (parsed.status === "ANSWERED") {
    // Do not return citations invented by the model: each one must point
    // to an actually retrieved chunk.
    parsed.citations = parsed.citations.flatMap((cite) => {
      const match = resolveCitation(cite, retrieval.chunks);
      if (!match) return [];
      return [{
        ...cite,
        doc_id: match.doc_id,
        page: match.page,
        ocr_confidence: match ? match.ocr_confidence : null,
        image_path: match ? match.image_path : null,
        doc_type: match ? match.doc_type : null,
        source_path: match
          ? (match.doc_type === "markdown" && match.doc_id === "notes.md"
            ? "notes.md"
            : `${match.doc_type === "slides" ? "slides" : match.doc_type === "markdown" ? "notes" : match.doc_type === "handwritten" ? "handwritten" : "lectures"}/${match.doc_id}`)
          : null,
      }];
    });
    if (parsed.citations.length === 0) {
      // The model confirmed it could answer from these excerpts but omitted
      // citation JSON. Cite the highest-ranked retrieved excerpt rather than
      // turning a supported answer into a false refusal. The source is still
      // restricted to the retrieval result, never invented.
      const match = retrieval.chunks[0];
      return {
        ...parsed,
        citations: [{
          doc_id: match.doc_id,
          page: match.page,
          excerpt: String(match.text || "").replace(/\s+/g, " ").trim().slice(0, 240),
          ocr_confidence: match.ocr_confidence || null,
          image_path: match.image_path || null,
          doc_type: match.doc_type || null,
          source_path: match.doc_type === "markdown" && match.doc_id === "notes.md"
            ? "notes.md"
            : `${match.doc_type === "slides" ? "slides" : match.doc_type === "markdown" ? "notes" : match.doc_type === "handwritten" ? "handwritten" : "lectures"}/${match.doc_id}`,
        }],
      };
    }
  }

  return parsed;
}

module.exports = { generateAnswer, buildPrompt, parseModelResponse, resolveCitation };
