
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local manually since we are not in Next.js runtime
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        // Skip comments and empty lines
        if (!line || line.startsWith('#')) return;

        const firstEqualsIndex = line.indexOf('=');
        if (firstEqualsIndex !== -1) {
            const key = line.substring(0, firstEqualsIndex).trim();
            const value = line.substring(firstEqualsIndex + 1).trim();
            process.env[key] = value;
        }
    });
}

console.log('DIRECT_URL:', process.env.DIRECT_URL ? 'Loaded' : 'Not Loaded');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Not Loaded');
if (process.env.DIRECT_URL) console.log('DIRECT_URL starts with:', process.env.DIRECT_URL.substring(0, 15));

async function checkStatus() {
    // Dynamic import to ensure env vars are loaded first
    const db = (await import('../lib/db.js')).default;

    console.log("Connecting to DB...");
    const client = await db.connect();
    try {
        console.log("Connected. Querying...");
        const res = await client.query(`
            SELECT status, COUNT(*) 
            FROM question_links 
            GROUP BY status
        `);
        console.table(res.rows);
    } catch (e) {
        console.error("Query Error:", e);
    } finally {
        client.release();
        process.exit(0);
    }
}

checkStatus();
