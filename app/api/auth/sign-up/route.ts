import { botDeniedResponse, verifyNotBot } from "@/lib/abuse/botid";
import { signUp } from "@/lib/auth/service";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { AUTH_EMAIL_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // The per-IP limit for every `/api/auth/*` POST is enforced in
  // `middleware.ts`; here the subject is the email being registered.
  const limit = await enforceRateLimit(req, {
    route: "auth",
    subject: { id: parsed.data.email.trim().toLowerCase(), policy: AUTH_EMAIL_POLICY },
    message: "Too many attempts. Try again in a minute.",
  });
  if (!limit.ok) return limit.response;

  const bot = await verifyNotBot("auth.sign-up");
  if (bot.isBot) return botDeniedResponse();

  const result = await signUp(parsed.data);
  if ("code" in result) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.code === "email_taken" ? 409 : 400 },
    );
  }

  const res = NextResponse.json({ user: result.user });
  res.cookies.set(result.cookie.name, result.cookie.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: result.cookie.maxAge,
  });
  return res;
}
