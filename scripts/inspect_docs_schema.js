const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    try {
        const t1 = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'import_job';
        `);
        console.log('--- import_job columns ---');
        console.log(t1.rows.map(r => r.column_name).join('\n'));

        const t2 = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'raw_mmd_doc';
        `);
        console.log('\n--- raw_mmd_doc columns ---');
        console.log(t2.rows.map(r => r.column_name).join('\n'));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
