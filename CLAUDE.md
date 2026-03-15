# CLAUDE.md — Hyrank Backend Development Guide

## What is this project?

Hyrank is an internal bilingual (English/Hindi) MCQ exam question curation platform. It ingests PDFs of competitive exam papers (UPSC, SSC, Banking), parses them into structured questions, and provides admin workflows for review, linking bilingual pairs, verification, and publishing.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) — Node.js >=20.9.0 |
| Database | PostgreSQL on Supabase — raw SQL via `pg` (no ORM) |
| Auth | Custom JWT with native Web Crypto (edge-compatible) |
| AI | Google Gemini (`@google/generative-ai`), Anthropic Claude (`@anthropic-ai/sdk`) |
| Translation | `google-translate-api-x` with LaTeX placeholder protection |
| Assets | Cloudinary (image upload/storage) |
| Math | KaTeX + react-katex for LaTeX rendering |
| Styling | Tailwind CSS v4 |
| Deploy | Railway (primary), Vercel (configured) — auto-deploy on push to main |

## Project Structure

```
app/
  api/          → All backend API routes (this is where you work)
  [pages]/      → Server components (auth gate + render client component)
components/     → Client components ('use client') — UI layer
lib/
  db.js         → PostgreSQL pool (max:5, keepAlive, 30s connect timeout)
  auth-edge.js  → getCurrentUser(), requireAuth(), requireAdmin(), setSessionCookie()
  auth.js       → hashPassword(), verifyPassword() (bcryptjs, Node-only)
  jwt-utils.js  → createSessionToken(), verifySessionToken() (Web Crypto, edge-safe)
  audit.js      → Audit logging utility
  questionCleaner.js → OCR text cleanup
scripts/        → One-off admin/migration scripts (100+, not production code)
```

## Database Conventions

### Connection
```js
import db from '@/lib/db';
// Simple query
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
// Transaction
const client = await db.connect();
try {
  await client.query('BEGIN');
  // ... mutations ...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

### Naming
- Tables: `snake_case` (e.g. `question_version`, `paper_session`, `exam_section`)
- Primary keys: `{table}_id` — UUID type for domain entities, serial for internal tables (e.g. `users.id`)
- Foreign keys: reference the PK name directly (e.g. `exam_id`, `paper_session_id`)
- Status columns: UPPERCASE strings (`DRAFT`, `MANUALLY_CORRECTED`, `FLAGGED`, `APPROVED`, `PUBLISHED`, `PRODUCTION`)
- Language: `'EN'` or `'HI'`
- JSON columns: suffix `_json` (JSONB type) — `body_json`, `solution_json`, `meta_json`, `option_json`
- Timestamps: `created_at`, `updated_at` (timestamptz, default `NOW()`)
- Booleans: `is_verified`, `has_image`, `is_correct`, `is_admin`

### Key Tables
- `users` — id (serial), email, password_hash, is_admin, name
- `exam` → `exam_section` → `paper_session` → `question_version` → `question_option`
- `question_version` — composite key (question_id, version_no, language), has body_json, solution_json, status
- `question_option` — composite key (question_id, version_no, language, option_key), option_json, is_correct
- `question_links` — pairs english_question_id ↔ hindi_question_id with similarity_score
- `question_group` — RC/Cloze passage storage (group_type, passage_en, passage_hi)
- `daily_quiz` / `daily_quiz_question` — self-contained daily quiz system
- `asset` / `question_asset_map` — Cloudinary image references

### Parameterized Queries ONLY
Always use `$1, $2, ...` placeholders. Never interpolate user input into SQL strings.
```js
// CORRECT
await db.query('SELECT * FROM users WHERE email = $1', [email]);
// NEVER DO THIS
await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

## API Route Patterns

### File Location
`app/api/{domain}/{action}/route.js`

Examples: `/api/question/save`, `/api/paper/advance-status`, `/api/daily-quiz/check`

### Auth Guard — First Lines of Every Protected Route
```js
import { getCurrentUser } from '@/lib/auth-edge';

// Admin-only route
const user = await getCurrentUser();
if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// Auth-only route (any logged-in user)
const user = await getCurrentUser();
if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### Response Format
```js
// Success
return NextResponse.json({ success: true });
return NextResponse.json({ success: true, data: result.rows });
return NextResponse.json({ questions: result.rows });

// Error
return NextResponse.json({ error: 'Descriptive message' }, { status: 400 });
return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
return NextResponse.json({ error: 'Not found' }, { status: 404 });

// Unique constraint violation
if (e.code === '23505') {
    return NextResponse.json({ error: 'Already exists' }, { status: 409 });
}
```

### Error Handling
```js
try {
    // ... route logic ...
} catch (e) {
    console.error('Descriptive context:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
}
```

### Request Parsing
```js
// GET with query params
const { searchParams } = new URL(req.url);
const id = searchParams.get('id');

// POST/PATCH/DELETE with JSON body
const { field1, field2 } = await req.json();
```

### Admin vs Public Pattern
Some routes serve both admin and public users via a `mode` query param:
```js
const mode = searchParams.get('mode'); // 'admin' or default (public)
if (mode === 'admin') {
    const user = await getCurrentUser();
    if (!user?.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Return full data
} else {
    // Return stripped/public data
}
```

## Auth System

- JWT stored in httpOnly cookie named `session` (7-day expiry)
- `getCurrentUser()` returns `{ id, email, name, isAdmin }` or `null`
- Password hashing: `bcryptjs` (Node-only, used in login/registration routes)
- JWT: native Web Crypto HMAC-SHA256 (edge-compatible, no Node.js Buffer)
- Secret: `SESSION_SECRET` env var

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase PostgreSQL (pooled, port 6543) |
| `DIRECT_URL` | Supabase PostgreSQL (direct, port 5432) |
| `SESSION_SECRET` | JWT signing key |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account |
| `CLOUDINARY_API_KEY` | Cloudinary key |
| `CLOUDINARY_API_SECRET` | Cloudinary secret |
| `GEMINI_API_KEY` | Google Gemini AI |
| `ANTHROPIC_API_KEY` | Anthropic Claude AI |

## Translation Pattern
The `/api/translate` route protects LaTeX before translating:
1. Extract LaTeX (`$...$`) → replace with `__LATEX_N__` placeholders
2. Translate plain text via `google-translate-api-x`
3. Restore LaTeX from placeholders

## Image Upload Pattern
`POST /api/upload` accepts multipart form-data or base64 data URLs.
- Uploads to Cloudinary folder `assets/{exam_slug}/{session_slug}/`
- Stores metadata in `asset` table, links via `question_asset_map`
- When `question_id` is missing (new entry), uses `assets/manual-entry/` folder

## Deployment

- **Push to `main` branch triggers auto-deploy** on Railway
- Build: `npx next build` — always verify build passes before pushing
- Railway config: NIXPACKS builder, healthcheck at `/api/health`
- DB: Supabase free tier — can cold-start slowly, hence 30s connection timeout + keepAlive

## Rules

1. **Backend first** — Build API routes and DB schemas only. Do not create frontend pages/components unless explicitly asked.
2. **Always parameterize SQL** — Never string-interpolate into queries.
3. **Always auth-guard** — Every admin route checks `getCurrentUser()` + `isAdmin`. Every user route checks `getCurrentUser()`.
4. **Use transactions** for multi-table mutations — `BEGIN`/`COMMIT`/`ROLLBACK` with `client.release()` in `finally`.
5. **Status values are UPPERCASE strings** — `DRAFT`, `APPROVED`, `PUBLISHED`, `MANUALLY_CORRECTED`, `FLAGGED`, `PRODUCTION`.
6. **UUID for domain PKs** — Use `gen_random_uuid()` or let Supabase generate. Serial only for `users.id`.
7. **Consistent error format** — Always `{ error: 'message' }` with appropriate HTTP status.
8. **Log errors with context** — `console.error('Quiz question save error:', e)` not just `console.error(e)`.
9. **No ORMs, no Prisma** — Raw SQL with `pg` pool. This is intentional for performance and control.
10. **Bilingual fields** — Most content columns come in pairs: `*_en` and `*_hi` (or `language: 'EN'/'HI'` in versioned tables).
11. **Don't modify Navigation.js or layout.js** unless explicitly asked — frontend changes need approval.
12. **SQL for new tables** — When creating new features, provide the `CREATE TABLE` SQL separately so the user can run it on Supabase.
13. **Keep API routes self-contained** — Each route file handles its own auth, validation, DB query, and response. No shared middleware chain.
14. **Test the build** — Run `npx next build` after changes to catch compile errors before committing.
