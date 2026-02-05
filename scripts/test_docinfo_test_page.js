require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function testDocInfoQuery() {
    const paperSessionId = '59527c77-afe9-48f7-80ed-b317f3150253';
    const client = await pool.connect();

    try {
        console.log('Testing Doc Info Query for Test Page session:', paperSessionId);

        const docQuery = `
            SELECT j.source_pdf_path, j.notes, d.file_path as mmd_path
            FROM paper_session ps 
            JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            JOIN import_job j ON d.import_job_id = j.import_job_id
            WHERE ps.paper_session_id = $1
        `;

        const docRes = await client.query(docQuery, [paperSessionId]);
        const docInfo = docRes.rows[0] || {};

        console.log('\nDoc Info Result:');
        console.log(JSON.stringify(docInfo, null, 2));

        if (docInfo.source_pdf_path) {
            console.log('\n✅ source_pdf_path found:', docInfo.source_pdf_path);
        } else {
            console.log('\n❌ source_pdf_path is missing!');
        }

    } catch (e) {
        console.error('\nERROR:', e.message);
        console.error('Stack:', e.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

testDocInfoQuery();
