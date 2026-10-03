# Friend Practice: a local Gemma partner for one person

Draft only. Not published.

I built Friend Practice for the DEV Hacktoberfest Weekend Challenge. It is a small local web app: you describe one person, then sit through a short, patient practice session.

You enter their name, what they are trying to get better at, and what the partner should avoid. The app then asks Gemma for one prompt at a time, waits for an attempt, gives brief feedback, and wraps up after three tries.

## Why an open model matters

The core loop talks to Google's open-weight Gemma through Ollama on your machine (`gemma3:1b` by default). That means:

- The practice can run locally.
- The person's attempts stay off a closed API.
- If the model is missing, the app says so. It does not invent a transcript.

That is the point of building this for a friend: the session is theirs, on their computer.

This also fits the optional Gemma featured category for the challenge.

## Who it's for

This was built for: _______________

(Leave the blank for the real person. Do not invent a name, quote, or testimonial here.)

## How to try it

Install Node.js, then:

```bash
npm install
npm test
```

For a live session, install Ollama, run `ollama pull gemma3:1b`, and `npm run dev`.

Repo: https://github.com/mascarock/friend-practice

#devchallenge #weekendchallenge #hf26challenge
