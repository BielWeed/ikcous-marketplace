import type { BuildIdentitySnapshot } from "@/config/buildIdentityContract";
import type { IdentityAsset } from "@/lib/storeIdentity";

// Fixture só de apresentação. Nenhum acesso a Vite, env, rede ou preparação Node.
export function criarBuildIdentity(
  storeName = "Aurora",
  directory = "aurora",
): BuildIdentitySnapshot {
  const asset: IdentityAsset = {
    path: `v1/${"a".repeat(64)}/marca.png`,
    sha256: "a".repeat(64),
    media_type: "image/png",
    bytes: 100,
  };
  const localUrls = {
    header: `/identity/${directory}/header.webp`,
    loader: `/identity/${directory}/loader.png`,
    favicon: `/identity/${directory}/favicon.svg`,
    apple_touch: `/identity/${directory}/apple.png`,
    icon_192: `/identity/${directory}/icon-192.png`,
    icon_512: `/identity/${directory}/icon-512.png`,
    maskable_512: `/identity/${directory}/maskable.png`,
    og: `/identity/${directory}/social.png`,
    originals: [`/identity/${directory}/original.png`],
  };
  return {
    schemaVersion: 1,
    source: "fixture",
    identity: {
      schemaVersion: 1,
      projectRef: "runtimefixture",
      storeName,
      city: null,
      state: null,
      theme: { primary: "#123456", secondary: "#008000", accent: "#ff8000" },
      assets: {
        version: 1,
        originals: [asset],
        header: { ...asset, media_type: "image/webp" },
        loader: asset,
        favicon: { ...asset, media_type: "image/svg+xml" },
        apple_touch: asset,
        icon_192: asset,
        icon_512: asset,
        maskable_512: asset,
        og: { ...asset, media_type: "image/png" },
      },
      urls: {
        ...localUrls,
        header: "https://remote.example/header.webp",
        og: "https://remote.example/social.png",
      },
    },
    localUrls,
    publicUrl: "https://aurora.example",
    codeVersion: "1.26.0",
    codeSha: "611b40ef3414ed342e74582063e5b04b2f4f2649",
    identityRevision: "a".repeat(64),
    deliveryVersion: "fixture-runtime",
  };
}

export const buildIdentityFixture = criarBuildIdentity();
