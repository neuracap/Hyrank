const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkSchemaAndQuery() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    try {
        const client = await pool.connect();

        // 1. Check Column Type
        const schemaRes = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'question_version' AND column_name = 'paper_session_id'
     `);
        console.log('Column Schema:', schemaRes.rows[0]);

        // 2. Hardcoded Query (No Param Binding)
        console.log('Running HARDCODED query...');
        const hardcodedRes = await client.query(`
        SELECT count(*) FROM question_version 
        WHERE paper_session_id = '${engSessionId}'
     `);
        console.log(`Hardcoded Result Count: ${hardcodedRes.rows[0].count}`);

        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
checkSchemaAndQuery();
