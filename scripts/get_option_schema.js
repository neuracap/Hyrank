const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function getSchema() {
    try {
        const result = await pool.query(`
            SELECT 
                column_name, 
                data_type, 
                is_nullable,
                column_default
            FROM information_schema.columns 
            WHERE table_name = 'question_option'
            ORDER BY ordinal_position
        `);

        console.log('--- question_option Schema ---\n');
        console.log('Column Name'.padEnd(25) + 'Type'.padEnd(20) + 'Nullable'.padEnd(12) + 'Default');
        console.log('-'.repeat(80));

        result.rows.forEach(row => {
            const name = row.column_name.padEnd(25);
            const type = row.data_type.padEnd(20);
            const nullable = row.is_nullable.padEnd(12);
            const def = row.column_default || '';
            console.log(`${name}${type}${nullable}${def}`);
        });

        console.log('\n--- NOT NULL columns (required) ---');
        result.rows
            .filter(r => r.is_nullable === 'NO')
            .forEach(r => console.log(`  - ${r.column_name} (${r.data_type}) ${r.column_default ? `[default: ${r.column_default}]` : ''}`));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

getSchema();
