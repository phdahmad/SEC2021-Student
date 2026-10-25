# SEC2021 · My Work

A static student page for SEC2021 «مقدمة في الحوسبة والبرمجة» (Umm Al-Qura University). Each student signs in
with their university ID and a private access code and sees only their own marked
work, feedback and scanned sheets.

- No server. Everything is decrypted in the student's browser with Web Crypto.
- One encrypted bundle per student: AES-GCM-256, key from PBKDF2-SHA256
  (600,000 iterations) + HKDF; new salts and IVs on every build.
- Bundle file names are derived from the ID and the code, so neither the ID nor the
  file can be found without both.
- All bundles are padded to the same size.
- Student data is **never** in this repository. The build reads it from a folder
  outside the repo and refuses to output anything that is not encrypted.

## Commands (Node 20+)

| Command | What it does |
|---|---|
| `node tools/tokens.mjs` | Gives an access code to every student who has none |
| `node tools/build.mjs` | Encrypts all bundles into `dist/` and runs the guard |
| `node tools/guard.mjs` | Checks `dist/` again |
| `node tools/reissue.mjs --id <ID>` | New code for one student; re-encrypts only that bundle |
| `node tools/deploy.mjs` | Publishes `dist/` to `gh-pages` as one commit with no history |
| `npm test` | Security and importer tests (fake data only) |

Set the data folder in `local.config.json` (copy `local.config.example.json`).

Fonts: Inter, Crimson Pro, JetBrains Mono and Tajawal (Arabic) under the SIL Open Font License (`src/fonts/OFL.txt`).

## Teacher pages (never published)

| Command | What it does |
|---|---|
| `node tools/review-page.mjs --batch <ID>` | Writes `batches/<ID>/review.html` in the data folder |
| `node tools/results-from-review.mjs --batch <ID> [--approve "..."]` | Builds `results/<ID>.json` from the draft + saved review and lists the differences |
| `node tools/review-hub.mjs` | Writes `review/index.html` (one card per batch) in the data folder |
| `node tools/import-xlsx.mjs --roster` | Writes `roster.csv` from the marking workbook (never overwrites) |
| `python tools/scan-pages.py --batch MID --per-sheet 5 --stride 6 --extra 2` | Page images (`web/<ID>_p<n>.webp`, width 1400) from the scan PDF, placed by each student's scan position; checks blank and written pages |
| `node tools/import-xlsx.mjs --batch MID` (or `Q1`, `Q2`) | Imports marks already graded in Excel into `<ID>.draft.json`, matched by university ID, and compares every total with the workbook |

The importer reads `gradebook.json` (where the workbooks are) and `batches/<ID>/content.json`
(titles, topics, explanations, true/false key, page numbers, Arabic feedback per deducted part) from the data folder.

The feedback text is built by `review/feedback-core.js`, shared by the review page preview and
`results-from-review.mjs`. Feedback is Arabic; course terms stay in English and are isolated with `<bdi>`.

## Checks

- `npm test` — node tests with fake data.
- `node tests/demo.mjs <empty dir>` — a full fake demo (nine fake students, real-strength build).
- `python tests/browser-check.py <dist> <tokens.csv> <shots>` — student page, Arabic/English, light/dark, 360/1280 px.
- `python tests/review-check.py <data> <shots>` — hub and review pages from `file://`.
