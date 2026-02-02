const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'questions.db');
const db = new Database(dbPath);

try {
    db.exec(`ALTER TABLE questions ADD COLUMN keep_status TEXT DEFAULT 'Good'`);
    console.log("Added 'keep_status' column to questions table.");
} catch (err) {
    if (err.message.includes('duplicate column name')) {
        console.log("'keep_status' column already exists.");
    } else {
        console.error('Error adding column:', err);
    }
}
