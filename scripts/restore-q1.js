const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'questions.db');
const db = new Database(dbPath);

const stmt = db.prepare(`
    UPDATE questions SET
        question_text = 'A particle of mass $m$ is projected with a velocity $v = kv_e$ ($k < 1$) from the surface of the earth. ($v_e$ = escape velocity). The maximum height above the surface reached by the particle is:',
        difficulty = 'Medium',
        subject = 'Physics',
        topic = 'Gravitation',
        final_answer_label = 'B',
        keep_status = 'Good'
    WHERE id = 1
`);

stmt.run();
console.log("Restored Question 1 data.");
