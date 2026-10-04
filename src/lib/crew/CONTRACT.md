# Local crew contract

Five tiny bots. Each does one job on this computer. No network except Ollama at http://127.0.0.1:11434. Never invent a figure. Never edit an approved budget. Sample rows stay labeled SAMPLE DATA.

Shared types live in src/lib/crew/types.ts. Do not change these names.

## Bots

1. ledger — Read the loaded CSV only. Return each category, item, and approved amount that is actually in the file.
2. clerk — Log one spend. Category must already exist. Amount must be a positive number the user typed. Do not change approved.
3. watcher — List lines where spent is greater than approved. Compute this in code. A model must never decide this list.
4. remainder — Return approved total, spent total, and remaining. Approved total is the sum of the CSV and does not change when a spend is logged.
5. note — One short sentence for Paola. Gemma may narrate only after the tool result exists. If the sentence names an item that is not in the watcher list, or any number that is not in the tool result, withhold the sentence and show the tool result instead.

## Ownership

Codex writes: src/lib/crew/types.ts, src/lib/crew/tools.ts, src/lib/crew/tools.test.ts, src/components/crew.tsx, src/app/api/crew/route.ts, and a small mount of Crew inside src/components/dashboard.tsx.

Claude writes: src/lib/crew/ground.ts, src/lib/crew/ground.test.ts, src/lib/crew/prompts.ts. ground.ts exports withholdNarration(sentence, toolResult) that returns the sentence only when every number and every over-budget item name in it is present in the tool result.

Do not commit. Do not push. Do not revert the English redesign. Do not touch files the other one owns, except Codex may import ground.ts and prompts.ts once they exist.

UI: near-black liquid glass, white type, thin light edges, and rounded controls. A sidebar of the five bots opens separate chat threads, with persistent user and grounded assistant bubbles and a composer at the bottom. English only.
