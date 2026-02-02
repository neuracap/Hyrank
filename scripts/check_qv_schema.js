const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkSchema() {
    const client = await pool.connect();
    const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'question_version'`);
    const cols = res.rows.map(r => r.column_name).sort();
    console.log(`Columns (${cols.length}):`);
    cols.forEach(c => console.log(c));
    client.release();
    await pool.end();
}
checkSchema();
