const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkQuestionContent() {
    try {
        const client = await pool.connect();
        // Get questions associated with the most recent images
        // The asset doesn't link to question directly usually, but maybe we can find questions created recently
        const res = await client.query(`
      SELECT id, question_text, created_at 
      FROM question 
      ORDER BY created_at DESC 
      LIMIT 3
    `);
        fs.writeFileSync('recent_questions_dump.json', JSON.stringify(res.rows, null, 2));
        client.release();
    } catch (err) {
        console.error('Error executing query', err);
        fs.writeFileSync('recent_questions_error.txt', err.toString());
    } finally {
        await pool.end();
    }
}

checkQuestionContent();
