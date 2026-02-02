/**
 * Migrate from LOCAL PostgreSQL to Supabase PostgreSQL
 * WARN: This will reset Supabase public tables to ensure a clean migration
 * OPTIMIZED: Uses batch inserts for faster migration on slow networks
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

// SQL to wipe Supabase public schema (clean slate)
const WIPE_SUPABASE_SQL = `
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO postgres;
  GRANT ALL ON SCHEMA public TO public;
`;

// Source: Your LOCAL PostgreSQL
const localDB = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

// Destination: Supabase PostgreSQL (Cloud)
const supabaseDB = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    // Increase connection timeout for slow networks
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 30000,
});

async function migrate() {
    console.log('🚀 Starting migration from LOCAL PostgreSQL to Supabase...');
    console.log('⚡ Optimized for slow networks (Batch Inserts)\n');

    try {
        // Step 0: Clean Supabase
        console.log('🧹 Cleaning Supabase database...');
        await supabaseDB.query(WIPE_SUPABASE_SQL);
        console.log('✅ Supabase database is clean\n');

        // Step 1: Create Auth Tables
        console.log('📋 Creating Auth tables...');
        await supabaseDB.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        paper_session VARCHAR(100) NOT NULL,
        assigned_at TIMESTAMP DEFAULT NOW(),
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        question_id INTEGER,
        action VARCHAR(50) NOT NULL,
        changes JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('✅ Auth tables created\n');

        // Step 2: Get tables
        console.log('📊 Checking tables in local PostgreSQL...');
        const tablesResult = await localDB.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

        const tables = tablesResult.rows.map(r => r.table_name);
        console.log(`Found tables: ${tables.join(', ')}\n`);

        // Step 3: Migrate each table
        for (const tableName of tables) {
            if (['users', 'assignments', 'audit_log', 'app_user', 'django_migrations'].includes(tableName) || tableName.startsWith('auth_')) {
                console.log(`⚠️  Skipping structure for ${tableName} (Auth/System table)`);
                continue;
            }

            console.log(`\n--- Migrating table: ${tableName} ---`);

            // Get schema
            const schemaResult = await localDB.query(`
        SELECT column_name, data_type, is_nullable, column_default, udt_name
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);

            const columns = schemaResult.rows;

            // Create table
            const createTableSQL = generateCreateTableSQL(tableName, columns);
            await supabaseDB.query(createTableSQL);
            console.log(`✅ Table structure created`);

            // Get Data
            const dataResult = await localDB.query(`SELECT * FROM ${tableName}`);
            const rows = dataResult.rows;
            console.log(`Found ${rows.length} rows to migrate`);

            if (rows.length > 0) {
                await batchInsert(supabaseDB, tableName, rows, columns, 200);
            }
        }

        console.log('\n\n🎉 Migration completed successfully!');
        console.log('\nNext steps:');
        console.log('1. Run: node scripts/create-users.js');

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
    } finally {
        await localDB.end();
        await supabaseDB.end();
    }
}

// BATCH INSERT FUNCTION
async function batchInsert(client, tableName, rows, columns, batchSize) {
    const columnNames = columns.map(c => c.column_name); // Use schema columns to ensure order
    // Filter rows to match schema columns (in case local DB yields slightly different structure, though unlikely)

    // NOTE: We assume rows keys match columnNames. 
    // Better to map explicit column names from the row objects or use the ordered columns.

    for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const values = [];
        const placeholders = [];

        let paramIndex = 1;

        for (const row of chunk) {
            const rowPlaceholders = [];
            for (const colName of columnNames) {
                rowPlaceholders.push(`$${paramIndex}`);
                values.push(row[colName]);
                paramIndex++;
            }
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
        }

        // Quote table name and column names to handle reserved keywords
        const quotedTableName = `"${tableName}"`;
        const quotedColumnNames = columnNames.map(c => `"${c}"`).join(', ');

        const query = `
      INSERT INTO ${quotedTableName} (${quotedColumnNames})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT DO NOTHING
    `;

        try {
            await client.query(query, values);
            process.stdout.write(`\r✅ Migrated ${Math.min(i + batchSize, rows.length)}/${rows.length} rows...`);
        } catch (err) {
            console.error(`\n❌ Error inserting batch at index ${i}:`, err.message);
        }
    }
    process.stdout.write('\n');
}

function generateCreateTableSQL(tableName, columns) {
    const columnDefs = columns.map(col => {
        let def = `"${col.column_name}" `; // Quote column name

        if (col.data_type.includes('character varying') || col.data_type === 'text') {
            def += 'TEXT';
        } else if (col.data_type === 'integer' || col.data_type === 'bigint') {
            def += 'INTEGER';
        } else if (col.data_type === 'boolean') {
            def += 'BOOLEAN';
        } else if (col.data_type.includes('timestamp')) {
            def += 'TIMESTAMP';
        } else if (col.data_type === 'jsonb' || col.data_type === 'json') {
            def += 'JSONB';
        } else if (col.data_type === 'uuid') {
            def += 'UUID';
        } else if (col.data_type === 'bytea') { // Handle bytea if exists
            def += 'BYTEA';
        } else if (col.data_type === 'ARRAY') {
            // Handle Arrays based on udt_name (underscore usually denotes array type in Postgres)
            if (col.udt_name.includes('int')) {
                def += 'INTEGER[]';
            } else if (col.udt_name.includes('bool')) {
                def += 'BOOLEAN[]';
            } else {
                def += 'TEXT[]'; // Default to text array for safety
            }
        } else {
            def += col.data_type.toUpperCase();
        }

        if (col.is_nullable === 'NO') {
            def += ' NOT NULL';
        }

        return def;
    }).join(',\n  ');

    return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columnDefs}\n)`; // Quote table name
}

migrate().catch(console.error);
