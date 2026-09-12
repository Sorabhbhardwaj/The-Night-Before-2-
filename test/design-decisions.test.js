const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

function loadWithMocks(relativePath, mocks) {
  const absolutePath = path.join(__dirname, "..", relativePath);
  delete require.cache[require.resolve(absolutePath)];
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent && parent.filename === absolutePath && Object.hasOwn(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(absolutePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("chunkPage preserves headings and splits a flattened oversized page", () => {
  const { chunkPage } = loadWithMocks("src/ingestText.js", { "pdf-parse": () => {} });
  const sentences = Array.from({ length: 70 }, (_, i) => `Sentence ${i + 1} explains one concept.`).join(" ");
  const chunks = chunkPage(`# Retrieval\n\n${sentences}\n\n## Limits\n\nThresholds prevent unsupported answers.`);

  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.split(/\s+/).length <= 220));
  assert.ok(chunks.some((chunk) => chunk.startsWith("# Retrieval")));
  assert.ok(chunks.some((chunk) => chunk.includes("## Limits")));
});

test("transcribeHandwriting treats a missing verdict and dense uncertainty as low confidence", async () => {
  const { transcribeHandwriting, OCR_PROMPT } = loadWithMocks("src/ingestHandwriting.js", {
    "./ollamaClient": { generateVision: async () => "alpha [unclear: beta] gamma" },
    "./config": {},
  });
  const result = await transcribeHandwriting("fake.jpg");
  assert.equal(result.confidence, "low");
  assert.match(OCR_PROMPT, /\[unclear:/);
});

test("cosineSimilarity rejects invalid vectors and scores matching direction", () => {
  const { cosineSimilarity } = loadWithMocks("src/retrieve.js", {
    "./db": { prepare: () => ({ all: () => [] }) },
    "./embedder": { embedText: async () => [1, 0] },
    "./config": { TOP_K: 5, SIMILARITY_THRESHOLD: 0.35 },
  });
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1);
  assert.equal(cosineSimilarity([1], [1, 0]), -1);
  assert.equal(cosineSimilarity([0], [0]), -1);
});

test("parseModelResponse handles fenced JSON and malformed output safely", () => {
  const { parseModelResponse } = loadWithMocks("src/answer.js", {
    "./ollamaClient": { generateText: async () => "" },
  });
  const good = parseModelResponse('```json\n{"status":"ANSWERED","answer":"Use {x}.","citations":[]}\n```');
  assert.equal(good.status, "ANSWERED");
  assert.equal(good.answer, "Use {x}.");
  assert.equal(parseModelResponse("not JSON").status, "ERROR");
});

test("generateAnswer resolves displayed source labels and backfills a missing citation", async () => {
  const chunks = [{
    doc_id: "DBMS Notes.pdf", page: 4, doc_type: "lectures",
    text: "Normalization reduces redundant data and improves consistency.",
  }];
  const { generateAnswer } = loadWithMocks("src/answer.js", {
    "./ollamaClient": {
      generateText: async () => JSON.stringify({
        status: "ANSWERED", answer: "Normalization reduces redundancy.",
        citations: [{ doc_id: "Source 1", excerpt: "reduces redundant data" }],
      }),
    },
  });
  const labeled = await generateAnswer("What does normalization do?", { confident: true, chunks });
  assert.equal(labeled.status, "ANSWERED");
  assert.equal(labeled.citations[0].doc_id, "DBMS Notes.pdf");

  const { generateAnswer: generateWithoutCitation } = loadWithMocks("src/answer.js", {
    "./ollamaClient": {
      generateText: async () => JSON.stringify({
        status: "ANSWERED", answer: "Normalization reduces redundancy.", citations: [],
      }),
    },
  });
  const backfilled = await generateWithoutCitation("What does normalization do?", { confident: true, chunks });
  assert.equal(backfilled.status, "ANSWERED");
  assert.equal(backfilled.citations[0].doc_id, "DBMS Notes.pdf");
});

test("getGapSummary compares cited documents with the full corpus", () => {
  const rows = new Map();
  const fakeDb = {
    prepare(sql) {
      if (sql.startsWith("SELECT * FROM sessions")) return { get: (id) => rows.get(id) };
      if (sql.startsWith("INSERT INTO sessions")) return { run: (id) => rows.set(id, { session_id: id, questions_asked: "[]", docs_touched: "[]" }) };
      if (sql.startsWith("UPDATE sessions")) return { run: (questions, docs, id) => rows.set(id, { session_id: id, questions_asked: questions, docs_touched: docs }) };
      if (sql.startsWith("SELECT doc_id, doc_type FROM documents")) return { all: () => [{ doc_id: "lecture1.pdf" }, { doc_id: "lecture2.pdf" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const { recordQuestion, getGapSummary } = loadWithMocks("src/session.js", { "./db": fakeDb });
  recordQuestion("s1", "Question", "ANSWERED", ["lecture1.pdf"]);
  assert.deepEqual(getGapSummary("s1").untouched, ["lecture2.pdf"]);
  assert.deepEqual(getGapSummary("s1").lightlyTouched, ["lecture1.pdf"]);
});
