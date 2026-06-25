import { signUp } from "@/lib/auth/service";
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
