const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkDupes() {
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';
    const client = await pool.connect();

    const res = await client.query(`
      SELECT source_question_no, count(*) 
      FROM question_version 
      WHERE paper_session_id = '${hinSessionId}' 
        AND exam_section_id IN (SELECT section_id FROM exam_section WHERE name = 'General Awareness')
      GROUP BY source_question_no
      HAVING count(*) > 1
  `);

    console.log(`Duplicate Hin GA:`, res.rows);
    client.release();
    await pool.end();
}
checkDupes();
