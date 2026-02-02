const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('--- Tables ---');
        const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        const tableNames = tables.rows.map(r => r.table_name);
        console.log(tableNames.join(', '));

        const targetTables = ['paper_session', 'exam', 'exam_section'];

        for (const table of targetTables) {
            if (tableNames.includes(table)) {
                console.log(`\n--- Columns in ${table} ---`);
                const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [table]);
                console.log(cols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
