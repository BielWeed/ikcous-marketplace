import type { StoreIdentityIntent } from "@/lib/adminStoreIdentity";
import type { VerifiedPublicIdentityAsset } from "@/lib/publicStoreIdentity";
import {
  type BrandingAssets,
  IDENTITY_ASSET_ROLES,
  type IdentityAsset,
  type IdentityAssetRole,
  type PublicStoreIdentity,
  identityAssetDescriptors,
  normalizeSupabaseOrigin,
  parseBrandingAssets,
  parseIdentityAsset,
  parseStoreIdentity,
} from "@/lib/storeIdentity";
import {
  type StoreIdentitySnapshot,
  parseRawStoreIdentity,
  parseStoreIdentitySnapshot,
  sameRawStoreIdentity,
} from "@/lib/storeIdentitySnapshot";

export interface IdentityDraftFields {
  readonly storeName: string;
  readonly storeCity: string;
  readonly storeState: string;
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly accentColor: string;
}
export interface IdentityEditorDraft {
  readonly expected: StoreIdentitySnapshot;
  readonly fields: IdentityDraftFields;
  readonly assets: BrandingAssets;
}
export type IdentityDraftChange =
  | { readonly kind: "fields"; readonly fields: IdentityDraftFields }
  | {
      readonly kind: "asset";
      readonly roles: readonly IdentityAssetRole[];
      readonly uploaded: VerifiedPublicIdentityAsset;
    }
  | {
      readonly kind: "source-add";
      readonly uploaded: VerifiedPublicIdentityAsset;
    }
  | {
      readonly kind: "source-replace";
      readonly index: number;
      readonly uploaded: VerifiedPublicIdentityAsset;
    }
  | { readonly kind: "source-remove"; readonly index: number };
export type IdentityDraftErrorCode =
  | "IDENTITY_DRAFT_INVALID"
  | "IDENTITY_DRAFT_INCOMPLETE"
  | "IDENTITY_DRAFT_SOURCE_LIMIT"
  | "IDENTITY_DRAFT_SOURCE_REQUIRED"
  | "IDENTITY_DRAFT_SOURCE_DUPLICATE";
export class IdentityDraftError extends Error {
  readonly code: IdentityDraftErrorCode;
  constructor(code: IdentityDraftErrorCode) {
    super(code);
    this.name = "IdentityDraftError";
    this.code = code;
  }
}

const fieldKeys = [
  "storeName",
  "storeCity",
  "storeState",
  "primaryColor",
  "secondaryColor",
  "accentColor",
] as const;
const emptyRaw = Object.freeze({
  store_name: null,
  store_city: null,
  store_state: null,
  primary_color: null,
  secondary_color: null,
  accent_color: null,
  logo_url: null,
});

function invalid(): never {
  throw new IdentityDraftError("IDENTITY_DRAFT_INVALID");
}
function checked<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
}

// Reuse the raw codec's descriptor-first JSON capture. No caller getter/toJSON is
// evaluated, input stays unfrozen, and nested unknown keys survive validation.
function capture(value: unknown): Record<string, unknown> {
  const copy = checked(
    () =>
      parseRawStoreIdentity({ ...emptyRaw, branding_assets: value })
        .branding_assets,
  );
  if (copy === null) return invalid();
  return copy;
}
function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function fieldsFrom(value: unknown): IdentityDraftFields {
  exact(value, fieldKeys);
  if (Object.values(value).some((field) => typeof field !== "string"))
    invalid();
  return value as unknown as IdentityDraftFields;
}
function presented(identity: PublicStoreIdentity): IdentityDraftFields {
  return Object.freeze({
    storeName: identity.storeName,
    storeCity: identity.city ?? "",
    storeState: identity.state ?? "",
    primaryColor: identity.theme.primary,
    secondaryColor: identity.theme.secondary,
    accentColor: identity.theme.accent,
  });
}
function sameValue(a: unknown, b: unknown): boolean {
  return sameRawStoreIdentity(
    parseRawStoreIdentity({ ...emptyRaw, branding_assets: { value: a } }),
    parseRawStoreIdentity({ ...emptyRaw, branding_assets: { value: b } }),
  );
}
function assetUrl(asset: IdentityAsset, origin: string): string {
  return `${origin}/storage/v1/object/public/branding/${asset.path}`;
}

export function createIdentityEditorDraft(
  snapshot: StoreIdentitySnapshot,
  supabaseUrl: string,
): IdentityEditorDraft {
  const origin = checked(() => normalizeSupabaseOrigin(supabaseUrl));
  const expected = checked(() => parseStoreIdentitySnapshot(snapshot));
  let identity: PublicStoreIdentity;
  try {
    identity = parseStoreIdentity(expected.identity, origin);
  } catch {
    throw new IdentityDraftError("IDENTITY_DRAFT_INCOMPLETE");
  }
  return Object.freeze({
    expected,
    fields: presented(identity),
    assets: identity.assets,
  });
}

function draftFrom(
  value: IdentityEditorDraft,
  origin: string,
): IdentityEditorDraft {
  const copy = capture(value);
  exact(copy, ["expected", "fields", "assets"]);
  const baseline = checked(() =>
    createIdentityEditorDraft(copy.expected as StoreIdentitySnapshot, origin),
  );
  return Object.freeze({
    expected: baseline.expected,
    fields: fieldsFrom(copy.fields),
    assets: checked(() => parseBrandingAssets(copy.assets)),
  });
}
function uploadedFrom(
  value: unknown,
  assets: BrandingAssets,
  origin: string,
): IdentityAsset {
  exact(value, ["asset", "url"]);
  const asset = checked(() => parseIdentityAsset(value.asset));
  if (value.url !== assetUrl(asset, origin)) invalid();
  // An immutable storage path cannot acquire a different descriptor, including
  // when replacing its sole reference. No bytes are fetched at this boundary.
  if (
    identityAssetDescriptors(assets).some(
      (old) => old.path === asset.path && !sameValue(old, asset),
    )
  )
    invalid();
  return asset;
}
function sourceIndex(value: unknown, length: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= length
  )
    return invalid();
  return value;
}

export function changeIdentityEditorDraft(
  draft: IdentityEditorDraft,
  change: IdentityDraftChange,
  supabaseUrl: string,
): IdentityEditorDraft {
  const origin = checked(() => normalizeSupabaseOrigin(supabaseUrl));
  const copy = draftFrom(draft, origin);
  const action = capture(change);
  let assets = copy.assets;
  switch (action.kind) {
    case "fields": {
      exact(action, ["kind", "fields"]);
      return Object.freeze({ ...copy, fields: fieldsFrom(action.fields) });
    }
    case "asset": {
      exact(action, ["kind", "roles", "uploaded"]);
      const roles = action.roles;
      if (
        !Array.isArray(roles) ||
        !(
          (roles.length === 1 &&
            IDENTITY_ASSET_ROLES.some((role) => role === roles[0])) ||
          (roles.length === 2 &&
            roles.includes("header") &&
            roles.includes("loader"))
        )
      )
        invalid();
      const asset = uploadedFrom(action.uploaded, assets, origin);
      assets = checked(() =>
        parseBrandingAssets({
          ...assets,
          ...Object.fromEntries(roles.map((role) => [role, asset])),
        }),
      );
      break;
    }
    case "source-add": {
      exact(action, ["kind", "uploaded"]);
      const asset = uploadedFrom(action.uploaded, assets, origin);
      if (assets.originals.some((old) => old.path === asset.path)) return copy;
      if (assets.originals.length === 8)
        throw new IdentityDraftError("IDENTITY_DRAFT_SOURCE_LIMIT");
      assets = checked(() =>
        parseBrandingAssets({
          ...assets,
          originals: [...assets.originals, asset],
        }),
      );
      break;
    }
    case "source-replace": {
      exact(action, ["kind", "index", "uploaded"]);
      const index = sourceIndex(action.index, assets.originals.length);
      const asset = uploadedFrom(action.uploaded, assets, origin);
      if (
        assets.originals.some(
          (old, position) => position === index && sameValue(old, asset),
        )
      )
        return copy;
      if (
        assets.originals.some(
          (old, position) => position !== index && old.path === asset.path,
        )
      )
        throw new IdentityDraftError("IDENTITY_DRAFT_SOURCE_DUPLICATE");
      assets = checked(() =>
        parseBrandingAssets({
          ...assets,
          originals: assets.originals.map((old, position) =>
            position === index ? asset : old,
          ),
        }),
      );
      break;
    }
    case "source-remove": {
      exact(action, ["kind", "index"]);
      const index = sourceIndex(action.index, assets.originals.length);
      if (assets.originals.length === 1)
        throw new IdentityDraftError("IDENTITY_DRAFT_SOURCE_REQUIRED");
      assets = checked(() =>
        parseBrandingAssets({
          ...assets,
          originals: assets.originals.filter(
            (_, position) => position !== index,
          ),
        }),
      );
      break;
    }
    default:
      return invalid();
  }
  return Object.freeze({ ...copy, assets });
}

export function identityEditorDraftIsDirty(
  draft: IdentityEditorDraft,
  supabaseUrl: string,
): boolean {
  const copy = draftFrom(draft, supabaseUrl);
  const baseline = createIdentityEditorDraft(copy.expected, supabaseUrl);
  return (
    !sameValue(copy.fields, baseline.fields) ||
    !sameValue(copy.assets, baseline.assets)
  );
}

export function buildIdentityEditorIntent(
  draft: IdentityEditorDraft,
  supabaseUrl: string,
): StoreIdentityIntent {
  const origin = checked(() => normalizeSupabaseOrigin(supabaseUrl));
  const copy = draftFrom(draft, origin);
  const identity = checked(() =>
    parseStoreIdentity(
      {
        store_name: copy.fields.storeName,
        store_city: copy.fields.storeCity,
        store_state: copy.fields.storeState,
        primary_color: copy.fields.primaryColor,
        secondary_color: copy.fields.secondaryColor,
        accent_color: copy.fields.accentColor,
        logo_url: assetUrl(copy.assets.header, origin),
        branding_assets: copy.assets,
      },
      origin,
    ),
  );
  const desired = parseRawStoreIdentity({
    store_name: identity.storeName,
    store_city: identity.city,
    store_state: identity.state,
    primary_color: identity.theme.primary,
    secondary_color: identity.theme.secondary,
    accent_color: identity.theme.accent,
    logo_url: identity.urls.header,
    branding_assets: identity.assets,
  });
  return Object.freeze({ expected: copy.expected, desired });
}

/** Explicit proposal only: the caller presents it before attempting another save. */
export function reconcileIdentityEditorDraft(
  draft: IdentityEditorDraft,
  current: StoreIdentitySnapshot,
  supabaseUrl: string,
): IdentityEditorDraft {
  const copy = draftFrom(draft, supabaseUrl);
  const previous = createIdentityEditorDraft(copy.expected, supabaseUrl);
  const next = createIdentityEditorDraft(current, supabaseUrl);
  // Keys come only from closed local/A3 lists; draftFrom validates both records.
  /* eslint-disable security/detect-object-injection */
  const fields = Object.freeze(
    Object.fromEntries(
      fieldKeys.map((key) => [
        key,
        copy.fields[key] === previous.fields[key]
          ? next.fields[key]
          : copy.fields[key],
      ]),
    ),
  ) as unknown as IdentityDraftFields;
  const roles = Object.fromEntries(
    IDENTITY_ASSET_ROLES.map((role) => [
      role,
      sameValue(copy.assets[role], previous.assets[role])
        ? next.assets[role]
        : copy.assets[role],
    ]),
  );
  /* eslint-enable security/detect-object-injection */
  const assets = checked(() =>
    parseBrandingAssets({
      ...next.assets,
      ...roles,
      originals: sameValue(copy.assets.originals, previous.assets.originals)
        ? next.assets.originals
        : copy.assets.originals,
    }),
  );
  return Object.freeze({ expected: next.expected, fields, assets });
}
