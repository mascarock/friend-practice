# 60-second judge path

This repo is the source for **Local Computer**, a Mac-only local budget companion for Paola in marketing.

- Friend: Paola wants a private way to check approved marketing spend without sending her budget to a cloud tool.
- Local model: Note uses **Gemma `gemma3:1b`** through Ollama at `127.0.0.1:11434`.
- Watcher is code: it computes overspend with `spent > approved`; the model does not decide which line is over budget.
- Note is Gemma plus a guard: Gemma writes one sentence, then `withholdNarration` drops it unless it exactly matches the computed tool result.
- Proof: `npm run proof:note-guard` writes [docs/proof/note-guard-proof.txt](docs/proof/note-guard-proof.txt). In that fixture, the grounded sentence is accepted, `Google Ads is over budget by 200` is withheld, and `Q4 trade fair is over budget by 300` is withheld.

Walkthrough:

1. Read [docs/proof/README.md](docs/proof/README.md).
2. Open the color walkthrough video: [docs/Local-Computer-color-walkthrough.mp4](docs/Local-Computer-color-walkthrough.mp4).
3. Check the sample over-budget line: **SAMPLE DATA: the Q4 trade fair is over budget by 200.**
4. Check the app screenshots in [docs/screenshots](docs/screenshots), especially Watcher and Note.

The demo is intentionally sample data only. It does not publish Paola's real budget or fake a hosted cloud demo.
