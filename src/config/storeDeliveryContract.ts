import type { OrigemChaveSupabase } from "../lib/env-publico-valores";
import type { BuildIdentitySnapshot } from "./buildIdentityContract";

// Nome e versão do getter em plugin.api. buildStore.mjs espelha estes literais.
export const STORE_DELIVERY_API = Object.freeze({
  name: "ikcous-store-delivery",
  version: 1,
} as const);

// Os três define públicos que o app compila; sempre emitidos pelo preparo.
export const PUBLIC_DEFINE_KEYS = Object.freeze({
  url: "import.meta.env.VITE_SUPABASE_URL",
  publishable: "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
  anon: "import.meta.env.VITE_SUPABASE_ANON_KEY",
} as const);

// Único par artificial aceito em fixture-synthetic (bancada A6). Não é credencial Supabase.
export const SYNTHETIC_PUBLIC_SERVICE = Object.freeze({
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "a6c-public-artificial-key-no-account",
} as const);

export type PublicKeyClass = "publishable" | "anon-jwt";

export interface DatabaseConnection {
  readonly kind: "database";
  readonly origin: string; // https://<ref>.supabase.co, sem barra final
  readonly projectRef: string;
  readonly key: string;
  // Classificação NOMINAL (prefixo sb_publishable_ ou JWT com role anon). A
  // assinatura do JWT não é verificada aqui — o servidor a verifica. Alegação, não prova.
  readonly keyClass: PublicKeyClass;
  readonly keySource: OrigemChaveSupabase;
}

export interface FixtureNoneConnection {
  readonly kind: "fixture-none";
}

export interface FixtureSyntheticConnection {
  readonly kind: "fixture-synthetic";
  readonly origin: string;
  readonly projectRef: string;
  readonly key: string;
}

export type StoreConnection =
  | DatabaseConnection
  | FixtureNoneConnection
  | FixtureSyntheticConnection;

// Valores crus dos três define, como o app os compila ("" = ausente explícito).
export interface PublicDefineValues {
  readonly url: string;
  readonly publishable: string;
  readonly anon: string;
}

export interface PreparedStoreDelivery {
  readonly deliveryApiVersion: 1;
  readonly snapshot: BuildIdentitySnapshot;
  readonly publicDefines: PublicDefineValues;
  readonly connection: StoreConnection;
}

export interface StoreDeliveryApi {
  readonly name: typeof STORE_DELIVERY_API.name;
  readonly version: typeof STORE_DELIVERY_API.version;
  get(): PreparedStoreDelivery;
}
