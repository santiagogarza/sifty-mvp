import { closeDb } from "@/lib/db/client";
import { getPersistenceMode, getRepos } from "@/lib/db/repos";
import { getInvitePepper } from "@/lib/invites/codes";
import { mintInviteCode, revokeInviteCode } from "@/lib/invites/service";

/**
 * Invite-code admin CLI. Runs against `DATABASE_URL` with the same
 * `INVITE_CODE_PEPPER` the app uses (hashes must match).
 *
 *   pnpm invite:mint [--months N] [--max N] [--expires YYYY-MM-DD] [--note "Ana"]
 *   pnpm invite:revoke <code | id> [--cascade]
 *   pnpm invite:list
 *
 * The plaintext code is printed once at mint time and never stored.
 */

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function intFlag(flags: Flags, key: string): number | undefined {
  const raw = flags[key];
  if (raw === undefined || raw === true) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) fail(`--${key} must be a positive integer`);
  return n;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireDatabase(): void {
  if (getPersistenceMode() !== "postgres") {
    fail(
      "DATABASE_URL is not set. Codes minted into the in-memory store vanish when this process exits.",
    );
  }
  try {
    getInvitePepper();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const repos = getRepos();

  switch (command) {
    case "mint": {
      requireDatabase();
      const expiresRaw = typeof flags.expires === "string" ? flags.expires : null;
      if (expiresRaw && Number.isNaN(Date.parse(expiresRaw))) {
        fail("--expires must be a date like 2027-01-31");
      }
      const { code, record } = await mintInviteCode(repos, {
        durationMonths: intFlag(flags, "months") ?? null,
        maxRedemptions: intFlag(flags, "max") ?? 1,
        expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : null,
        note: typeof flags.note === "string" ? flags.note : null,
      });
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      console.log("");
      console.log(`  code:      ${code}`);
      console.log(`  link:      ${base}/redeem?code=${encodeURIComponent(code)}`);
      console.log(`  id:        ${record.id}`);
      console.log(`  grants:    ${record.grants}`);
      console.log(
        `  duration:  ${record.durationMonths ? `${record.durationMonths} months` : "forever"}`,
      );
      console.log(`  max uses:  ${record.maxRedemptions}`);
      console.log(`  expires:   ${record.expiresAt ?? "never"}`);
      console.log(`  note:      ${record.note ?? "—"}`);
      console.log("");
      console.log("  The code is shown once. Only its hash is stored.");
      console.log("");
      break;
    }
    case "revoke": {
      requireDatabase();
      const target = positional[0];
      if (!target) fail("usage: pnpm invite:revoke <code | id> [--cascade]");
      const result = await revokeInviteCode(repos, target, { cascade: flags.cascade === true });
      if (!result) fail("no invite code matches that value");
      console.log(`revoked ${result.code.id} (${result.code.note ?? "no note"})`);
      if (flags.cascade === true) console.log(`ended ${result.compsEnded} active comp(s)`);
      break;
    }
    case "list": {
      requireDatabase();
      const codes = await repos.inviteCodes.list();
      if (!codes.length) {
        console.log("no invite codes yet");
        break;
      }
      console.table(
        codes.map((c) => ({
          id: c.id,
          note: c.note ?? "",
          grants: c.grants,
          months: c.durationMonths ?? "∞",
          used: `${c.redemptionCount}/${c.maxRedemptions}`,
          expires: c.expiresAt ? c.expiresAt.slice(0, 10) : "never",
          revoked: c.revokedAt ? c.revokedAt.slice(0, 10) : "",
          created: c.createdAt.slice(0, 10),
        })),
      );
      break;
    }
    default:
      fail("usage: pnpm invite:mint | invite:revoke <code|id> [--cascade] | invite:list");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => undefined));
