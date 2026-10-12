import {
  appendSignupBinding,
  hasValidSignupBinding,
  signupBindingValue,
} from "@/lib/auth/signup-binding";
import { describe, expect, it } from "vitest";

const SECRET = "test-auth-secret-do-not-use-in-production-please-32";
const COOKIE_OCTET = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;

describe("signup binding cookie", () => {
  it("is a valid cookie value even with several bindings", () => {
    let value: string | undefined;
    for (const id of ["user_a1", "user_b2", "user_c3"]) {
      value = appendSignupBinding(value, id, SECRET);
    }
    expect(value).toMatch(COOKIE_OCTET);
    expect(value!.split("~")).toHaveLength(3);
  });

  it("keeps only the newest bindings and dedupes", () => {
    let value: string | undefined;
    for (const id of ["u1", "u2", "u3", "u4", "u5", "u6", "u2"]) {
      value = appendSignupBinding(value, id, SECRET);
    }
    const ids = value!.split("~").map((v) => v.split(".")[0]);
    expect(ids).toEqual(["u3", "u4", "u5", "u6", "u2"]);
  });

  it("validates any held binding and rejects forged or foreign ones", () => {
    const value = appendSignupBinding(appendSignupBinding(undefined, "u1", SECRET), "u2", SECRET);
    const headers = new Headers({ cookie: `other=1; sifty.signup_binding=${value}` });
    expect(hasValidSignupBinding(headers, "u1", SECRET)).toBe(true);
    expect(hasValidSignupBinding(headers, "u2", SECRET)).toBe(true);
    expect(hasValidSignupBinding(headers, "u3", SECRET)).toBe(false);
    expect(hasValidSignupBinding(headers, "u1", "another-secret-that-is-long-enough-123")).toBe(
      false,
    );
    const forged = new Headers({
      cookie: `sifty.signup_binding=u3.${signupBindingValue("u1", SECRET).split(".")[1]}`,
    });
    expect(hasValidSignupBinding(forged, "u3", SECRET)).toBe(false);
    expect(hasValidSignupBinding(undefined, "u1", SECRET)).toBe(false);
  });
});
