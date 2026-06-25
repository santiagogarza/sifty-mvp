import { signIn, signUp } from "@/lib/auth/service";
import { describe, expect, it } from "vitest";
import { getTestRepos } from "../setup";

describe("auth service", () => {
  it("rejects weak passwords", async () => {
    const result = await signUp({ email: "a@example.com", password: "short" });
    if (!("code" in result)) throw new Error("expected error");
    expect(result.code).toBe("weak_password");
  });

  it("creates a trial entitlement for non-creator sign-ups", async () => {
    const result = await signUp({
      email: "trialer@example.com",
      password: "passw0rd",
    });
    if ("code" in result) throw new Error("unexpected error");
    const repos = getTestRepos();
    const ent = await repos.entitlements.get(result.user.id);
    expect(ent?.tier).toBe("trialing");
    expect(ent?.trialEndsAt).toBeTruthy();
  });

  it("creator email gets the creator tier on sign-up", async () => {
    const result = await signUp({
      email: "s.gonzalez.garza@gmail.com",
      password: "passw0rd",
    });
    if ("code" in result) throw new Error("unexpected error");
    expect(result.user.isCreator).toBe(true);
    const repos = getTestRepos();
    const ent = await repos.entitlements.get(result.user.id);
    expect(ent?.tier).toBe("creator");
  });

  it("rejects duplicate emails with email_taken", async () => {
    const r1 = await signUp({ email: "dup@example.com", password: "passw0rd" });
    if ("code" in r1) throw new Error("unexpected error");
    const r2 = await signUp({ email: "dup@example.com", password: "passw0rd" });
    if (!("code" in r2)) throw new Error("expected error");
    expect(r2.code).toBe("email_taken");
  });

  it("sign-in succeeds with the right password", async () => {
    await signUp({ email: "siw@example.com", password: "passw0rd" });
    const result = await signIn({ email: "siw@example.com", password: "passw0rd" });
    if ("code" in result) throw new Error("unexpected error");
    expect(result.user.email).toBe("siw@example.com");
  });

  it("sign-in fails with the wrong password", async () => {
    await signUp({ email: "wp@example.com", password: "passw0rd" });
    const result = await signIn({ email: "wp@example.com", password: "wrong-one" });
    if (!("code" in result)) throw new Error("expected error");
    expect(result.code).toBe("invalid_credentials");
  });
});
