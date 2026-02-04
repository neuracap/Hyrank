const db = require('./lib/db');

async function checkVersions() {
    const client = await db.connect();
    try {
        console.log("Checking for questions with multiple versions...");
        const res = await client.query(`
            SELECT question_id, COUNT(DISTINCT version_no) as v_count, array_agg(version_no) as versions
            FROM question_version
            GROUP BY question_id
            HAVING COUNT(DISTINCT version_no) > 1
            LIMIT 10;
        `);

        if (res.rows.length === 0) {
            console.log("✅ No questions found with multiple versions.");
        } else {
            console.log("⚠️ Found matching questions with multiple versions:", res.rows);
        }

        console.log("\nChecking for options with multiple versions...");
        const optRes = await client.query(`
            SELECT question_id, COUNT(DISTINCT version_no) as v_count 
            FROM question_option
            GROUP BY question_id
            HAVING COUNT(DISTINCT version_no) > 1
            LIMIT 10;
        `);

        if (optRes.rows.length === 0) {
            console.log("✅ No options found with multiple versions.");
        } else {
            console.log("⚠️ Found options with multiple versions:", optRes.rows);
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
    }
}

checkVersions();
