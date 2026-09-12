

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { DB_PATH } = require("./config");


fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,        -- 'pdf' | 'slides' | 'markdown' | 'handwritten'
    page INTEGER,
    text TEXT NOT NULL,
    is_handwritten INTEGER DEFAULT 0,
    ocr_confidence TEXT,           -- 'high' | 'low' | null (not applicable)
    image_path TEXT,               -- set only for handwritten chunks
    embedding TEXT NOT NULL        -- JSON-stringified float array
  );

  CREATE TABLE IF NOT EXISTS documents (
    doc_id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    page_count INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    questions_asked TEXT DEFAULT '[]',   -- JSON array of {question, status, timestamp}
    docs_touched TEXT DEFAULT '[]'       -- JSON array of doc_id
  );
`);


const documentColumns = db.prepare("PRAGMA table_info(documents)").all().map((column) => column.name);
if (!documentColumns.includes("content_hash")) {
  db.exec("ALTER TABLE documents ADD COLUMN content_hash TEXT");
}

module.exports = db;
