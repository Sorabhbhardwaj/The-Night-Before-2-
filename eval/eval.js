// Scores the pipeline against eval/questions.json.
// Run with: npm run eval
//
// Fully implemented — this reads your labeled questions, calls the
// same retrieve()/generateAnswer() functions the server uses, and
// prints a scoreboard. Nothing to edit here; go fill in questions.json
// with your real 20 answerable + 10 unanswerable questions instead.

const fs = require("fs");
const path = require("path");
const { retrieve } = require("../src/retrieve");
const { generateAnswer } = require("../src/answer");

const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const RESULTS_JSON_PATH = path.join(__dirname, "results.json");
const RESULTS_MD_PATH = path.join(__dirname, "report.md");

function expectedSourcesFor(question) {
  if (Array.isArray(question.expectedSources) && question.expectedSources.length > 0) {
    return question.expectedSources;
  }
  return question.expectedDoc ? [{ doc_id: question.expectedDoc, page: question.expectedPage }] : [];
}

function citesAllExpectedSources(citations, expectedSources) {
  return expectedSources.every((expected) => citations.some(
    (citation) => citation.doc_id === expected.doc_id &&
      (expected.page == null || Number(citation.page) === Number(expected.page))
  ));
}

async function runEval() {
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf-8"));

  let answeredCorrectWithSource = 0;
  let answeredTotal = 0;
  let refusedCorrect = 0;
  let refusedTotal = 0;

  const results = [];

  for (const q of questions) {
    let result;
    try {
      const retrieval = await retrieve(q.question);
      result = await generateAnswer(q.question, retrieval);
    } catch (err) {
      result = { status: "ERROR", answer: err.message, citations: [] };
    }

    const row = {
      question: q.question,
      expectedStatus: q.expectedStatus,
      actualStatus: result.status,
      error: result.status === "ERROR" ? result.answer : null,
      expectedSources: expectedSourcesFor(q),
      citedAllExpectedSources: false,
    };

    if (q.expectedStatus === "ANSWERED") {
      answeredTotal++;
      const citations = result.citations || [];
      row.citedAllExpectedSources = citesAllExpectedSources(citations, row.expectedSources);
      if (result.status === "ANSWERED" && row.citedAllExpectedSources) {
        answeredCorrectWithSource++;
      }
    }

    if (q.expectedStatus === "NOT_COVERED") {
      refusedTotal++;
      if (result.status === "NOT_COVERED") {
        refusedCorrect++;
      }
    }

    results.push(row);
  }

  console.log("\n=== Per-question results ===");
  for (const r of results) {
    const ok =
      r.expectedStatus === "ANSWERED"
        ? r.actualStatus === "ANSWERED" && r.citedAllExpectedSources
        : r.actualStatus === r.expectedStatus;
    console.log(`[${ok ? "PASS" : "FAIL"}] (${r.expectedStatus} -> ${r.actualStatus}) ${r.question}`);
  }

  console.log("\n=== Scoreboard ===");
  console.log(`Answered correctly with correct source: ${answeredCorrectWithSource}/${answeredTotal}`);
  console.log(`Correctly refused (NOT_COVERED):         ${refusedCorrect}/${refusedTotal}`);
  console.log(
    `\nOverall: ${answeredCorrectWithSource + refusedCorrect}/${answeredTotal + refusedTotal}`
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    answeredCorrectWithSource,
    answeredTotal,
    refusedCorrect,
    refusedTotal,
    overallCorrect: answeredCorrectWithSource + refusedCorrect,
    overallTotal: answeredTotal + refusedTotal,
    results,
  };
  fs.writeFileSync(RESULTS_JSON_PATH, JSON.stringify(summary, null, 2));
  const rows = results.map((result) => {
    const pass = result.expectedStatus === "ANSWERED"
      ? result.actualStatus === "ANSWERED" && result.citedAllExpectedSources
      : result.actualStatus === result.expectedStatus;
    const detail = result.error ? `<br><small>${result.error.replaceAll("|", "\\|")}</small>` : "";
    return `| ${pass ? "PASS" : "FAIL"} | ${result.expectedStatus} | ${result.actualStatus} | ${result.question.replaceAll("|", "\\|")}${detail} |`;
  });
  fs.writeFileSync(RESULTS_MD_PATH, `# Evaluation report\n\nGenerated: ${summary.generatedAt}\n\n- Answered correctly with every required source: **${answeredCorrectWithSource}/${answeredTotal}**\n- Correctly refused: **${refusedCorrect}/${refusedTotal}**\n- Overall: **${summary.overallCorrect}/${summary.overallTotal}**\n\n| Result | Expected | Actual | Question |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`);
  console.log(`\nSaved ${RESULTS_JSON_PATH} and ${RESULTS_MD_PATH}`);
}

runEval().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
