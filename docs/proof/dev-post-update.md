# A private budget chat for Paola, checked by local Gemma

## What I built

Local Computer is a small Mac-only budget companion for Paola, a marketer who needs to check spend against an approved budget without turning the budget into another cloud integration.

The workflow is deliberately ordinary:

1. Load an approved CSV.
2. Record spend locally.
3. Ask one of five assistants what changed.

The important constraint is the personal one. Paola's approved numbers should not be copied into a SaaS dashboard, a remote chatbot, or a shared analytics workspace just to answer: "Are we over budget anywhere?"

So the app keeps the budget and spend log on the Mac. The demo uses clearly labeled **SAMPLE DATA**, not Paola's real budget.

## Demo

The walkthrough is in the repo:

- Video: `docs/Local-Computer-color-walkthrough.mp4`
- Screenshots: `docs/screenshots`
- Judge path: `JUDGE.md`
- Gemma proof: `docs/proof/README.md`

There is no hosted demo. That is part of the point: this version is designed to run locally, with local storage and local Ollama.

## How it works

Local Computer has five budget assistants:

- **Ledger** reads the approved CSV.
- **Clerk** logs a spend against an existing approved item.
- **Watcher** names lines where `spent > approved`.
- **Remainder** shows approved, spent, and remaining totals.
- **Note** asks local Gemma for one short sentence, then checks that sentence before showing it.

The sample walkthrough has one over-budget line:

```text
SAMPLE DATA: the Q4 trade fair is over budget by 200.
```

The computed sample totals are:

```text
approved total: 16700
spent total: 6900
remaining total: 9800
over-budget line: Events / Q4 trade fair, approved 4500, spent 4700, over 200
```

## Best Use of Gemma

Gemma is not used as a decorative chat layer. It sits at the exact place where a human needs wording: turning a computed budget result into one sentence Paola can read quickly.

The model is local **Gemma `gemma3:1b`** through Ollama at `127.0.0.1:11434`. The prompt gives it the tool result and asks for one short English sentence. The model is not trusted with the budget math.

The sequence is:

1. Code computes the budget result.
2. Code writes the exact facts Gemma may narrate.
3. Gemma writes one sentence.
4. `withholdNarration` checks the sentence.
5. The app shows the sentence only if it matches the computed facts.

That last step matters because local models can still drift. In this app, a drifted sentence is not "mostly fine"; it is withheld and the computed result is shown instead.

## Proof I added before submission

I added a small proof harness:

```bash
npm run proof:note-guard
```

It writes:

```text
docs/proof/note-guard-proof.txt
```

The proof checks three candidate Gemma sentences against the same guard used by the app:

| Candidate | Guard result |
| --- | --- |
| `SAMPLE DATA: the Q4 trade fair is over budget by 200.` | accepted |
| `SAMPLE DATA: Google Ads is over budget by 200.` | withheld: `not_over_budget` |
| `SAMPLE DATA: the Q4 trade fair is over budget by 300.` | withheld: `invented_figure` |

This is the core failure mode I wanted to handle: the sentence may sound plausible, but if the item or number is wrong, Paola should not see it as model narration.

## What I showed Paola, and what I would ask next

I did not put Paola's real budget in this repo, and I am not going to invent a quote from her.

What I can honestly show her is the sample flow: one approved marketing budget, one local spend log, Watcher finding the Q4 trade fair over by 200, and Note producing a guarded sentence from local Gemma.

The next question I would ask her is not "Do you trust the model?" It is more practical:

> If the app refuses a sentence and shows the computed result instead, is that interruption clear enough for you to keep working?

For a budget tool, that trust boundary is the product.

## Privacy

The app stores budgets and spend logs in local browser storage. The desktop shell blocks external navigation and remote renderer requests. The model call goes only to local Ollama. There is no cloud database, account sync, remote analytics, external font request, or hosted backend.

## What I would improve next

I would add a compact review panel for withheld sentences: candidate sentence, reason, and computed facts. I would also test more real-world CSV names, because budget line names can be messy and the guard is intentionally conservative about names that read like totals, periods, or multiple items.

The shape I want to keep is simple: let Gemma write like a person, but let code decide whether the sentence is safe enough to show.
