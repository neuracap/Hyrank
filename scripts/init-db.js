const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'questions.db');
const db = new Database(dbPath, { verbose: console.log });

const initSql = `
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Core identity
    q_no INTEGER,

    -- Exam metadata
    exam TEXT,
    exam_date TEXT,            -- YYYY-MM-DD
    shift TEXT,
    section TEXT,

    -- Question text (may contain LaTeX)
    question_text TEXT,

    -- Figure support
    has_figure INTEGER DEFAULT 0,
    figure_path TEXT,
    original_figure_path TEXT,

    -- Traceability
    source_pdf_id TEXT,
    package_dir TEXT,

    -- Debug
    raw_block TEXT,
    
    -- Additional Metadata
    difficulty TEXT,
    subject TEXT,
    topic TEXT,
    sub_topic TEXT,
    concept_tags TEXT,
    question_source TEXT,

    ------------------------------------------------
    -- FINAL ANSWER / SOLUTION (editable by employee)
    ------------------------------------------------
    final_answer_label TEXT,    -- "a", "b", "c", "d" or null
    final_answer_text TEXT,     -- optional copy or computed value
    final_solution_text TEXT,   -- LaTeX allowed
    final_solution_source TEXT  -- e.g., "llm", "human"
);

CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER,
    opt_label TEXT,            -- "a","b","c","d"
    opt_text TEXT,
    FOREIGN KEY(question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS llm_solutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,

    llm_answer_label TEXT,    -- "a","b","c","d" or null for numeric
    llm_answer_text TEXT,     -- optional
    llm_solution_text TEXT,   -- LaTeX allowed
    raw_response TEXT,        -- full raw LLM output (JSON or text)

    created_at TEXT,          -- ISO datetime string
    updated_at TEXT,

    FOREIGN KEY(question_id) REFERENCES questions(id)
);
`;

try {
    db.exec(initSql);
    console.log('Database initialized successfully.');
} catch (err) {
    console.error('Error initializing database:', err);
    process.exit(1);
}
