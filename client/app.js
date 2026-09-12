const $ = (s) => document.querySelector(s);

const chatEl = $("#chat");
const askForm = $("#ask-form");
const questionInput = $("#question-input");
const askBtn = $("#ask-btn");

const docListEl = $("#doc-list");
const gapSummaryEl = $("#gap-summary");

const uploadForm = $("#upload-form");
const uploadType = $("#upload-type");
const fileInput = $("#file-input");
const fileName = $("#file-name");
const uploadStatus = $("#upload-status");
const dropZone = $("#drop-zone");

const lightbox = $("#lightbox");
const lightboxImg = $("#lightbox-img");

/* =========================
   DOCUMENT TYPE LABELS
========================= */

const typeLabel = {
  pdf: "LECTURE",
  lecture: "LECTURE",
  slides: "SLIDES",
  slide: "SLIDES",
  markdown: "NOTES",
  notes: "NOTES",
  handwritten: "HANDWRITTEN",
};

/* =========================
   DOM HELPERS
========================= */

function el(tag, className, text) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}

function clearWelcome() {
  $(".empty-state")?.remove();
}

function scrollBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

/* =========================
   QUESTION RENDERING
========================= */

function renderQuestion(question) {
  clearWelcome();

  const block = el("article", "qa-block");

  const bubble = el(
    "div",
    "question-bubble",
    question
  );

  block.append(bubble);
  chatEl.append(block);

  scrollBottom();

  return block;
}

/* =========================
   LOADING STATE
========================= */

function renderLoading(block) {
  const loading = el(
    "div",
    "answer-card loading",
    "Reading your material and checking sources…"
  );

  block.append(loading);

  scrollBottom();

  return loading;
}

/* =========================
   SOURCE URL
========================= */

function sourceUrl(citation) {
  if (!citation.source_path) {
    return null;
  }

  const page =
    citation.page &&
    citation.doc_type !== "handwritten"
      ? `#page=${citation.page}`
      : "";

  return `/corpus/${citation.source_path}${page}`;
}

/* =========================
   ANSWER RENDERING
========================= */

function renderAnswer(block, loading, result) {
  loading?.remove();

  const card = el("section", "answer-card");
  const header = el("div", "answer-header");

  /* Status */

  const statusText =
    result.status === "ANSWERED"
      ? "Grounded answer"
      : result.status === "NOT_COVERED"
        ? "Not covered"
        : "Couldn’t verify";

  const pill = el(
    "span",
    `status-pill status-${result.status}`,
    statusText
  );

  header.append(pill);

  /* Verified badge */

  if (result.status === "ANSWERED") {
    header.append(
      el(
        "span",
        "verified",
        "SOURCE CHECKED"
      )
    );
  }

  card.append(header);

  /* Answer */

  card.append(
    el(
      "p",
      "answer-text",
      result.answer || "No answer returned."
    )
  );

  /* Citations */

  if (result.citations?.length) {
    const citationsWrapper = el(
      "div",
      "citations"
    );

    citationsWrapper.append(
      el(
        "p",
        "citation-title",
        "READ IT IN CONTEXT"
      )
    );

    result.citations.forEach((citation) => {
      const cite = el("article", "citation");
      const meta = el("div", "citation-meta");

      /* Citation type */

      meta.append(
        el(
          "span",
          "cite-type",
          typeLabel[citation.doc_type] || "SOURCE"
        )
      );

      /* Document name + page */

      const documentLabel =
        `${citation.doc_id}${
          citation.page != null
            ? ` · page ${citation.page}`
            : ""
        }`;

      meta.append(
        el(
          "strong",
          "",
          documentLabel
        )
      );

      /* OCR confidence */

      if (citation.ocr_confidence === "low") {
        meta.append(
          el(
            "span",
            "confidence-flag",
            "OCR: REVIEW ORIGINAL"
          )
        );
      }

      cite.append(meta);

      /* Excerpt */

      if (citation.excerpt) {
        cite.append(
          el(
            "p",
            "citation-excerpt",
            `“${citation.excerpt}”`
          )
        );
      }

      /* Citation actions */

      const actions = el(
        "div",
        "citation-actions"
      );

      /* View original image */

      if (citation.image_path) {
        const viewButton = el(
          "button",
          "source-action",
          "View original image"
        );

        viewButton.type = "button";

        viewButton.onclick = () => {
          lightboxImg.src =
            `/corpus/${citation.image_path}`;

          lightbox.classList.remove("hidden");
        };

        actions.append(viewButton);
      }

      /* Open source */

      const url = sourceUrl(citation);

      if (url) {
        const link = el(
          "a",
          "source-action",
          citation.image_path
            ? "Open source ↗"
            : "Open cited page ↗"
        );

        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";

        actions.append(link);
      }

      cite.append(actions);
      citationsWrapper.append(cite);
    });

    card.append(citationsWrapper);
  }

  block.append(card);

  scrollBottom();
}

/* =========================
   LIGHTBOX
========================= */

$("#lightbox-close").onclick = () => {
  lightbox.classList.add("hidden");
};

lightbox.onclick = (event) => {
  if (event.target === lightbox) {
    lightbox.classList.add("hidden");
  }
};

/* =========================
   ASK QUESTION
========================= */

askForm.onsubmit = async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();

  if (!question) {
    return;
  }

  questionInput.value = "";
  askBtn.disabled = true;

  const block = renderQuestion(question);
  const loading = renderLoading(block);

  try {
    const response = await fetch("/api/ask", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        question,
      }),
    });

    const data = await response.json();

    renderAnswer(
      block,
      loading,
      response.ok
        ? data
        : {
            status: "ERROR",
            answer: data.error,
            citations: [],
          }
    );
  } catch (error) {
    renderAnswer(block, loading, {
      status: "ERROR",
      answer: `Request failed: ${error.message}`,
      citations: [],
    });
  } finally {
    askBtn.disabled = false;

    loadGaps();
  }
};

/* =========================
   STARTER QUESTIONS
========================= */

document
  .querySelectorAll("[data-question]")
  .forEach((button) => {
    button.onclick = () => {
      questionInput.value =
        button.dataset.question;

      questionInput.focus();
    };
  });

/* =========================
   LOAD DOCUMENTS
========================= */

async function loadDocuments() {
  try {
    const response = await fetch(
      "/api/documents"
    );

    const data = await response.json();

    const documents = data.documents || [];

    $("#source-count").textContent =
      documents.length;

    docListEl.replaceChildren();

    /* Empty state */

    if (!documents.length) {
      docListEl.append(
        el(
          "li",
          "muted",
          "Upload your first source to begin."
        )
      );
    }

    /* Documents */

    documents.forEach((doc) => {
      const item = el("li", "doc-item");
      const info = el("div", "doc-info");

      const pageCount =
        doc.page_count || 1;

      const pageText =
        `${pageCount} ${
          pageCount === 1
            ? "page"
            : "pages"
        }`;

      info.append(
        el(
          "span",
          "doc-name",
          doc.doc_id
        ),

        el(
          "small",
          "",
          pageText
        )
      );

      item.append(
        info,

        el(
          "span",
          "doc-badge",
          typeLabel[doc.doc_type] ||
            doc.doc_type
        )
      );

      docListEl.append(item);
    });
  } catch {
    docListEl.replaceChildren(
      el(
        "li",
        "muted",
        "Couldn’t load the source library."
      )
    );
  }
}

/* =========================
   COVERAGE / GAPS
========================= */

async function loadGaps() {
  try {
    const response = await fetch(
      "/api/gaps"
    );

    const data = await response.json();

    gapSummaryEl.replaceChildren();

    const stats = el(
      "div",
      "study-stats"
    );

    stats.append(
      el(
        "strong",
        "",
        `${data.answeredCount || 0}`
      ),

      el(
        "span",
        "",
        "grounded answers"
      )
    );

    gapSummaryEl.append(stats);

    /* Covered topics */

    if (data.touched?.length) {
      gapSummaryEl.append(
        el(
          "p",
          "covered",
          `Reviewed: ${data.touched.join(", ")}`
        )
      );
    } else {
      gapSummaryEl.append(
        el(
          "p",
          "muted",
          "Ask a question to start mapping coverage."
        )
      );
    }

    /* Uncovered topics */

    if (data.untouched?.length) {
      gapSummaryEl.append(
        el(
          "p",
          "uncovered",
          `Still to review: ${data.untouched.join(", ")}`
        )
      );
    }
  } catch {
    gapSummaryEl.textContent =
      "Coverage is temporarily unavailable.";
  }
}

$("#refresh-gaps").onclick = loadGaps;

/* =========================
   UPLOAD CONFIGURATION
========================= */

function syncUpload() {
  const type = uploadType.value;

  if (type === "handwritten") {
    fileInput.accept =
      "image/png,image/jpeg";
  } else if (type === "notes") {
    fileInput.accept =
      ".md,.txt,text/plain,text/markdown";
  } else {
    fileInput.accept = "application/pdf";
  }

  fileInput.value = "";
  fileName.textContent = "";
}

uploadType.onchange = syncUpload;

/* =========================
   FILE INPUT
========================= */

fileInput.onchange = () => {
  fileName.textContent =
    fileInput.files[0]?.name || "";
};

/* =========================
   DRAG & DROP
========================= */

["dragenter", "dragover"].forEach(
  (eventName) => {
    dropZone.addEventListener(
      eventName,
      (event) => {
        event.preventDefault();

        dropZone.classList.add(
          "dragging"
        );
      }
    );
  }
);

["dragleave", "drop"].forEach(
  (eventName) => {
    dropZone.addEventListener(
      eventName,
      (event) => {
        event.preventDefault();

        dropZone.classList.remove(
          "dragging"
        );
      }
    );
  }
);

dropZone.addEventListener(
  "drop",
  (event) => {
    if (event.dataTransfer.files.length) {
      fileInput.files =
        event.dataTransfer.files;

      fileName.textContent =
        fileInput.files[0].name;
    }
  }
);

/* =========================
   UPLOAD SOURCE
========================= */

uploadForm.onsubmit = async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];

  if (!file) {
    return;
  }

  const formData = new FormData();

  formData.append(
    "type",
    uploadType.value
  );

  formData.append(
    "file",
    file
  );

  uploadStatus.textContent =
    "Indexing your source…";

  try {
    const response = await fetch(
      "/api/upload",
      {
        method: "POST",
        body: formData,
      }
    );

    const data =
      await response.json();

    uploadStatus.textContent =
      response.ok
        ? `✓ ${data.message}`
        : `Upload failed: ${
            data.error ||
            "unknown error"
          }`;

    if (response.ok) {
      syncUpload();
      loadDocuments();
      loadGaps();
    }
  } catch (error) {
    uploadStatus.textContent =
      `Upload failed: ${error.message}`;
  }
};

/* =========================
   RESTORE HISTORY
========================= */

async function restoreHistory() {
  try {
    const response = await fetch(
      "/api/history"
    );

    const data = await response.json();

    if (!data.questionsAsked?.length) {
      return;
    }

    clearWelcome();

    data.questionsAsked.forEach(
      (question) => {
        const block = renderQuestion(
          question.question
        );

        if (question.answer) {
          renderAnswer(
            block,
            null,
            {
              status: question.status,
              answer: question.answer,
              citations:
                question.citations || [],
            }
          );
        } else {
          const card = el(
            "section",
            "answer-card history-card"
          );

          const statusText =
            question.status === "ANSWERED"
              ? "Previously answered"
              : "Not covered";

          card.append(
            el(
              "span",
              `status-pill status-${question.status}`,
              statusText
            )
          );

          block.append(card);
        }
      }
    );
  } catch {
    // History restoration is optional.
  }
}

/* =========================
   INITIALIZATION
========================= */

syncUpload();
loadDocuments();
loadGaps();
restoreHistory();