import type { ConnectionBroker, ConnectionRecord } from "@/lib/db/repos/types";
import type { ConnectorProviderSpec } from "./providers";

/**
 * Credential broker seam.
 *
 * A broker owns the provider's long-lived credentials and hands Sifty a
 * short-lived access token at use time. Production uses Vercel Connect
 * (`brokers/vercel-connect.ts`): Connect runs the consent screen, stores
 * and refreshes the refresh token, and our row keeps only the reference.
 * The mock broker (`brokers/mock.ts`) implements the same contract without
 * any third party so the lifecycle runs in CI and offline.
 *
 * Nothing above this file (service, routes, UI, tools) knows which broker
 * is behind a connection; a hand-rolled OAuth broker would slot in here
 * without touching them.
 */

export interface BrokerStartInput {
  spec: ConnectorProviderSpec;
  userId: string;
  /** Random nonce the service stored on the pending row. */
  state: string;
  /** Where the user lands after consent: `/api/connectors/<provider>/callback`. */
  callbackUrl: string;
  scopes: string[];
}

export interface BrokerStartResult {
  /** Send the browser here. */
  url: string;
}

export interface BrokerCompleteInput {
  spec: ConnectorProviderSpec;
  userId: string;
  connection: ConnectionRecord;
  /** Query the provider / broker appended to the callback. */
  query: URLSearchParams;
}

export type BrokerCompleteResult =
  | {
      ok: true;
      externalAccount: string | null;
      /** Granted scopes when the broker reports them; falls back to what we asked. */
      scopes?: string[];
      /** Only brokers that must hold a credential return one; it is sealed before storage. */
      secret?: string;
    }
  | { ok: false; reason: string };

export interface BrokerToken {
  token: string;
  /** Epoch ms, null when the broker does not say. */
  expiresAt: number | null;
}

export type BrokerHealth = { ok: true; expiresAt: number | null } | { ok: false; reason: string };

export interface CredentialBroker {
  readonly id: ConnectionBroker;
  /** Null when the operator has not configured this provider (no connector UID). */
  connectorUid(spec: ConnectorProviderSpec): string | null;
  start(input: BrokerStartInput): Promise<BrokerStartResult>;
  complete(input: BrokerCompleteInput): Promise<BrokerCompleteResult>;
  getToken(connection: ConnectionRecord, spec: ConnectorProviderSpec): Promise<BrokerToken>;
  revoke(connection: ConnectionRecord, spec: ConnectorProviderSpec): Promise<void>;
  health(connection: ConnectionRecord, spec: ConnectorProviderSpec): Promise<BrokerHealth>;
}

/** The provider's grant is gone or was never completed; the user must reconnect. */
export class ConnectionNotReadyError extends Error {
  readonly code = "connection_not_ready";
  constructor(message = "This connection needs to be set up again.") {
    super(message);
    this.name = "ConnectionNotReadyError";
  }
}
