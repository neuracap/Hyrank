require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkOptionConstraints() {
    const client = await pool.connect();

    try {
        console.log('Checking question_option table constraints...\n');

        // Check all constraints on question_option table
        const constraintsRes = await client.query(`
            SELECT 
                con.conname as constraint_name,
                con.contype as constraint_type,
                pg_get_constraintdef(con.oid) as definition
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE rel.relname = 'question_option'
            ORDER BY con.conname;
        `);

        console.log('Constraints found:');
        constraintsRes.rows.forEach(row => {
            console.log(`\n  ${row.constraint_name} (${row.constraint_type}):`);
            console.log(`    ${row.definition}`);
        });

        // Check primary key specifically
        const pkRes = await client.query(`
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = 'question_option'::regclass
            AND i.indisprimary;
        `);

        console.log('\n\nPrimary Key columns:');
        pkRes.rows.forEach(row => {
            console.log(`  - ${row.attname}`);
        });

    } catch (e) {
        console.error('\nERROR:', e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkOptionConstraints();
