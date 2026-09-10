import { z } from "zod";

export const MAX_IDENTITY_ASSET_BYTES = 20 * 1024 * 1024;
export const IDENTITY_ASSET_ROLES = [
  "header",
  "loader",
  "favicon",
  "apple_touch",
  "icon_192",
  "icon_512",
  "maskable_512",
  "og",
] as const;
export type IdentityAssetRole = (typeof IDENTITY_ASSET_ROLES)[number];
export type IdentityErrorCode =
  | "IDENTITY_ORIGIN"
  | "IDENTITY_INCOMPLETE"
  | "IDENTITY_INVALID"
  | "IDENTITY_KEY"
  | "IDENTITY_TIMEOUT"
  | "IDENTITY_CANCELED"
  | "IDENTITY_CONTEXT"
  | "IDENTITY_PERMISSION"
  | "IDENTITY_SCHEMA"
  | "IDENTITY_ROWS"
  | "IDENTITY_FETCH"
  | "IDENTITY_ASSET_STATUS"
  | "IDENTITY_ASSET_SIZE"
  | "IDENTITY_ASSET_MIME"
  | "IDENTITY_ASSET_HASH";

// Messages contain no input, SDK diagnostics, credentials or downloaded content.
export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  constructor(code: IdentityErrorCode) {
    super(code);
    this.name = "IdentityError";
    this.code = code;
  }
}

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const mediaSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/vnd.microsoft.icon",
]);
const extensions = new Map<string, RegExp>([
  ["image/png", /\.png$/i],
  ["image/jpeg", /\.jpe?g$/i],
  ["image/webp", /\.webp$/i],
  ["image/svg+xml", /\.svg$/i],
  ["image/vnd.microsoft.icon", /\.ico$/i],
]);
const assetSchema = z
  .object({
    path: z
      .string()
      .regex(/^v1\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    media_type: mediaSchema,
    bytes: z.number().int().min(1).max(MAX_IDENTITY_ASSET_BYTES),
    width: z.number().int().min(1).max(8192).optional(),
    height: z.number().int().min(1).max(8192).optional(),
  })
  .strict()
  .refine(
    (asset) =>
      asset.path.split("/")[1] === asset.sha256 &&
      extensions.get(asset.media_type)?.test(asset.path) === true &&
      Object.hasOwn(asset, "width") === (asset.width !== undefined) &&
      Object.hasOwn(asset, "height") === (asset.height !== undefined) &&
      (asset.width === undefined) === (asset.height === undefined),
  );

export type IdentityAsset = DeepReadonly<z.infer<typeof assetSchema>>;
const assetsSchema = z
  .object({
    version: z.literal(1),
    originals: z.array(assetSchema).min(1).max(8),
    header: assetSchema,
    loader: assetSchema,
    favicon: assetSchema,
    apple_touch: assetSchema,
    icon_192: assetSchema,
    icon_512: assetSchema,
    maskable_512: assetSchema,
    og: assetSchema,
  })
  .strict();
export type BrandingAssets = DeepReadonly<z.infer<typeof assetsSchema>>;

export function identityAssetDescriptors(
  assets: BrandingAssets,
): readonly IdentityAsset[] {
  return [
    ...assets.originals,
    assets.header,
    assets.loader,
    assets.favicon,
    assets.apple_touch,
    assets.icon_192,
    assets.icon_512,
    assets.maskable_512,
    assets.og,
  ];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parseBrandingAssets(value: unknown): BrandingAssets {
  const parsed = assetsSchema.safeParse(value);
  if (!parsed.success) throw new IdentityError("IDENTITY_INVALID");
  const assets = parsed.data;
  const squares: [IdentityAsset, number][] = [
    [assets.apple_touch, 180],
    [assets.icon_192, 192],
    [assets.icon_512, 512],
    [assets.maskable_512, 512],
  ];
  if (
    squares.some(
      ([asset, size]) =>
        asset.media_type !== "image/png" ||
        asset.width !== size ||
        asset.height !== size,
    ) ||
    [assets.header, assets.loader].some(
      (asset) => asset.media_type === "image/vnd.microsoft.icon",
    ) ||
    !["image/png", "image/svg+xml", "image/vnd.microsoft.icon"].includes(
      assets.favicon.media_type,
    ) ||
    !["image/png", "image/jpeg", "image/webp"].includes(assets.og.media_type) ||
    assets.og.width !== 1200 ||
    assets.og.height !== 630
  ) {
    throw new IdentityError("IDENTITY_INVALID");
  }
  const seen = new Map<string, string>();
  for (const asset of identityAssetDescriptors(assets)) {
    const descriptor = canonical(asset);
    if (seen.has(asset.path) && seen.get(asset.path) !== descriptor)
      throw new IdentityError("IDENTITY_INVALID");
    seen.set(asset.path, descriptor);
  }
  return freeze(assets);
}

export function parseIdentityAsset(value: unknown): IdentityAsset {
  const parsed = assetSchema.safeParse(value);
  if (!parsed.success) throw new IdentityError("IDENTITY_INVALID");
  return freeze(parsed.data);
}

export function normalizeSupabaseOrigin(value: unknown): string {
  // Validate the original spelling too: URL() alone hides ports, case and dot segments.
  if (
    typeof value !== "string" ||
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(value)
  ) {
    throw new IdentityError("IDENTITY_ORIGIN");
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const colorSchema = z
  .string()
  .regex(/^#[a-fA-F0-9]{6}$/)
  .transform((value) => value.toUpperCase());
const rowSchema = z
  .object({
    store_name: z
      .string()
      .max(160)
      .transform((value) => value.trim())
      .refine((value) => value.length > 0),
    store_city: z.string().max(160).nullable(),
    store_state: z.string().nullable(),
    logo_url: z.string(),
    primary_color: colorSchema.refine((value) => value !== "#000000"),
    secondary_color: colorSchema,
    accent_color: colorSchema,
    branding_assets: z.unknown(),
  })
  .strict();
const rowFields = [
  "store_name",
  "store_city",
  "store_state",
  "logo_url",
  "primary_color",
  "secondary_color",
  "accent_color",
  "branding_assets",
] as const;

export interface PublicStoreIdentity {
  readonly schemaVersion: 1;
  readonly projectRef: string;
  readonly storeName: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly theme: Readonly<{
    primary: string;
    secondary: string;
    accent: string;
  }>;
  readonly assets: BrandingAssets;
  readonly urls: Readonly<
    Record<IdentityAssetRole, string> & { originals: readonly string[] }
  >;
}

export function parseStoreIdentity(
  value: unknown,
  supabaseUrl: unknown,
): PublicStoreIdentity {
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  if (
    value === null ||
    typeof value !== "object" ||
    rowFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new IdentityError("IDENTITY_INCOMPLETE");
  }
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) throw new IdentityError("IDENTITY_INVALID");
  const row = parsed.data;
  const assets = parseBrandingAssets(row.branding_assets);
  const urlFor = (asset: IdentityAsset) =>
    `${origin}/storage/v1/object/public/branding/${asset.path}`;
  if (row.logo_url !== urlFor(assets.header))
    throw new IdentityError("IDENTITY_ORIGIN");
  const state = row.store_state?.trim().toUpperCase() || null;
  if (state !== null && !/^[A-Z]{2}$/.test(state))
    throw new IdentityError("IDENTITY_INVALID");
  const urls = {
    originals: assets.originals.map(urlFor),
    header: urlFor(assets.header),
    loader: urlFor(assets.loader),
    favicon: urlFor(assets.favicon),
    apple_touch: urlFor(assets.apple_touch),
    icon_192: urlFor(assets.icon_192),
    icon_512: urlFor(assets.icon_512),
    maskable_512: urlFor(assets.maskable_512),
    og: urlFor(assets.og),
  };
  return freeze({
    schemaVersion: 1 as const,
    projectRef: new URL(origin).hostname.split(".")[0],
    storeName: row.store_name,
    city: row.store_city?.trim() || null,
    state,
    theme: {
      primary: row.primary_color,
      secondary: row.secondary_color,
      accent: row.accent_color,
    },
    assets,
    urls,
  });
}

// Download/revision boundaries distrust callers, including objects originally parsed here.
export function cloneStoreIdentity(
  value: PublicStoreIdentity,
): PublicStoreIdentity {
  try {
    const clone = parseStoreIdentity(
      {
        store_name: value.storeName,
        store_city: value.city,
        store_state: value.state,
        logo_url: value.urls.header,
        primary_color: value.theme.primary,
        secondary_color: value.theme.secondary,
        accent_color: value.theme.accent,
        branding_assets: value.assets,
      },
      `https://${value.projectRef}.supabase.co`,
    );
    if (canonical(value) !== canonical(clone))
      throw new IdentityError("IDENTITY_INVALID");
    return clone;
  } catch {
    throw new IdentityError("IDENTITY_INVALID");
  }
}

export async function identityRevision(
  identity: PublicStoreIdentity,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    canonical(cloneStoreIdentity(identity)),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
