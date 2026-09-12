

const db = require("./db");

const getSessionStmt = db.prepare("SELECT * FROM sessions WHERE session_id = ?");
const insertSessionStmt = db.prepare(
  "INSERT INTO sessions (session_id, questions_asked, docs_touched) VALUES (?, '[]', '[]')"
);
const updateSessionStmt = db.prepare(
  "UPDATE sessions SET questions_asked = ?, docs_touched = ? WHERE session_id = ?"
);

/**
 * Fetch a session, creating it if it doesn't exist yet.
 * Fully implemented.
 */
function getOrCreateSession(sessionId) {
  let row = getSessionStmt.get(sessionId);
  if (!row) {
    insertSessionStmt.run(sessionId);
    row = getSessionStmt.get(sessionId);
  }
  return {
    sessionId: row.session_id,
    questionsAsked: JSON.parse(row.questions_asked),
    docsTouched: JSON.parse(row.docs_touched),
  };
}


function recordQuestion(sessionId, question, result, legacyCitedDocIds) {
  const session = getOrCreateSession(sessionId);

  if (typeof result === "string") {
    result = {
      status: result,
      answer: "",
      citations: (legacyCitedDocIds || []).map((doc_id) => ({ doc_id })),
    };
  }
  const citedDocIds = (result.citations || []).map((citation) => citation.doc_id);

 
  session.questionsAsked.push({
    question,
    status: result.status,
    answer: result.answer,
    citations: result.citations || [],
    citedDocIds,
    timestamp: Date.now(),
  });

  const docsSet = new Set(session.docsTouched);
  citedDocIds.forEach((id) => docsSet.add(id));

  updateSessionStmt.run(
    JSON.stringify(session.questionsAsked),
    JSON.stringify([...docsSet]),
    sessionId
  );
}

const getAllDocsStmt = db.prepare("SELECT doc_id, doc_type FROM documents");

/**
 * Given a session, produce a "here's what you haven't covered" summary

 *
 * @param {string} sessionId
 * @returns {{
 *   touched: string[],
 *   untouched: string[],
 *   lightlyTouched: string[],
 *   questionCount: number,
 *   answeredCount: number,
 *   notCoveredCount: number
 * }}
 */
function getGapSummary(sessionId) {
  const session = getOrCreateSession(sessionId);
  const allDocs = getAllDocsStmt.all().map((d) => d.doc_id);

  const citationCounts = new Map();
  for (const q of session.questionsAsked) {
    for (const docId of q.citedDocIds || []) {
      citationCounts.set(docId, (citationCounts.get(docId) || 0) + 1);
    }
  }

  const touchedSet = new Set(session.docsTouched);
  const touched = allDocs.filter((id) => touchedSet.has(id));
  const untouched = allDocs.filter((id) => !touchedSet.has(id));

  const answeredCount = session.questionsAsked.filter((q) => q.status === "ANSWERED").length;
  const notCoveredCount = session.questionsAsked.filter((q) => q.status === "NOT_COVERED").length;

  // Old sessions do not have citedDocIds, so do not label their documents
  // as lightly touched based on invented counts.
  const lightlyTouched = touched.filter((id) => citationCounts.get(id) === 1);

  return {
    touched,
    untouched,
    lightlyTouched,
    questionCount: session.questionsAsked.length,
    answeredCount,
    notCoveredCount,
  };
}

module.exports = { getOrCreateSession, recordQuestion, getGapSummary };
