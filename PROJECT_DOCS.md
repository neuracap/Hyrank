# Hyrank Internal MCQ Platform - Project Documentation

**TL;DR**  
This is a Next.js (App Router) based internal web application designed to digitize, review, and organize exam questions (MCQs). It features dedicated workflows for bilingual question translation (English/Hindi), custom LaTeX rendering for mathematics, and image/asset management. It runs on a PostgreSQL backend (Supabase) fully leveraging an edge runtime custom JWT authentication strategy.

---

## 1. Project Overview

The project serves internal employees or reviewers looking to manage large banks of previous exam papers. They digitize exam questions, link English questions with Hindi counterparts, resolve formatting (especially LaTeX math), and store solutions (including AI-generated text).

### High-Level Architecture
```text
[ Browser / User ] 
      |
      v
[ Vercel Edge Middleware ] (Validates JWT Session + Roles)
      |
      v
[ Next.js App Router (React) ] <---> [ Google Translate API & Gemini AI ]
      |
      v
[ Internal API Routes (/api/...) ] 
      |
      v
[ Supabase Connection Pool (*pg*) ]
      |
      v
[ PostgreSQL DB ] & [ Cloudinary (Assets) ]
```

---

## 2. Tech Stack

*   **Frontend**: Next.js (v16.0.7) utilizing App Router, React 19, TailwindCSS.
*   **Backend**: Next.js API Routes (Node.js/Edge).
*   **Database**: PostgreSQL (hosted on Supabase, connected via custom `pg` Pool).
*   **Authentication**: Custom JWT-based (`jose` library), strictly maintained at edge via middleware (`auth-edge.js`).
*   **Storage**: Cloudinary (for images/PDFs).
*   **Third-Party APIs**: Google Gemini (via `@google/generative-ai`), Google Translate API (`google-translate-api-x`).
*   **Hosting/CI-CD**: Vercel.
*   **Other Notable Libs**: `react-markdown`, `remark-math`, `rehype-katex` (LaTeX), `bcryptjs` (pwd hashing), `sharp` (image processing).

---

## 3. Repository Map

```text
.
├── app/                       # Next.js App Router root
│   ├── api/                   # Backend API routes (auth, paper, question, upload)
│   ├── dashboard/             # Main dashboard (list papers/stats)
│   ├── bilingdash/            # Bilingual dashboard
│   ├── bilingual/             # Bilingual workflow test pages
│   ├── login/                 # Login page
│   ├── globals.css            # Global stylesheet + Tailwind imports
│   └── page.js                # Root page (likely redirecting to login/dashboard)
├── components/                # Reusable React UI Components
│   ├── BilingualList.js       # Handles Eng/Hin side-by-side workflow
│   ├── Dashboard.js           # Core admin dashboard view
│   ├── QuestionCard.js        # Question display/edit logic
│   ├── Latex.js               # LaTeX rendering wrapper
│   └── ImageEditor.js         # Manipulating assets/fragments
├── lib/                       # Core utilities & services 
│   ├── auth-edge.js           # Edge-compatible session getters 
│   ├── jwt-utils.js           # Issue/Verify Tokens
│   └── db.js                  # PostgreSQL Pool initialization
├── scripts/                   # HEAVY utility zone (ad-hoc db management & data fixes)
│   ├── migrate-to-postgres.js # Script handling migration from SQLite to Supabase
│   ├── assign_all_papers.js   # Bulk allocation logic
│   ├── create-users.js        # User seed script
│   └── ...many others         # Diagnostic checks and automated data cleaning
├── public/                    # Static assets
└── package.json, next.config.mjs, vercel.json # Project configuration
```

---

## 4. Setup & Runbook

### Prerequisites
*   Node.js (LTS version, > 18.x)
*   NPM or Yarn
*   A running Supabase PostgreSQL instance

### Local Setup Steps
1. Clone the repository and `cd` into the directory.
2. Run `npm install`.
3. Create a `.env.local` file in the root based on the environment variables mentioned below.
4. Run scripts to seed users or schema if it's a fresh database: `node scripts/create-users.js`.
5. Run `npm run dev` to start the local Next.js server on `http://localhost:3000`.

### Environment Variables
| Name | Purpose | Sample / Placeholder |
|---|---|---|
| `GEMINI_API_KEY` | Using Google Gemini for AI operations | `AIzaSy...` |
| `DATABASE_URL` | Supabase pooled connection string (Port 6543) | `postgresql://postgres.[ref]:[pwd]@aws...pooler...6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | Non-pooled connection for raw schema setups/migrations | `postgresql://postgres.[ref]:[pwd]@aws...5432/postgres` |
| `CLOUDINARY_CLOUD_NAME`| Cloudinary hosting | `demo_cloud` |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | `123456789...` |
| `CLOUDINARY_API_SECRET`| Cloudinary Secret | `super-secret...` |
| `SESSION_SECRET` | Secret string for hashing JWT cookies | `your-super-secret-key...` |

### Commands
*   **Dev Server**: `npm run dev`
*   **Build**: `npm run build`
*   **Start Prod**: `npm run start`
*   **Lint**: `npm run lint`
*   **DB Check**: `node scripts/test-db-connection.js`
*   **Seed Users**: `node scripts/create-users.js`

### Common Troubleshooting
*   **Database Timeout:** The connection uses Supabase PGBouncer. Ensure you are using `DATABASE_URL` for app operations and `DIRECT_URL` for huge migrations. 
*   **LaTeX Not Rendering Correctly:** Inspect the `/scripts/fix_malformed_latex.js` and `/scripts/latex_lint.txt`. The LLM extraction often produces bad LaTeX blocks that break KaTeX.

---

## 5. Data & Database

**Type:** PostgreSQL (via Supabase). No formal ORM; raw queries are constructed via the `pg` package in `/lib/db.js` and individual components.

### Schema Overview
*   **`users`**: Custom user table (No Supabase Auth). (id, email, password_hash, is_admin).
*   **`exam`** / **`exam_section`**: Organizes exams (SSC, Bank, etc.) into sections. 
*   **`paper_session`**: A specific instance of an exam paper (e.g. "SSC CGL Tier 1 - March 2nd Shift 1"). 
*   **`question_version`**: Stores the actual question string, extracted JSON (`body_json`, `solution_json`), language, status, and paper linkages.
*   **`question_option`**: Associated multiple-choice options for a given question version.
*   **`question_links`** (_ASSUMPTION based on file names_): Maps identical questions across languages (English row <> Hindi row).
*   **`assignments`**: Tracks which internal user is assigned to digitize/review which paper session.

*(Note: The `scripts` API carries numerous standalone creation/migration scripts replacing Prisma/TypeORM.)*

---

## 6. Core Workflows

### A. Authentication Flow
1. User provides email/password at `/login`.
2. `api/auth/login/route.js` hashes payload and checks `users` table via `db.query`.
3. Issues a JWT using `jose` library signed by `SESSION_SECRET`.
4. Returns a `Set-Cookie` header (httpOnly, Path=/).
5. Subsequent requests pass through `middleware.js` (or edge handlers calling `requireAuth()`) to decode cookies.

### B. Setup & Paper Assignment
1. An admin assigns a paper (which already has parsed strings in `question_version` ingested possibly via PDF AI extractions) to an employee using the `Dashboard.js`.
2. Assignments map the user ID to the `paper_session_id`.

### C. Bilingual Linking Workflow (The core of the app)
1. User navigates to `app/bilingual/[id]/page.js`.
2. The UI fetches all questions for the English paper session and the mapped Hindi paper session.
3. `<BilingualList />` renders them side-by-side. 
4. The employee reads the English question, reads the Hindi candidate, selects correct matches to "link" them (creating a cross-reference row). 
5. Missing translations can be bridged using `google-translate-api-x` or `gemini` generated fallbacks.
6. The user manually updates formatting faults, saves the pair, and advances the test status.

---

## 7. APIs & Contracts

Most routes are standard Next.js Route Handlers (`route.js`). 
*   `GET /api/me`: Returns user role/name from JWT.
*   `POST /api/auth/login`: `{ email, password }` -> Returns `{ success, user }`.
*   `POST /api/auth/logout`: Clears cookie.
*   `GET /api/paper/...`: Retrieves paginated or specific `paper_session` blocks. 
*   `POST /api/question-review/...` / `api/bilingual/...`: Accepts JSON bodies capturing manual corrections (`body_json`, `status`, etc.) returning `{ success, message: "..." }`.

*Error Conventions:* Usually standard `return NextResponse.json({ error: "..." }, { status: 500 })`. 

---

## 8. Frontend Notes

*   **Pages/State**: React Context or Prop Drilling (e.g. `<BilingualList>` holding huge arrays of `englishQuestions` and `hindiQuestions` built from parent `useEffect` fetches). Next.js App Router means folders acting as layouts + pages. Most UI lives in `client` components due to `useState` logic (edit models, toggles).
*   **Rendering Strategy**: Often CSR wrapped inside basic SSR skeletons. 
*   **Styling**: `tailwindcss` configured via `postcss`. Components look to be bespoke rather than a rigid UI library (e.g. Radix or MUI aren't prominent). 
*   **Math**: `<Latex>` component wraps `react-markdown` with `remark-math` and `rehype-katex` specifically configured to suppress warnings and ensure block vs inline rendering.

---

## 9. Background Jobs / Cron / Queues

**NO FORMAL QUEUEING SYSTEM (BullMQ / Celery / Cron) IS PRESENT.**
*   *ASSUMPTION*: Heavy operations (like processing full PDFs or bulk applying translated changes) are executed locally or via long-running `node scripts/` calls by administrators. 
*   If a route takes >10 seconds in Vercel, it might timeout without an async job queue. 
*   No explicit Next.js CRON configurations found. 

---

## 10. Security & Permissions

*   **Auth Model**: Standard local auth model inside Postgres. Passwords hashed using `bcryptjs`.
*   **Access Control**: Handled programmatically checking `user.is_admin` decoded from the edge JWT via `requireAdmin()` from `lib/auth-edge.js`.
*   **Secrets**: Standard `.env.local`, exposed locally or stored in Vercel. 
*   **Rate Limits**: None explicitly defined in middleware. 

---

## 11. Observability

*   **Logging**: Standard `console.log()` / `console.error()`. No external agent (Datadog/Sentry) is installed.
*   **Analytics**: None present.
*   **Error Reporting**: Logs must be monitored manually via Vercel Runtime Logs.

---

## 12. Deployment

*   **Environment**: Hosted on Vercel.
*   **Settings**: A `vercel.json` dictates Standard `next build` mappings. 
*   **CI/CD**: No complex GitHub Actions are set up. Standard Vercel auto-deploy tracks the active deployment branch. 

---

## 13. Testing

*   **Strategy**: *Manual*.
*   **Frameworks**: None found (No Jest, Vitest, Cypress, or Playwright).
*   **How to Test**: Deploy to a dev sandbox or verify routes locally against a cloned PostgreSQL schema.

---

## 14. Known Issues & Tech Debt

1.  **Massive Script Clutter**: There are over 100 standalone scripts in `/scripts` handling ad-hoc database mutation, diagnostics (`debug_query.js`), and repairs (`fix_malformed_latex.js`). 
2.  **No ORM**: Application heavily leverages raw template literals querying PostgreSQL (e.g., `db.query('SELECT * FROM ...')`), leaving it vulnerable to type regressions, SQL injection (if unparameterized data sneaks through), and poor schema introspection code navigation.
3.  **Missing Tests**: The codebase lacks unit or e2e tests. 
4.  **Bilingual Gap Logic "Hack"**: A commented `TODO` inside assignment routines mentions falling back for missing bilingual links to assumptions based on folder struct rather than DB relations.

---

## 15. Roadmap / Next Steps (Safe Refactors)

1.  **Introduce an ORM**: Integrate Prisma or Drizzle to type-safe the schema instead of managing over 20+ dump/verify `.js` scripts.
2.  **Add Testing**: Install Vitest + React Testing Library. Start by snapshot-testing the `<Latex>` parsing engine to ensure formatting bugs stop regressing.
3.  **Clean up Scripts**: Move operational admin tasks from `/scripts` to true protected `/api/admin` routes or CLI commands powered by the established Next framework logic.
4.  **Implement Logging/Tracing**: Add Sentry for error tracking.

---

## 16. Assumptions & Unknowns

*   **ASSUMPTION**: Exact data ingestion pipeline (how `question_version` gets its initial JSON chunks) isn't fully enclosed in standard app workflows—it appears to heavily rely on the script folder performing ML operations offline or ad-hoc. 
*   **ASSUMPTION**: PDF processing / Cloudinary bindings may happen largely asynchronously offline and get synced via `upload_assets.js`.
*   **UNKNOWN**: Exact traffic requirements. Given lack of caching / queues, it's assumed to be strictly low concurrency (a handful of internal employees).

---

## 17. Quickstart Checklist (For a New Dev)

- [ ] Ensure Node 20+ is installed. Ensure Vercel CLI is present (optional).
- [ ] Pull latest `main` branch.
- [ ] Run `npm install`.
- [ ] Create `.env.local` using keys from infrastructure admin (needs DB URL, Gemini API, Cloudinary).
- [ ] Ensure Supabase IP mapping allows your connection if necessary.
- [ ] Run `node scripts/test-db-connection.js` to ensure the DB talks back.
- [ ] Run `npm run dev`.
- [ ] Navigate to `http://localhost:3000` and login with dev credentials. 
- [ ] Review `app/dashboard/page.js` to see the entry point for assigned workflows.
