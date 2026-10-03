import { continuePractice, startPractice } from "@/lib/practice";
import { NextResponse } from "next/server";

type PracticeBody = {
  action?: unknown;
  profile?: unknown;
  session?: unknown;
  message?: unknown;
};

export async function POST(request: Request) {
  let body: PracticeBody;
  try {
    body = (await request.json()) as PracticeBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "The request body was not valid JSON." },
      { status: 400 },
    );
  }

  if (body.action === "start") {
    const result = await startPractice(body.profile);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "reply") {
    const result = await continuePractice(body.session, body.message);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Use action start or reply." },
    { status: 400 },
  );
}
