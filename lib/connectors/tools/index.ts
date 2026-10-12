import type { ConnectorProvider } from "@/lib/db/repos/types";
import type { ProviderToolManifest } from "../manifest";
import { githubManifest } from "./github";
import { googleManifest } from "./google";
import { linearManifest } from "./linear";
import { mockManifest } from "./mock";
import { notionManifest } from "./notion";
import { slackManifest } from "./slack";

export const MANIFESTS: Readonly<Record<ConnectorProvider, ProviderToolManifest>> = {
  google: googleManifest,
  slack: slackManifest,
  linear: linearManifest,
  github: githubManifest,
  notion: notionManifest,
  mock: mockManifest,
};

export function manifestFor(provider: ConnectorProvider): ProviderToolManifest {
  return MANIFESTS[provider];
}
