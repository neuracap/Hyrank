const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkDupes() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const client = await pool.connect();

    const res = await client.query(`
      SELECT source_question_no, count(*) 
      FROM question_version 
      WHERE paper_session_id = '${engSessionId}'
      GROUP BY source_question_no
      HAVING count(*) > 1
  `);

    console.log(`Duplicate English:`, res.rows);
    client.release();
    await pool.end();
}
checkDupes();
