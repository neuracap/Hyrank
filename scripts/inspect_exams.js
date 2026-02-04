const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Inspecting exams...');
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name LIKE '%exam%'
        `);
        console.log('Exam related tables:', res.rows.map(r => r.table_name).join(', '));

        // Assuming there is an 'exam' or 'exams' table
        const examTables = res.rows.map(r => r.table_name);
        if (examTables.includes('exam')) {
            const exams = await pool.query("SELECT * FROM exam");
            console.table(exams.rows);
        } else if (examTables.includes('exams')) {
            const exams = await pool.query("SELECT * FROM exams");
            console.table(exams.rows);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
