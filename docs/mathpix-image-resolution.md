# Resolving Mathpix-style image refs in body_json / option_json / solution_json

## Problem

Some PYQ questions have inline image references stored as relative paths
inside the JSON columns (`body_json.text`, `option_json.text`,
`solution_json.text`):

- Markdown form: `![](./images/<uuid>-NN.png)` or `![](images/<uuid>-NN.png)`
- LaTeX form:    `\includegraphics{./images/<uuid>-NN.png}`

These come from the Mathpix OCR pipeline. The relative path was correct on
the ingest machine where the MMD + `images/` folder lived together, but is
useless to anything outside that filesystem (the Hyrank web app, a local AI
on someone's laptop, a re-ingest into a fresh DB).

The actual image files were uploaded to Cloudinary and recorded in the
`asset` table — but the inline JSON refs were never rewritten to point at
those URLs. The link between the relative ref and the asset row is **only
the filename**, which is not unique across papers.

## Where this is partially handled today

| Location | What it does |
|----------|--------------|
| `app/api/paper/clean-images/route.js:31` (`resolveLocalPath`) | Filename-only lookup against the `asset` table. Used to assign cropped option images and create `_gs` grayscale variants. |
| `app/api/assets/route.js` | Serves a single asset by filename — strips the legacy Windows prefix and constructs a Cloudinary URL with multiple fallback strategies. |
| `app/api/pdf/route.js` | Same pattern at PDF granularity — three Cloudinary search strategies (prefix, folder + filename, global filename). |

None of these resolves *all* refs in a body of text in one pass. Hence this
algorithm.

## The algorithm

### Inputs
- `text` — a string from `body_json.text` / `option_json.text` /
  `solution_json.text`.
- `paper_session_id` — used to scope filename matches so we don't pick the
  wrong paper's image when filenames collide.

### Output
- `resolved_text` — same text with each `./images/...` ref replaced by an
  absolute Cloudinary URL.
- `image_refs` — `{ resolved: <count>, unresolved: [<filename>...] }`
  metadata so callers know what's missing.

### Step 1 — Extract refs

```js
const IMG_RE = /(!\[[^\]]*\]\((?:\.\/)?images\/([^)\s]+)\))|(\\includegraphics(?:\[[^\]]*\])?\{(?:\.\/)?images\/([^}]+)\})/g;
// capture group 2 = markdown filename
// capture group 4 = latex filename
```

Walk the regex over `text` and collect `[{ raw, filename }, …]`.
Early-exit if zero matches.

### Step 2 — Get the paper's image-folder context

```sql
SELECT j.source_pdf_path, d.file_path AS mmd_path
FROM paper_session ps
JOIN raw_mmd_doc d ON d.raw_mmd_doc_id = ps.raw_mmd_doc_id
JOIN import_job  j ON j.import_job_id   = d.import_job_id
WHERE ps.paper_session_id = $1
```

`mmd_path` is something like:
```
.../mathpix_raw_zips/<exam-slug>/<paper-folder>/<file>.mmd
```
Images for this paper live alongside it in:
```
.../mathpix_raw_zips/<exam-slug>/<paper-folder>/images/<filename>
```
Extract `<paper-folder>` and use it as the disambiguator in step 3.

### Step 3 — Resolve filename → asset row (two strategies, in order)

**3a. Path-scoped match (preferred — disambiguates collisions):**

```sql
SELECT asset_id, local_path, original_name, mime_type
FROM asset
WHERE local_path ILIKE '%' || $1 || '%images%' || $2
ORDER BY length(local_path) DESC
LIMIT 1;
-- $1 = paper folder name (from mmd_path)
-- $2 = filename
```

**3b. Filename-only fallback (matches existing `clean-images` behaviour):**

```sql
SELECT asset_id, local_path, original_name, mime_type
FROM asset
WHERE local_path LIKE '%' || $1 OR original_name = $1
LIMIT 1;
-- $1 = filename
```

3a is the safe path. 3b is the lossy fallback for old rows whose
`local_path` doesn't include the paper folder. **Filename-only matching is
unsafe by itself** — Mathpix names images like `<job-uuid>-<page>.jpg` per
import, and `image-09.jpg`-style filenames recur across papers.

### Step 4 — `asset.local_path` → public URL (3 branches)

```js
function toPublicUrl(localPath) {
    if (!localPath) return null;

    // (a) Already a Cloudinary URL — use directly
    if (/^https?:\/\//i.test(localPath)) return localPath;

    // (b) Windows path under mathpix_raw_zips → constructed Cloudinary URL
    const PREFIX = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\mathpix_raw_zips\\';
    if (localPath.toLowerCase().startsWith(PREFIX.toLowerCase())) {
        const rel = localPath.slice(PREFIX.length).replace(/\\/g, '/').replace(/ /g, '-');
        return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${rel}`;
    }

    // (c) Other local paths — fall back to Cloudinary Search API
    //     (folder = pdfs/<subfolder>, filename = basename)
    //     same three-strategy search as /api/pdf
    return null; // or trigger search asynchronously
}
```

Branch (b) mirrors what `/api/assets` does for legacy Windows paths. Branch
(c) is the heavy fallback — only worth running when (a) and (b) miss.

### Step 5 — Replace in text + emit metadata

```js
let resolved = text;
const unresolved = [];
for (const m of matches) {
    const asset = await lookupAsset(m.filename, paperFolder);
    const url = asset ? toPublicUrl(asset.local_path) : null;
    if (url) {
        resolved = resolved.split(m.raw).join(`![](${url})`);
    } else {
        unresolved.push(m.filename);
    }
}
return {
    text: resolved,
    image_refs: { resolved: matches.length - unresolved.length, unresolved },
};
```

## Sharp things to remember

1. **Cache per `paper_session_id`.** A 100-question paper can reference the
   same images folder 50+ times. Build the `paperFolder` lookup once and
   batch the asset lookup with a single `WHERE original_name = ANY(...)` for
   all filenames in the paper.

2. **Filename collisions are real.** Always prefer 3a; only fall back to 3b
   when 3a returns 0 rows. If 3b returns multiple candidates, prefer the
   row whose `local_path` shares the longest common subpath with the
   paper folder.

3. **`_gs` (grayscale) variants exist.** `clean-images` creates
   `<original>_gs.<ext>` siblings as separate `asset` rows. Refs in
   body_json may point to either form. Filename-only matching can surface
   a stale grayscale version when the original was wanted.

4. **Don't mutate `body_json` at read time without a feature flag.**
   Resolution should produce a *new* output (e.g. for export, for the
   review UI). Rewriting the column in place is a separate decision —
   safer as a one-off backfill script with rollback.

## Where this should live

Three options:

| Option | Pros | Cons |
|--------|------|------|
| `lib/imageRefs.js` shared utility (`extractImageRefs`, `resolveImageRefs(text, paperSessionId)`) | Reusable across export, mock builder, review UI | Needs a small abstraction + tests |
| Inline in `app/api/pyq/export/route.js` | Fastest path | Copy-paste risk later |
| Backfill script that rewrites `body_json.text` to absolute URLs | Every downstream consumer gets resolved URLs for free | High blast radius — touches many rows; needs reversibility |

Recommended: utility + use it in export first. Once verified on a few
papers, run the backfill in a separate one-off script.

## Re-using this for the PYQ export

The current `/api/pyq/export` filters out `has_image = true` to dodge this
problem entirely. With the algorithm in place, that filter can be dropped
in favour of:

- Resolving inline refs server-side before responding.
- Including the `image_refs` metadata per question in the export payload
  so the local AI can surface unresolved refs explicitly instead of
  silently embedding `./images/X.png`.

## Related files

- `app/api/paper/clean-images/route.js` — current filename-only resolver
- `app/api/assets/route.js` — Windows-path → Cloudinary URL mapping
- `app/api/pdf/route.js` — same pattern for PDFs (reference for the
  three-strategy Cloudinary search)
- `app/api/pyq/export/route.js` — consumer that needs this
