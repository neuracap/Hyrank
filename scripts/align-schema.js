const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'questions.db');
const db = new Database(dbPath);

console.log('Aligning database schema...');

// Helper to add column if missing
function addColumn(table, column, type) {
    const info = db.pragma(`table_info(${table})`);
    const exists = info.some(col => col.name === column);
    if (!exists) {
        console.log(`Adding ${column} to ${table}...`);
        try {
            db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
        } catch (e) {
            console.error(`Failed to add ${column}: ${e.message}`);
        }
    } else {
        // console.log(`Column ${column} exists in ${table}.`);
    }
}

// 1. QUESTIONS TABLE
// New columns from user schema
const questionCols = [
    { name: 'exam', type: 'TEXT' },
    { name: 'exam_date', type: 'TEXT' },
    { name: 'shift', type: 'TEXT' },
    { name: 'section', type: 'TEXT' },
    { name: 'original_figure_path', type: 'TEXT' },
    { name: 'source_pdf_id', type: 'TEXT' },
    { name: 'package_dir', type: 'TEXT' },
    { name: 'raw_block', type: 'TEXT' },
    { name: 'difficulty_level', type: 'INTEGER' }, // 1-5
    { name: 'approx_time_seconds', type: 'INTEGER' },
    { name: 'soft_skill_tag', type: 'TEXT' },
    { name: 'solution_style_tags', type: 'TEXT' },
    { name: 'trap_option_label', type: 'TEXT' },
    { name: 'trap_explanation_1line', type: 'TEXT' },
    { name: 'final_answer_text', type: 'TEXT' },
    { name: 'final_solution_source', type: 'TEXT' },
    { name: 'review_status', type: 'TEXT' } // Renamed from keep_status context
];

questionCols.forEach(col => addColumn('questions', col.name, col.type));

// Migrate keep_status -> review_status if needed
const qInfo = db.pragma('table_info(questions)');
const hasKeep = qInfo.some(c => c.name === 'keep_status');
const hasReview = qInfo.some(c => c.name === 'review_status');

if (hasKeep && hasReview) {
    console.log('Migrating keep_status to review_status...');
    db.prepare(`UPDATE questions SET review_status = CASE WHEN keep_status IS NOT NULL THEN lower(keep_status) ELSE 'good' END WHERE review_status IS NULL`).run();
}


// 2. LLM_SOLUTIONS TABLE
const llmCols = [
    { name: 'llm_answer_label', type: 'TEXT' },
    { name: 'llm_answer_text', type: 'TEXT' },
    { name: 'raw_response', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' }
];

llmCols.forEach(col => addColumn('llm_solutions', col.name, col.type));

console.log('Schema alignment complete.');
