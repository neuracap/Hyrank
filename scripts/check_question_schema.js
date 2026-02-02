const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkQuestionSchema() {
    try {
        const client = await pool.connect();

        const columns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'question'
    `);
        fs.writeFileSync('question_schema_dump.json', JSON.stringify(columns.rows, null, 2));

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
        fs.writeFileSync('question_schema_error.txt', err.toString());
    } finally {
        await pool.end();
    }
}

checkQuestionSchema();
