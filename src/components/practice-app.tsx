"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AVOID_MAX, NAME_MAX, SKILL_MAX } from "@/lib/profile";
import { SAMPLE_NOTICE, SAMPLE_PROFILE } from "@/lib/sample";
import {
  PRACTICE_ROUNDS,
  remainingLearnerTurns,
  type PracticeSession,
} from "@/lib/session";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ready"; host: string; model: string }
  | { status: "missing"; host: string; model: string; error: string };

type FormState = {
  name: string;
  skill: string;
  avoid: string;
  isSample: boolean;
};

const emptyForm: FormState = {
  name: "",
  skill: "",
  avoid: "",
  isSample: false,
};

export function PracticeApp() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");
        const payload = (await response.json()) as {
          ok?: boolean;
          host?: string;
          model?: string;
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (payload.ok && payload.host && payload.model) {
          setHealth({
            status: "ready",
            host: payload.host,
            model: payload.model,
          });
          return;
        }
        setHealth({
          status: "missing",
          host: payload.host || "http://127.0.0.1:11434",
          model: payload.model || "gemma3:1b",
          error:
            payload.error ||
            "Ollama is not reachable. The app will not invent a practice transcript.",
        });
      } catch {
        if (!cancelled) {
          setHealth({
            status: "missing",
            host: "http://127.0.0.1:11434",
            model: "gemma3:1b",
            error:
              "Could not check Ollama from this page. Start it locally before a live session.",
          });
        }
      }
    }

    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  const remaining = useMemo(
    () => (session ? remainingLearnerTurns(session) : PRACTICE_ROUNDS),
    [session],
  );

  function loadSample() {
    setForm({
      name: SAMPLE_PROFILE.name,
      skill: SAMPLE_PROFILE.skill,
      avoid: SAMPLE_PROFILE.avoid,
      isSample: true,
    });
    setErrors({});
    setRequestError(null);
  }

  async function startSession() {
    setBusy(true);
    setRequestError(null);
    setErrors({});

    try {
      const response = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          profile: form,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        session?: PracticeSession;
        errors?: Record<string, string>;
        error?: string;
      };

      if (payload.ok && payload.session) {
        setSession(payload.session);
        setReply("");
        return;
      }
      if (payload.errors) {
        setErrors(payload.errors);
        return;
      }
      setRequestError(
        payload.error ||
          "The practice partner could not start. Nothing was invented in its place.",
      );
    } catch {
      setRequestError(
        "The app could not reach its own practice API. Check that the local server is still running.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!session) {
      return;
    }
    setBusy(true);
    setRequestError(null);

    try {
      const response = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          session,
          message: reply,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        session?: PracticeSession;
        error?: string;
      };

      if (payload.ok && payload.session) {
        setSession(payload.session);
        setReply("");
        return;
      }
      setRequestError(
        payload.error ||
          "The practice partner could not continue. Nothing was invented in its place.",
      );
    } catch {
      setRequestError(
        "The app could not reach its own practice API. Check that the local server is still running.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSession(null);
    setReply("");
    setRequestError(null);
    setErrors({});
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="space-y-3">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Local practice partner
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Friend Practice
          </h1>
          <Badge variant="outline">Gemma via Ollama</Badge>
        </div>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Describe one person, then sit through a short, patient session. The
          partner runs on Google&apos;s open-weight Gemma, on this machine. No
          closed API is required for the core loop.
        </p>
      </header>

      <HealthBanner health={health} />

      {!session ? (
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle>Who is this for?</CardTitle>
            <CardDescription>
              Name, what they want to get better at, and what the partner should
              avoid. You can load labeled sample data if you just want to see
              the form.
            </CardDescription>
          </CardHeader>
          <form
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
              void startSession();
            }}
          >
            <CardContent className="space-y-4">
              {form.isSample ? (
                <Alert>
                  <AlertCircle />
                  <AlertTitle>Sample data</AlertTitle>
                  <AlertDescription>{SAMPLE_NOTICE}</AlertDescription>
                </Alert>
              ) : null}

              <Field
                id="name"
                label="Their name"
                error={errors.name}
                hint={`${form.name.length}/${NAME_MAX}`}
              >
                <Input
                  id="name"
                  value={form.name}
                  maxLength={NAME_MAX}
                  autoComplete="nickname"
                  placeholder="A first name is enough"
                  aria-invalid={Boolean(errors.name)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                      isSample: false,
                    }))
                  }
                />
              </Field>

              <Field
                id="skill"
                label="What they are trying to get better at"
                error={errors.skill}
                hint={`${form.skill.length}/${SKILL_MAX}`}
              >
                <Textarea
                  id="skill"
                  value={form.skill}
                  maxLength={SKILL_MAX}
                  rows={3}
                  placeholder="Example: giving a short spoken update without rushing"
                  aria-invalid={Boolean(errors.skill)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      skill: event.target.value,
                      isSample: false,
                    }))
                  }
                />
              </Field>

              <Field
                id="avoid"
                label="What to avoid"
                error={errors.avoid}
                hint={`${form.avoid.length}/${AVOID_MAX}`}
              >
                <Textarea
                  id="avoid"
                  value={form.avoid}
                  maxLength={AVOID_MAX}
                  rows={3}
                  placeholder="Example: harsh scoring, rushing, or nitpicking filler words"
                  aria-invalid={Boolean(errors.avoid)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      avoid: event.target.value,
                      isSample: false,
                    }))
                  }
                />
              </Field>

              {errors.form ? (
                <p className="text-sm text-destructive">{errors.form}</p>
              ) : null}
              {requestError ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>No live Gemma reply</AlertTitle>
                  <AlertDescription>{requestError}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
            <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={loadSample}
                disabled={busy}
              >
                Load sample profile
              </Button>
              <Button
                type="button"
                disabled={busy}
                size="lg"
                onClick={() => void startSession()}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Waiting on local Gemma
                  </>
                ) : (
                  "Start a short session"
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : (
        <Card className="bg-card/90">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Practice with {session.profile.name}</CardTitle>
              {session.profile.isSample ? (
                <Badge variant="secondary">Sample data</Badge>
              ) : null}
              {session.status === "complete" ? (
                <Badge>Session complete</Badge>
              ) : (
                <Badge variant="outline">
                  {remaining} of {PRACTICE_ROUNDS} tries left
                </Badge>
              )}
            </div>
            <CardDescription>
              Getting better at {session.profile.skill}. Avoiding{" "}
              {session.profile.avoid}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {session.profile.isSample ? (
              <p className="text-sm text-muted-foreground">{SAMPLE_NOTICE}</p>
            ) : null}
            <ol className="space-y-3">
              {session.turns.map((turn, index) => (
                <li
                  key={`${turn.speaker}-${index}`}
                  className={
                    turn.speaker === "partner"
                      ? "rounded-xl bg-secondary px-4 py-3"
                      : "rounded-xl border border-border px-4 py-3"
                  }
                >
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {turn.speaker === "partner"
                      ? "Practice partner"
                      : session.profile.name}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {turn.content}
                  </p>
                </li>
              ))}
            </ol>
            {busy ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Waiting on the local Gemma model. This is not a saved
                transcript.
              </p>
            ) : null}
            {requestError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>No live Gemma reply</AlertTitle>
                <AlertDescription>{requestError}</AlertDescription>
              </Alert>
            ) : null}
            {session.status === "complete" ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>That is the end of this short session</AlertTitle>
                <AlertDescription>
                  You can start another one with the same person or a new
                  description. The model stays on this machine.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            {session.status === "awaiting_reply" ? (
              <form
                method="post"
                className="flex w-full flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply();
                }}
              >
                <Label htmlFor="reply">Your attempt</Label>
                <Textarea
                  id="reply"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={4}
                  placeholder="Write the attempt the way you would say it out loud."
                  disabled={busy}
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={reset}
                    disabled={busy}
                  >
                    Start over
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !reply.trim()}
                    onClick={() => void sendReply()}
                  >
                    {busy ? "Sending to Gemma" : "Send attempt"}
                  </Button>
                </div>
              </form>
            ) : (
              <Button type="button" onClick={reset}>
                Practice again
              </Button>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function HealthBanner({ health }: { health: HealthState }) {
  if (health.status === "loading") {
    return (
      <Alert>
        <LoaderCircle className="animate-spin" />
        <AlertTitle>Checking the local Gemma path</AlertTitle>
        <AlertDescription>
          Looking for Ollama. The form still works if the model is not here
          yet.
        </AlertDescription>
      </Alert>
    );
  }

  if (health.status === "ready") {
    return (
      <Alert>
        <CheckCircle2 />
        <AlertTitle>Local Gemma is ready</AlertTitle>
        <AlertDescription>
          {health.model} is available at {health.host}. The session will call
          that model. It will not fall back to a closed API.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Gemma is not live in this environment</AlertTitle>
      <AlertDescription>
        {health.error} You can still fill in the person, load sample data, and
        run the tests. A live session needs Ollama and{" "}
        <code>ollama pull {health.model}</code>.
      </AlertDescription>
    </Alert>
  );
}
