import { createHash } from "node:crypto";
import sharp from "sharp";
import type { DownloadedStoreIdentity } from "../src/lib/publicStoreIdentity";
import { identityRevision, parseStoreIdentity } from "../src/lib/storeIdentity";
import type { IdentityAsset } from "../src/lib/storeIdentity";

// Deterministic, entirely fictional pixels; never reads a real store or its images.
export async function createIdentityBuildFixture(
  variant: "aurora" | "oceano" = "aurora",
): Promise<DownloadedStoreIdentity> {
  const color = variant === "aurora" ? "#863B50" : "#246780";
  const files: DownloadedStoreIdentity["files"][number][] = [];
  const add = (
    name: string,
    bytes: Uint8Array,
    mediaType: IdentityAsset["media_type"],
    width?: number,
    height?: number,
  ): IdentityAsset => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const assetPath = `v1/${sha256}/${name}`;
    files.push({ path: assetPath, bytes, mediaType, sha256 });
    return {
      path: assetPath,
      sha256,
      bytes: bytes.length,
      media_type: mediaType,
      ...(width === undefined ? {} : { width, height }),
    };
  };
  const raster = async (
    name: string,
    width: number,
    height: number,
    format: "png" | "jpeg" = "png",
  ) =>
    add(
      name,
      await sharp({ create: { width, height, channels: 3, background: color } })
        .toFormat(format)
        .toBuffer(),
      `image/${format}`,
      width,
      height,
    );
  const favicon = add(
    "favicon.svg",
    new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`,
    ),
    "image/svg+xml",
  );
  const header = await raster("header.jpg", 160, 80, "jpeg");
  const original = await raster("original.png", 240, 120);
  const assets = {
    version: 1,
    originals: [original],
    header,
    loader: header,
    favicon,
    apple_touch: await raster("apple.png", 180, 180),
    icon_192: await raster("192.png", 192, 192),
    icon_512: await raster("512.png", 512, 512),
    maskable_512: await raster("maskable.png", 512, 512),
    og: await raster("og.jpg", 1200, 630, "jpeg"),
  };
  const origin = "https://abcdefghijklmnopqrst.supabase.co";
  const identity = parseStoreIdentity(
    {
      store_name:
        variant === "aurora" ? "Loja Aurora — Ensaio" : "Loja Oceano — Ensaio",
      store_city: null,
      store_state: null,
      logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
      primary_color: color,
      secondary_color: "#FFFFFF",
      accent_color: "#C99730",
      branding_assets: assets,
    },
    origin,
  );
  return Object.freeze({
    identity,
    revision: await identityRevision(identity),
    files: Object.freeze(files),
  });
}
