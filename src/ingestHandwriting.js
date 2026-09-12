// Handles photos of handwritten notes. This is the hard constraint of
// the whole project — a bad implementation here shows up immediately in
// your eval numbers on the handwritten-source questions.

const { generateVision } = require("./ollamaClient");
const { USE_ANTHROPIC, ANTHROPIC_API_KEY } = require("./config");

const OCR_PROMPT = `You are transcribing a photo of handwritten student notes for a study tool. Follow these rules exactly:

1. Transcribe the handwritten text as literally as possible, preserving the original wording — do not paraphrase or "clean up" the content.
2. Wherever you are NOT confident about a word or short phrase, wrap your best guess like this: [unclear: your best guess]. Use this liberally — it is much better to flag uncertainty than to silently guess wrong.
3. If the page contains a diagram, sketch, or figure instead of text, describe what it shows in one sentence rather than inventing text for it, e.g. [diagram: a tree structure with root node labeled "root"].
4. Preserve the rough structure of the page (line breaks, bullet points, numbered lists) where visible.
5. After the transcription, on a new line, output exactly one of the following verdicts based on how much of the page you could read with genuine confidence:
   CONFIDENCE: HIGH   (you could read nearly all of it clearly)
   CONFIDENCE: LOW    (significant portions were illegible, guessed, or marked [unclear])

Output only the transcription followed by the CONFIDENCE line. No other commentary.`;

/**
 * Send a handwritten-note photo to the local vision model and return a
 * transcription plus a page-level confidence verdict.
 *
 * The confidence verdict is derived two ways and the more cautious one
 * wins: (1) the model's own self-rating from the CONFIDENCE line, and
 * (2) a simple density check on how many [unclear: ...] markers show
 * up relative to the transcription's length. Trusting the model's
 * self-rating alone is risky — smaller local vision models are prone
 * to rating themselves confident even on messy pages — so the marker
 * count acts as a sanity check on top of it.
 *
 * @param {string} imagePath - absolute path to a jpg/png file
 * @returns {Promise<{ text: string, confidence: "high"|"low" }>}
 */
async function transcribeHandwriting(imagePath) {
  const raw = await generateVision(imagePath, OCR_PROMPT);

  // Split off the CONFIDENCE line if the model included one.
  const confidenceMatch = raw.match(/^\s*CONFIDENCE:\s*(HIGH|LOW)\s*$/im);
  // A missing verdict is an instruction-following failure, not evidence
  // that the page is readable. Default conservatively to low.
  const modelSaysHigh = confidenceMatch ? confidenceMatch[1].toUpperCase() === "HIGH" : false;

  // Strip the confidence line out of the transcription text itself.
  const text = raw.replace(/^\s*CONFIDENCE:\s*(HIGH|LOW)\s*$/gim, "").trim();

  // Sanity-check the model's self-rating: count how many [unclear: ...]
  // markers appear relative to transcription length. More than ~1
  // marker per 40 words is treated as low confidence regardless of
  // what the model claimed about itself.
  const unclearCount = (text.match(/\[unclear:/gi) || []).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length || 1;
  const unclearDensity = unclearCount / wordCount;
  const densitySaysLow = unclearDensity > 0.025; // roughly 1 flagged phrase per 40 words

  const confidence = modelSaysHigh && !densitySaysLow ? "high" : "low";

  return { text, confidence };
}

module.exports = { transcribeHandwriting, OCR_PROMPT };
