const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.cwd(), 'questions.db');
const db = new Database(dbPath);

const rows = db.prepare('SELECT * FROM questions').all();
console.log('Questions found:', rows.length);
if (rows.length > 0) {
    console.log('Sample ID:', rows[0].id);
    console.log('Sample Text:', rows[0].question_text);
}
