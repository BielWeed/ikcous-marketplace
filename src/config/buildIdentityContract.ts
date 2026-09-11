import type { PublicStoreIdentity } from "../lib/storeIdentity";

export interface BuildIdentitySnapshot {
  readonly schemaVersion: 1;
  // "porteiro": a ficha da loja (lida do HTML pelo middleware, etapa 2 da
  // escala) venceu o assado para marca — nunca escrito pelo BUILD, só em
  // runtime por `src/config/buildIdentity.ts`.
  readonly source: "database" | "fixture" | "porteiro";
  readonly identity: PublicStoreIdentity;
  readonly localUrls: PublicStoreIdentity["urls"];
  readonly publicUrl: string;
  readonly codeVersion: string;
  readonly codeSha: string;
  readonly identityRevision: string;
  readonly deliveryVersion: string;
}
