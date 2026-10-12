import { randomBytes } from "node:crypto";
import { DecryptionError, decryptSecret } from "@/lib/crypto/aes-gcm";
import type { ConnectionRecord } from "@/lib/db/repos/types";
import {
  type BrokerCompleteInput,
  type BrokerCompleteResult,
  type BrokerHealth,
  type BrokerStartInput,
  type BrokerStartResult,
  type BrokerToken,
  ConnectionNotReadyError,
  type CredentialBroker,
} from "../broker";
import { MOCK_TOKEN_PREFIX } from "../tools/mock";

/**
 * Mock broker: the whole lifecycle with no third party.
 *
 * `start` sends the browser straight to our own callback; `complete` mints
 * a random token that the service seals with AES-GCM into
 * `encrypted_secret` — the one broker that stores a credential, which is
 * what lets the encryption-at-rest path be exercised end to end.
 */

export const MOCK_ACCOUNT = "mock@sifty.local";

function tokenFrom(connection: ConnectionRecord): BrokerToken {
  if (!connection.encryptedSecret) throw new ConnectionNotReadyError();
  try {
    return { token: decryptSecret(connection.encryptedSecret, connection.id), expiresAt: null };
  } catch (err) {
    if (err instanceof DecryptionError) throw new ConnectionNotReadyError();
    throw err;
  }
}

export const mockBroker: CredentialBroker = {
  id: "mock",

  connectorUid() {
    return "mock/local";
  },

  async start(input: BrokerStartInput): Promise<BrokerStartResult> {
    const url = new URL(input.callbackUrl);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code", "mock-code");
    return { url: url.toString() };
  },

  async complete(input: BrokerCompleteInput): Promise<BrokerCompleteResult> {
    if (input.query.get("error")) {
      return { ok: false, reason: input.query.get("error_description") ?? "access_denied" };
    }
    if (input.query.get("code") !== "mock-code") {
      return { ok: false, reason: "The mock provider did not return an authorization code." };
    }
    return {
      ok: true,
      externalAccount: MOCK_ACCOUNT,
      secret: `${MOCK_TOKEN_PREFIX}${randomBytes(16).toString("hex")}`,
    };
  },

  async getToken(connection): Promise<BrokerToken> {
    return tokenFrom(connection);
  },

  async revoke(): Promise<void> {
    // Nothing to revoke: the sealed secret is dropped with the row.
  },

  async health(connection): Promise<BrokerHealth> {
    try {
      tokenFrom(connection);
      return { ok: true, expiresAt: null };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },
};
