import { Pool } from 'pg';

// IMPORTANT: must use DATABASE_URL (Supabase pooler on port 6543).
// Supabase's DIRECT_URL (port 5432) is IPv6-only and Railway runtime
// has no outbound IPv6 — every connection attempt against the direct
// URL fails immediately and 500s every API route (including /auth/login).
//
// To survive PgBouncer transaction mode in a long-lived SSR pool:
//   - keep `max` small so we don't blow Supabase's pooler quota
//   - tighten idle timeout so stuck connections are reaped fast
//   - tighten connect timeout so the UI gets a real error instead of
//     hanging at the 15s pooler-checkout ceiling
//   - allowExitOnIdle so dev hot-reload doesn't leak sockets
const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // max:2 keeps total pressure on Supabase's pooler well below the
    // free-tier ceiling (15 server connections × 200 client slots in
    // PgBouncer). Each Railway instance can still serve two concurrent
    // requests; if a third lands while both are busy, pg queues it
    // internally rather than blocking on PgBouncer's 15s checkout
    // ceiling. Trade: slightly higher request-queue latency for
    // dramatically fewer ECHECKOUTTIMEOUT errors.
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    allowExitOnIdle: false,
});

pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err);
});

export default pool;
