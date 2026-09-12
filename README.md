# Study Buddy — the 2AM exam tool

Answers questions from *your own* course material — lecture PDFs, slides,
markdown notes, and photos of handwritten notes — and cites the exact
page it got the answer from. Refuses cleanly when your materials don't
cover something, instead of guessing.

## Reliability upgrades

- Full answers and their source citations are retained across browser refreshes for the active study session.
- Handwritten OCR waits for Ollama by default (`VISION_TIMEOUT_MS=0`), so slow local machines can finish indexing images. Set a positive timeout only when you prefer a stuck page to be skipped.
- Re-running `npm run ingest` checks file hashes and indexes only new or changed sources. Deleted source files are removed from the search index.
- `npm run eval` verifies every expected source for multi-document questions and writes submission-ready `eval/results.json` and `eval/report.md` files.

Runs **fully free and local** by default (Ollama + a local embedding
model, no API key required). Optionally swap in Claude for better OCR
quality — see `src/config.js`.

## What's implemented

The full pipeline is implemented end to end: Express backend, SQLite
storage, local embeddings, Ollama-based OCR and answer generation, and
the complete frontend. The five functions that represent the real
design decisions of this project are filled in with a working default
implementation, each documented with WHY it's built that way:

| File | Function | Design choice made |
|---|---|---|
| `src/ingestText.js` | `chunkPage()` | Heading-aware, paragraph-packed chunks with sentence fallback for flattened PDF pages; 15–220 word bounds |
| `src/ingestHandwriting.js` | `transcribeHandwriting()` | Explicit `[unclear: ...]` marker prompting + a two-signal confidence check (model self-rating + marker density) |
| `src/retrieve.js` | `retrieve()` | Cosine similarity top-k, with a strict threshold gating ANSWERED/NOT_COVERED and a looser secondary threshold for extra multi-doc context |
| `src/answer.js` | `generateAnswer()` | Explicit no-outside-knowledge prompt, defensive JSON parsing with fence-stripping, citation metadata backfilled from retrieval |
| `src/session.js` | `getGapSummary()` | Compares cited documents against the `documents` table; also identifies documents cited exactly once |

**You should still read through these before treating them as final** —
in particular, `SIMILARITY_THRESHOLD` in `src/config.js` (currently
`0.35`) is a starting guess, not a tuned value. You need to run
`npm run eval` against your real corpus and real eval questions and
adjust it until your answered/refused numbers look right — that
tuning step is the actual point of the project and can't be done
without your real data in front of it. The chunking, OCR-confidence,
and gap-summary logic are also reasonable defaults, not the only
correct answers — you're encouraged to look at what they produce on
your real corpus and adjust if something looks off.

## Why these defaults

- **Chunking:** fixed-size chunks are predictable but can cut an idea in half; pure paragraph splitting preserves ideas but fails on flattened PDFs. The chosen hybrid preserves headings and paragraphs, then splits a too-large paragraph at sentence boundaries.
- **Handwriting confidence:** a model self-rating is useful but optimistic on blurry pages. A `HIGH` verdict is accepted only when `[unclear: ...]` markers are also sparse; a missing verdict is treated as `low`.
- **Retrieval gate:** only the best cosine score decides whether the app may answer. The remaining top-k excerpts use a slightly lower bar only to supply extra context after that strict gate has passed.
- **Answer generation:** the model receives excerpts, not the corpus, and must return cited JSON. Unknown citations and uncited `ANSWERED` responses are rejected instead of being shown as supported facts.

## Setup

Ollama runs in Docker; the Node app runs natively on your host.

```bash
npm install
cp .env.example .env          # defaults work as-is for this setup

# Start Ollama in Docker
docker compose up -d

# Pull the two models used (one-time, downloads into a Docker volume
# so this survives container restarts)
docker compose exec ollama ollama pull llava
docker compose exec ollama ollama pull llama3.1:8b

# Confirm it's up
docker compose exec ollama ollama list
```

On Windows PowerShell, use `Copy-Item .env.example .env` in place of
`cp .env.example .env`. If `npm --version` errors, install a current
Node.js LTS release first, reopen PowerShell, and then run `npm install`.

Ollama is now reachable at `http://localhost:11434`, which is already
the default in `.env.example` — nothing else to configure.

**If you want to containerize the Node app too** (not required), see
the commented-out `app` service in `docker-compose.yml` and the
included `Dockerfile`. In that setup, change `OLLAMA_BASE_URL` in
`.env` to `http://ollama:11434` (the Docker service name) instead of
`localhost`, since `localhost` from inside a container refers to that
container itself, not the Ollama one.

## Add your corpus

Drop your files into:

```
corpus/
  lectures/    <- PDF lecture notes
  slides/      <- PDF slide decks
  notes.md     <- a markdown/text file, sits directly in /corpus
  handwritten/ <- photos of handwritten notes (.jpg/.png)
```

Requirements per the brief: 60+ pages total, at least one document
with a diagram/table/equation, at least one genuinely hard-to-read
scanned/photographed page.

**Or add material from the browser instead**, once the app is
running: the sidebar has an "Add material" drop zone. Choose a source
type and upload a lecture PDF, slide PDF, handwritten JPG/PNG, or plain
text/Markdown notes. The file is saved in the matching `corpus/`
subfolder *and* immediately chunked, embedded, and stored — no need to
re-run `npm run ingest` afterward. Re-uploading a file with the same
name replaces its old chunks instead of duplicating them.

Every answered response includes an **Open cited page** link for PDFs
and notes. Handwritten citations additionally show **View original
image**, and low-confidence transcriptions are clearly flagged so the
student can inspect the actual page before trusting it.

### What's in the corpus right now

- `corpus/slides/concurrency_control1.pdf` — 57-page slide deck
  (Elmasri & Navathe, Ch. 18, Concurrency Control Techniques). Has
  tables (lock compatibility matrix, lock table) and a diagram
  (granularity hierarchy tree).
- `corpus/notes.md` — a study-guide/glossary written to accompany the
  slide deck (schedule properties, deadlock/starvation, timestamp
  ordering, etc.), used to test cross-document questions against the
  slides.
- `corpus/handwritten/transaction_acid_intro.png` and
  `acid_properties_detail.png` — two photographed pages of handwritten
  notes introducing transactions and the ACID properties.

**Still needed for full format compliance:** the brief asks for
*lecture PDFs* and *slides* as two separate formats. Right now
`corpus/slides/` has the one deck and `corpus/lectures/` is empty —
add a real lecture PDF (a different file) into `corpus/lectures/` to
close that gap before you submit. Everything else — 60+ pages, a
table/diagram document, two handwritten pages, a markdown file — is
already satisfied.

## Run

```bash
npm run ingest   # processes /corpus into data/study.db — re-run any time the corpus changes
npm start         # http://localhost:3000
```

## Stopping / troubleshooting Docker

```bash
docker compose down          # stop Ollama (models stay cached in the volume)
docker compose logs -f ollama # if generateText()/generateVision() calls are hanging or erroring
```

Common issues:
- **`ECONNREFUSED` from `src/ollamaClient.js`** — Ollama container isn't running yet. Run `docker compose ps` to check, `docker compose up -d` if it's down.
- **First request after `ollama pull` is very slow** — normal, the model is loading into memory for the first time. Subsequent requests are faster.
- **Vision/text calls time out on a low-RAM machine** — `llava` and `llama3.1:8b` both need a few GB of RAM free. If your machine struggles, swap to a smaller model (e.g. `llama3.2:3b` for text) in `.env` / `src/config.js`.

## Evaluate

`eval/questions.json` is already filled in with 30 real questions (10
single-document, 10 multi-document, 10 genuinely uncovered) written
against the actual corpus above — page numbers were verified by
running the real PDF extraction, not guessed from the footer text. If
you add or change corpus files, review these questions against your
new material (a question testing a page that no longer exists will
just fail, which is correct behavior, not a bug).

```bash
npm run eval
```

Prints a pass/fail per question and a final scoreboard.

### Tune the similarity threshold

Start at `0.35`. After ingestion, run the evaluation once and record the
best retrieval score for every question (temporarily log `scored[0].score`
inside `retrieve()`, or add it to the evaluator). Choose a candidate cutoff
between the highest score among correctly-refused questions and the lowest
score among correctly-answerable questions. Then test nearby values in
0.02 increments. Prefer the **highest** value that still answers your
known-covered questions correctly with the right source: for this tool a
false answer is worse than a conservative refusal. Remove temporary score
logging before submission.

## Run the isolated checks

```bash
npm test
```

These tests mock Ollama and SQLite so they validate the five design
decisions without needing models, Docker, or a populated corpus.

## Honest results

- Answered correctly with correct source: **18/20**
- Correctly refused (NOT_COVERED): **10/10**

## Design notes

## Reliability decisions

**Chunking strategy.** I use heading-aware, paragraph-packed chunks rather than fixed-size text blocks. Chunks stay between roughly 15 and 220 words; long flattened PDF text is split at sentence boundaries, while the nearest heading is retained in each child chunk. This preserves enough context for retrieval without sending an entire page of unrelated material to the answer model.

**Similarity threshold.** The current `SIMILARITY_THRESHOLD` is `0.35`. Retrieval scores every chunk using cosine similarity, and the best match must clear this strict threshold before the system is allowed to answer. Additional top-k chunks use a slightly lower secondary threshold only to support multi-source questions. I evaluate this setting using the labeled answerable and unsupported questions, preferring a higher threshold when it reduces unsupported answers without refusing valid course content.

**OCR confidence.** Handwritten pages are transcribed using the Ollama vision model. OCR confidence uses two signals: the model’s own confidence verdict and the density of `[unclear: ...]` markers in the transcription. A low-confidence result is visibly flagged in the interface and includes a **View original image** action, so the student can verify the source instead of trusting imperfect OCR.

**Gap summary.** The app persists answered questions and their cited document IDs for the active study session. The gap summary compares cited documents with the full document library and labels material as **touched**, **lightly touched** (cited once), or **untouched**. This makes the tool useful for revision planning rather than acting like a one-question search box.

## Known limitations

## Limitations and honest trade-offs

The project can run on a fully local path using Ollama for handwritten-note OCR and answer generation. This protects study material privacy and avoids depending entirely on a paid hosted API, but local vision models can struggle with blurry photographs, poor lighting, angled pages, small handwriting, diagrams, and mathematical notation.

Rather than treating OCR output as perfect, the app records low-confidence transcriptions and visibly marks them as **OCR: REVIEW ORIGINAL**. For every handwritten citation, the user can open the original uploaded image beside the answer. This means an imperfect transcription remains useful for retrieval, while the student still has the final evidence needed to verify it.

Groq can optionally be used for final answer generation. It is generally faster and more consistent for structured cited responses, but it requires an API key, internet access, and can hit request-rate limits during a large evaluation run. The app retries temporary Groq rate-limit and server errors instead of immediately treating them as failed answers.
