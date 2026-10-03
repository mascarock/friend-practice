# Friend Practice

A local practice partner for one person. You describe who it is for — their name, what they are trying to get better at, and what to avoid — and the app runs a short, patient session.

The partner is Google's open-weight Gemma, reached through Ollama on your machine. The core loop does not call a closed API.

This project was started on 3 October 2026 for the DEV Hacktoberfest Weekend Challenge (theme: Build for a Friend).

## What you get

- A single local web page
- A three-attempt practice session
- An honest error if Gemma is not actually running
- Tests for the parts that do not need the model

The included profile is labeled **sample data**. It is not a real person, quote, or testimonial.

## Requirements

- Node.js 22 or newer
- npm
- For a live session: [Ollama](https://ollama.com) and the `gemma3:1b` model

## Non-model path (no Ollama needed)

```bash
npm install
npm test
npm run dev
```

Then open [http://127.0.0.1:43173](http://127.0.0.1:43173) or [http://localhost:43173](http://localhost:43173).

You can fill in a person, load the labeled sample profile, and see validation. If you start a session without Ollama, the app reports that Gemma is not reachable. It will not invent a transcript.

## Gemma path (live local model)

1. Install Ollama from [https://ollama.com](https://ollama.com).
2. Start the Ollama app or daemon.
3. Pull the small instruct model:

   ```bash
   ollama pull gemma3:1b
   ```

4. Confirm it answers locally:

   ```bash
   ollama run gemma3:1b "Say hello in one sentence."
   ```

5. From this repo:

   ```bash
   npm install
   npm run dev
   ```

6. Open [http://127.0.0.1:43173](http://127.0.0.1:43173) or [http://localhost:43173](http://localhost:43173), describe the person, and start a session.

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `gemma3:1b` | Open Gemma instruct build |

The app posts to Ollama's `/api/chat` endpoint. That path is implemented in `src/lib/ollama.ts` and used by `POST /api/practice`.

## Honesty about this environment

This workspace did not have Ollama or a Gemma download available. The Gemma call path is real. The rest of the app is covered by tests. No saved model transcript is presented as a live run.

## Tests

```bash
npm test
```

These cover profile validation, session turns, prompt construction, the Ollama request/response helpers (with a fake `fetch`), and the practice loop with an injected chat function.

## License

MIT. See [LICENSE](./LICENSE).

A draft DEV post lives in [POST.md](./POST.md). It has not been published.
