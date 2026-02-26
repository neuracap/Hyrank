require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
    try {
        const res = await pool.query(`
      SELECT ps.paper_session_id, ps.exam_id, e.name as exam_name, ps.paper_date, ps.shift_number
      FROM paper_session ps
      LEFT JOIN exam e ON ps.exam_id = e.exam_id
      WHERE ps.exam_id IS NOT NULL 
      LIMIT 2
    `);
        console.log("With Exam ID:", res.rows);

        // Also check if raw_mmd_doc joining to import_job gets the exam_id
        const res2 = await pool.query(`
      SELECT 
          ps.paper_session_id, e.name as exam_name_direct,
          j.exam_id as job_exam_id, e2.name as job_exam_name,
          j.exam_date, j.shift
      FROM paper_session ps
      LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
      LEFT JOIN import_job j ON d.import_job_id = j.import_job_id
      LEFT JOIN exam e ON ps.exam_id = e.exam_id
      LEFT JOIN exam e2 ON j.exam_id = e2.exam_id
      WHERE j.exam_id IS NOT NULL OR ps.exam_id IS NOT NULL
      LIMIT 2
    `);
        console.log("With Import Job/Session Exam ID:", res2.rows);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
