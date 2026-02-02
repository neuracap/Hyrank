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
    const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'exam_section'`);
    console.log("Columns:");
    console.dir(res.rows.map(r => r.column_name), { depth: null, maxArrayLength: null });
    client.release();
    await pool.end();
}
checkSchema();
