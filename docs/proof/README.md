# Proof for Best Use of Gemma

This folder exists so a judge can verify the Gemma story quickly.

## What Gemma does

Local Computer has five local assistants. Four are deterministic budget tools. **Note** is the Gemma part: it asks local **Gemma `gemma3:1b`** through Ollama at `127.0.0.1:11434` to write one short English sentence for Paola.

Gemma does not decide the math. Watcher and Note first compute a local tool result in code. For the sample walkthrough:

- approved total: `16700`
- spent total: `6900`
- remaining total: `9800`
- over-budget line: `Events / Q4 trade fair`, approved `4500`, spent `4700`, over `200`

The sentence that may be shown is:

```text
SAMPLE DATA: the Q4 trade fair is over budget by 200.
```

## Guardrail proof

Run:

```bash
npm run proof:note-guard
```

The run writes [note-guard-proof.txt](note-guard-proof.txt). It checks three candidate Gemma sentences against the same `withholdNarration` function used by the app:

| Case | Candidate sentence | Result |
| --- | --- | --- |
| Good | `SAMPLE DATA: the Q4 trade fair is over budget by 200.` | accepted |
| Wrong item | `SAMPLE DATA: Google Ads is over budget by 200.` | withheld: `not_over_budget` |
| Wrong number | `SAMPLE DATA: the Q4 trade fair is over budget by 300.` | withheld: `invented_figure` |

That is the core product claim: the local model can help Paola read the budget, but a bad sentence is dropped before it reaches the UI.

## Where to inspect

- Guard implementation: `src/lib/crew/ground.ts`
- Prompt: `src/lib/crew/prompts.ts`
- Note API route: `src/app/api/crew/route.ts`
- Proof harness: `scripts/prove-note-guard.test.ts`
- Walkthrough video: `docs/Local-Computer-color-walkthrough.mp4`
- Screenshots: `docs/screenshots`

No new video or large media was created for this proof.
