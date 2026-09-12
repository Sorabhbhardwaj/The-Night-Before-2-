// Main server. Fully implemented and wired — routes call into the
// functions you implement in /src. You shouldn't need to edit this
// file; run `npm run ingest` first, then `npm start`.

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const { retrieve } = require("./src/retrieve");
const { generateAnswer } = require("./src/answer");
const { getOrCreateSession, recordQuestion, getGapSummary } = require("./src/session");
const { ingestSinglePdfFile, ingestSingleTextFile, ingestHandwrittenFile, removeDocument } = require("./src/runIngestion");
const db = require("./src/db");

const app = express();
const PORT = process.env.PORT || 3000;
const answerCache = new Map();
const ANSWER_CACHE_TTL_MS = 1000 * 60 * 15;

app.use(express.json());
app.use(express.static(path.join(__dirname, "client")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 4 }, // 4 hour session — long enough for a study session
  })
);

// Give every visitor a stable id to key their study session by, even
// though express-session already gives us req.sessionID — keeping this
// explicit makes the DB schema easy to reason about independent of the
// session-cookie implementation.
app.use((req, res, next) => {
  if (!req.session.studyId) {
    req.session.studyId = crypto.randomUUID();
  }
  next();
});

// Serve corpus files (PDFs, handwritten photos) so the frontend can show
// "here's the original page" next to a citation.
app.use("/corpus", express.static(path.join(__dirname, "corpus")));

// Corpus-file upload: lets a student add a new lecture PDF, slide deck,
// or handwritten photo straight from the browser instead of dropping it
// into /corpus by hand. The destination folder depends on the "type"
// field the client sends, which multer parses before the file itself
// as long as the client appends "type" to the FormData before "file"
// (see client/app.js) — that's a property of how multipart form fields
// stream in, not something we can reorder here.
const TYPE_TO_FOLDER = { lecture: "lectures", slide: "slides", handwritten: "handwritten", notes: "notes" };
const TYPE_TO_EXTENSIONS = {
  lecture: /\.pdf$/i,
  slide: /\.pdf$/i,
  handwritten: /\.(jpg|jpeg|png)$/i,
  notes: /\.(md|txt)$/i,
};

// The project can start with an empty corpus. Keep all upload destinations
// ready so a first-time text-note upload is just as reliable as a PDF upload.
Object.values(TYPE_TO_FOLDER).forEach((folder) => {
  fs.mkdirSync(path.join(__dirname, "corpus", folder), { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = TYPE_TO_FOLDER[req.body.type];
    if (!folder) return cb(new Error("type must be one of: lecture, slide, handwritten"));
    cb(null, path.join(__dirname, "corpus", folder));
  },
  filename: (req, file, cb) => {
    // Keep the original filename (sanitized) so it's a stable doc_id a
    // student can recognize in citations — but strip any path
    // separators a malicious filename might contain.
    const safeName = path.basename(file.originalname).replace(/[/\\]/g, "_");
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const pattern = TYPE_TO_EXTENSIONS[req.body.type];
    if (!pattern) return cb(new Error("type must be one of: lecture, slide, handwritten"));
    if (!pattern.test(file.originalname)) {
      const accepted = req.body.type === "handwritten" ? ".jpg, .jpeg, or .png" : req.body.type === "notes" ? ".md or .txt" : ".pdf";
      return cb(new Error(`A "${req.body.type}" upload must be a ${accepted} file`));
    }
    cb(null, true);
  },
});

/**
 * POST /api/ask
 * body: { question: string }
 * returns: { status, answer, citations, sessionId }
 */
app.post("/api/ask", async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: "question is required" });
  }

  try {
    const cacheKey = question.trim().toLowerCase().replace(/\s+/g, " ");
    const cached = answerCache.get(cacheKey);
    const cacheHit = cached && Date.now() - cached.createdAt < ANSWER_CACHE_TTL_MS;
    const result = cacheHit
      ? cached.result
      : await (async () => {
          const retrieval = await retrieve(question);
          const generated = await generateAnswer(question, retrieval);
          answerCache.set(cacheKey, { result: generated, createdAt: Date.now() });
          return generated;
        })();

    recordQuestion(req.session.studyId, question, result);

    res.json({ ...result, sessionId: req.session.studyId, cached: Boolean(cacheHit) });
  } catch (err) {
    console.error("Error in /api/ask:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/gaps
 * returns: { touched, untouched, questionCount }
 */
app.get("/api/gaps", (req, res) => {
  try {
    const summary = getGapSummary(req.session.studyId);
    res.json(summary);
  } catch (err) {
    console.error("Error in /api/gaps:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/history
 * returns the running list of questions asked this session — used by
 * the frontend to render the conversation thread on page load/refresh.
 */
app.get("/api/history", (req, res) => {
  const s = getOrCreateSession(req.session.studyId);
  res.json({ questionsAsked: s.questionsAsked });
});

/**
 * GET /api/documents
 * returns every document currently ingested, for the sidebar.
 */
app.get("/api/documents", (req, res) => {
  const docs = db.prepare("SELECT doc_id, doc_type, page_count FROM documents").all();
  res.json({ documents: docs });
});

/**
 * POST /api/upload
 * multipart form-data: { type: "lecture"|"slide"|"handwritten", file }
 *
 * Saves the file into the matching /corpus subfolder AND immediately
 * ingests it (chunk + embed + store, or transcribe + embed + store for
 * handwritten pages) — no need to re-run `npm run ingest` afterward.
 * A student can drop in a new page mid-study-session and ask about it
 * within seconds, which is the point: the corpus isn't frozen at
 * setup time.
 */
app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "no file uploaded" });

    const { type } = req.body;
    const filename = req.file.filename;

    try {
      // Re-uploading a file with the same name replaces its old chunks
      // rather than duplicating them.
      removeDocument(filename);

      let result;
      if (type === "handwritten") {
        result = await ingestHandwrittenFile(filename);
        answerCache.clear();
        res.json({
          message: `Transcribed and indexed. OCR confidence: ${result.confidence}.`,
          filename,
          confidence: result.confidence,
        });
      } else {
        result = type === "notes"
          ? await ingestSingleTextFile(filename)
          : await ingestSinglePdfFile(filename, type === "slide" ? "slides" : "pdf");
        answerCache.clear();
        res.json({
          message: `Indexed ${result.chunksAdded} chunk(s) across ${result.pageCount} page(s).`,
          filename,
          chunksAdded: result.chunksAdded,
          pageCount: result.pageCount,
        });
      }
    } catch (ingestErr) {
      console.error("Error ingesting upload:", ingestErr);
      res.status(500).json({
        error: `File was saved but ingestion failed: ${ingestErr.message}. It won't be searchable until this is fixed and you re-run npm run ingest.`,
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Study Buddy running at http://localhost:${PORT}`);
});
