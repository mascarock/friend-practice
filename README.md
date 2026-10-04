# Local Budget

A local budget app for Paola in marketing. Import an approved CSV, record spending on this computer, and see the remaining balance immediately. Approved amounts are read-only.

The interface uses a near-black background, white type, large totals, thin rules, and open space. All interface copy, validation messages, sample data, and Gemma instructions are in English.

## Run locally

Requires Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127). The server binds only to this computer.

1. Choose **Load a local CSV**, or **Load sample data** to explore.
2. Sample budgets and spend entries are clearly labeled **SAMPLE DATA**. They are not Paola’s real budget or real spending.
3. Use **Save spend locally** to record an amount against an approved item.
4. Remaining amounts update immediately; approved amounts stay fixed.

Loading another CSV or the sample replaces the current budget and spend log. **Clear spend log** retains the approved budget. **Delete local data** removes both from this browser.

## CSV format

```csv
source,category,item,approved_budget
SAMPLE DATA,Digital advertising,Google Ads,5000
```

- Required columns: `category`, `item`, `approved_budget`.
- Optional column: `source`. Use `SAMPLE DATA` to label a sample.
- Existing Spanish headers (`categoria`, `partida`, `presupuesto_aprobado`, `origen`) and the legacy `DATOS DE EJEMPLO` sample marker remain supported.
- Commas or semicolons can separate columns. Decimal points and European decimal commas are supported; quote values containing the delimiter.
- Lines beginning with `#` are ignored.
- Amounts display with English separators. No currency is assumed.

The [downloadable sample](public/sample-presupuesto.csv) has the same approved amounts as the built-in sample. Imported item names and user notes are preserved as supplied.

## Optional local Gemma

Gemma (`gemma3:1b`) reads the local CSV and spend log through Ollama at `127.0.0.1:11434`. The prompt requests English and instructs the model to acknowledge unknown figures. Responses containing numbers outside the known local figures are withheld. This numeric check does not validate every statement a model might make.

Install Ollama and download the model separately if desired:

```bash
ollama pull gemma3:1b
```

Start Ollama, then choose **Ask local Gemma**. If Ollama or the model is unavailable, the app shows a connection message, never a simulated transcript. Budget tracking works without Gemma.

## Privacy

Budgets and spending stay in this browser’s `localStorage`. Gemma requests go only to the local app server and local Ollama. There is no Power BI connection, cloud API, remote database, synchronization, analytics, or external font request. Existing storage keys remain compatible.

## Checks

```bash
npm test
npm run lint
npm run build
```

Tests cover budget arithmetic, immutable approvals, local persistence, sample labeling, legacy CSV compatibility, invalid spend amounts, English money formatting, and local Gemma failure and grounding behavior. Model responses in tests are mocked; no model is needed.

Use `npm start` to run the production build on `127.0.0.1:43127`.

## Local Computer for macOS

`npm run desktop:dmg` (also `npm run build:mac`) tests the crew, builds the
production interface, and packages an Apple Silicon Electron app using the
Vibefy companion shell and packaging pattern. It writes
`/Users/nick/Desktop/Local-Computer.dmg`. Open the DMG, drag **Local Computer**
to **Applications**, and launch it. Electron bundles its own runtime; no terminal
or separate Node installation is needed. This local build is ad-hoc signed,
not notarized for public distribution.

The five-bot workspace at `/computer` accepts **SAMPLE DATA** only. Its initial
sample has no spending. Clerk records the positive amount you type against an
existing CSV item; Watcher computes strict overspend in code; Remainder keeps
the approved total fixed. Loading another sample clears the sample spend log.
The existing English dashboard remains at `/`.

The Mac workspace is a liquid-glass dark UI: rounded frosted near-black
panels and thin light edges. Each assistant has its own accent and a small idle
motion: Ledger blue, Clerk green, Watcher orange, Remainder teal, and Note
purple. Reduced motion turns that animation off. The app window is audio-muted.
The 11:21 color-pass screenshots are in [docs/screenshots](docs/screenshots):

1. [01-sidebar.png](docs/screenshots/01-sidebar.png) — the five assistants.
2. [02-ledger.png](docs/screenshots/02-ledger.png) — Ledger, Meta Ads approved 3,200.
3. [03-watcher-answer.png](docs/screenshots/03-watcher-answer.png) — Watcher, only the Q4 trade fair, over by 200.
4. [04-remainder.png](docs/screenshots/04-remainder.png) — approved 16,700, spent 4,700, remaining 12,000.
5. [05-note.png](docs/screenshots/05-note.png) — Note's sentence, checked against the tool.
6. [06-clerk.png](docs/screenshots/06-clerk.png) — the sample spend saved locally; the approved amount unchanged.


The Electron shell serves its authenticated window on `127.0.0.1:43130`.
External navigation, remote renderer requests, and permissions are blocked.
Server-side model requests can reach only Ollama at `127.0.0.1:11434`, without
redirects. Start local Ollama with `gemma3:1b` for Note. There is no cloud
fallback, pairing, SSH, account, credential, or updater integration. Workspace
storage lives in `~/Library/Application Support/Local Computer`.

Note computes its tool result before asking Gemma, uses Claude's prompts and
`withholdNarration`, and displays the computed result when narration fails
validation or Ollama is unavailable. Narration must be one short English
sentence and retains the SAMPLE DATA label. Claude's three grounding files
are imported unchanged by Codex.

`npm run desktop:verify` launches the packaged app with a temporary isolated
sample profile, exercises all five bots (including real local Ollama), checks
persistence and local connection restrictions, and records screenshots plus a
silent walkthrough under `/Users/nick/friend-practice-video/`. It never plays
the recording or any audio. `LOCAL_COMPUTER_APP` can point verification at a
copied app executable, including one installed from the DMG.
Verification also compares every approved row before and after the spend,
checks the packaged grounding hashes against the current source, and uses
ffprobe to confirm that the walkthrough has no audio stream. The build manifest
and verification results are saved in `verification.json` beside the captures.

Desktop builds use `.next-desktop/`, separate from the running development
server's `.next/` output. Build output lives in `dist/` and `build/`, all ignored by Git. Desktop source
is in `desktop/`; the reference companion's child shutdown helper is reused.
The packaging hook copies Next's traced standalone dependencies before signing.
