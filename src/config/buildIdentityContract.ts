import type { PublicStoreIdentity } from "../lib/storeIdentity";

export interface BuildIdentitySnapshot {
  readonly schemaVersion: 1;
  readonly source: "database" | "fixture";
  readonly identity: PublicStoreIdentity;
  readonly localUrls: PublicStoreIdentity["urls"];
  readonly publicUrl: string;
  readonly codeVersion: string;
  readonly codeSha: string;
  readonly identityRevision: string;
  readonly deliveryVersion: string;
}
