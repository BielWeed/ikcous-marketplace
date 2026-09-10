import { z } from "zod";

import type { Json } from "@/types/database.types";

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<Exclude<T[Key], undefined>> }
    : T;

export interface RawStoreIdentity {
  readonly store_name: string | null;
  readonly store_city: string | null;
  readonly store_state: string | null;
  readonly primary_color: string | null;
  readonly secondary_color: string | null;
  readonly accent_color: string | null;
  readonly logo_url: string | null;
  readonly branding_assets: {
    readonly [key: string]: DeepReadonly<Json>;
  } | null;
}
export interface StoreIdentitySnapshot {
  readonly revision: string;
  readonly identity: RawStoreIdentity;
}
export class StoreIdentitySnapshotError extends Error {
  readonly code = "IDENTITY_SNAPSHOT_INVALID" as const;

  constructor() {
    super("Fotografia da identidade invalida.");
    this.name = "StoreIdentitySnapshotError";
  }
}

const rawSchema = z.strictObject({
  store_name: z.string().nullable(),
  store_city: z.string().nullable(),
  store_state: z.string().nullable(),
  primary_color: z.string().nullable(),
  secondary_color: z.string().nullable(),
  accent_color: z.string().nullable(),
  logo_url: z.string().nullable(),
  branding_assets: z
    .json()
    .refine(
      (value) =>
        value === null || (typeof value === "object" && !Array.isArray(value)),
    ),
});

const snapshotSchema = z.strictObject({
  revision: z
    .string()
    .refine(
      (value) =>
        value.length <= 19 &&
        /^(?:0|[1-9][0-9]*)(?![\s\S])/.test(value) &&
        BigInt(value) <= 9223372036854775807n,
    ),
  identity: rawSchema,
});

// Inspect descriptors before copying: JSON.stringify would silently drop values,
// invoke getters/toJSON, or replace NaN/array holes with null. Only JSON data enters.
function cloneJson(value: unknown, ancestors = new WeakSet<object>()): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    throw new StoreIdentitySnapshotError();
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) {
    throw new StoreIdentitySnapshotError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length) {
    throw new StoreIdentitySnapshotError();
  }
  const entries = Object.entries(descriptors).filter(
    ([key]) => !array || key !== "length",
  );
  if (array && entries.length !== value.length)
    throw new StoreIdentitySnapshotError();
  ancestors.add(value);
  const copied = entries.map(([key, descriptor], index): [string, Json] => {
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      (array && key !== String(index))
    ) {
      throw new StoreIdentitySnapshotError();
    }
    return [key, cloneJson(descriptor.value, ancestors)];
  });
  ancestors.delete(value);
  // fromEntries creates own data properties, including __proto__, without setters.
  return Object.freeze(
    array ? copied.map(([, item]) => item) : Object.fromEntries(copied),
  ) as Json;
}

function validatedClone<T>(value: unknown, schema: z.ZodType): T {
  try {
    const copy = cloneJson(value);
    schema.parse(copy);
    // Zod 4.3.5 strips __proto__ from z.json's parsed records. Validate with it,
    // but return our independently checked clone so every JSON key is conserved.
    return copy as T;
  } catch {
    throw new StoreIdentitySnapshotError();
  }
}

export function parseRawStoreIdentity(value: unknown): RawStoreIdentity {
  return validatedClone<RawStoreIdentity>(value, rawSchema);
}
export function parseStoreIdentitySnapshot(
  value: unknown,
): StoreIdentitySnapshot {
  return validatedClone<StoreIdentitySnapshot>(value, snapshotSchema);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Malformed runtime values (including casts) compare false, even to themselves. */
export function sameRawStoreIdentity(
  a: RawStoreIdentity,
  b: RawStoreIdentity,
): boolean {
  try {
    return (
      canonicalJson(parseRawStoreIdentity(a)) ===
      canonicalJson(parseRawStoreIdentity(b))
    );
  } catch {
    return false;
  }
}
