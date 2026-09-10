import type { BrandingAssets } from "@/lib/storeIdentity";

// Descritores sintéticos: nenhum arquivo ou endereço de loja real.
export function pacoteDeMarca() {
  const asset = (name: string, width = 64, height = width) => ({
    path: `v1/${"a".repeat(64)}/${name}.png`,
    sha256: "a".repeat(64),
    media_type: "image/png" as const,
    bytes: 100,
    width,
    height,
  });
  return {
    version: 1 as const,
    originals: [asset("original-1"), asset("original-2", 128)],
    header: asset("header"),
    loader: asset("loader"),
    favicon: asset("favicon"),
    apple_touch: asset("apple", 180),
    icon_192: asset("icon-192", 192),
    icon_512: asset("icon-512", 512),
    maskable_512: asset("maskable", 512),
    og: asset("og", 1200, 630),
  } satisfies BrandingAssets;
}

export const urlDoHeader = `https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/store-branding/v1/${"a".repeat(64)}/header.png`;
