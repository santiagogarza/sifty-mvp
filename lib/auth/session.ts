/**
 * Session boundary.
 *
 * The MVP does not yet wire Supabase Auth. Instead we expose a single
 * `getSession()` boundary that all server-side code consults. Swapping in
 * real auth later means rewriting only this file.
 *
 * The active "user" is read from CREATOR_EMAIL (the creator override defined
 * in the plan) and falls back to a sample account so the app is testable
 * out of the box.
 */

import type { UserProfile } from "@/lib/domain/types";

const CREATOR_EMAIL = process.env.CREATOR_EMAIL ?? "s.gonzalez.garza@gmail.com";

export interface Session {
  user: UserProfile;
}

export function getSession(): Session {
  const email = process.env.SIFTY_USER_EMAIL ?? CREATOR_EMAIL;
  const isCreator = email.toLowerCase() === CREATOR_EMAIL.toLowerCase();
  return {
    user: {
      id: "user_local",
      email,
      displayName: isCreator ? "Santi" : email.split("@")[0]!,
      isCreator,
      createdAt: new Date().toISOString(),
    },
  };
}

export function getCreatorEmail(): string {
  return CREATOR_EMAIL;
}
