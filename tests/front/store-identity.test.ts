import {
  identityRevision,
  normalizeSupabaseOrigin,
  parseBrandingAssets,
  parseIdentityAsset,
  parseStoreIdentity,
} from "@/lib/storeIdentity";
import { describe, expect, it } from "vitest";

const origin = "https://abcdefghijklmnopqrst.supabase.co";
function fixture() {
  const file = (
    name: string,
    width?: number,
    height?: number,
    media_type = "image/png",
  ) => ({
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    media_type,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  });
  return {
    store_name: 'Loja "A" <script>dados</script>',
    store_city: " Cidade ",
    store_state: "sp",
    logo_url: `${origin}/storage/v1/object/public/branding/v1/${"a".repeat(64)}/header.svg`,
    primary_color: "#aabbcc",
    secondary_color: "#112233",
    accent_color: "#000000",
    branding_assets: {
      version: 1,
      originals: [file("header.svg", undefined, undefined, "image/svg+xml")],
      header: file("header.svg", undefined, undefined, "image/svg+xml"),
      loader: file("header.svg", undefined, undefined, "image/svg+xml"),
      favicon: file("f.ico", undefined, undefined, "image/vnd.microsoft.icon"),
      apple_touch: file("a.png", 180, 180),
      icon_192: file("b.png", 192, 192),
      icon_512: file("c.png", 512, 512),
      maskable_512: file("c.png", 512, 512),
      og: file("og.jpg", 1200, 630, "image/jpeg"),
    },
  };
}

describe("parser individual do mesmo contrato A3", () => {
  it("clona, congela e aceita raster sem dimensoes e o limite exato", () => {
    const source = { ...fixture().branding_assets.icon_512 };
    const result = parseIdentityAsset(source);
    source.bytes = 123;
    expect(result.bytes).toBe(100);
    expect(result).not.toBe(source);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    const { width: _width, height: _height, ...withoutSize } = source;
    expect(parseIdentityAsset({ ...withoutSize, bytes: 20971520 }).bytes).toBe(
      20971520,
    );
  });
  it.each([
    null,
    {},
    { extra: true },
    { sha256: "b".repeat(64) },
    { path: `v1/${"a".repeat(64)}/wrong.jpg` },
    { media_type: "image/jpeg" },
    { bytes: 0 },
    { bytes: 20971521 },
    { bytes: 1.5 },
    { width: undefined },
    { width: 8193 },
  ])("recusa entrada individual fora do schema %#", (patch) => {
    const value =
      patch === null || Object.keys(patch).length === 0
        ? patch
        : { ...fixture().branding_assets.icon_512, ...patch };
    expect(() => parseIdentityAsset(value)).toThrow("IDENTITY_INVALID");
  });
});

describe("identidade publica pura", () => {
  it("limites validos de originais, bytes e dimensoes sao aceitos", () => {
    const p = fixture().branding_assets;
    for (const bytes of [1, 20971520])
      for (const size of [1, 8192]) {
        const original = {
          ...p.header,
          path: p.header.path.replace("header.svg", "original.svg"),
          bytes,
          width: size,
          height: size,
        };
        expect(
          parseBrandingAssets({ ...p, originals: Array(8).fill(original) })
            .originals,
        ).toHaveLength(8);
      }
  });
  it("trocar descritor ou ordem dos originais troca revisao", async () => {
    const row = fixture();
    const a = {
      ...row.branding_assets.header,
      path: row.branding_assets.header.path.replace("header.svg", "a.svg"),
    };
    const b = { ...a, path: a.path.replace("a.svg", "b.svg") };
    const left = parseStoreIdentity(
      {
        ...row,
        branding_assets: { ...row.branding_assets, originals: [a, b] },
      },
      origin,
    );
    const right = parseStoreIdentity(
      {
        ...row,
        branding_assets: { ...row.branding_assets, originals: [b, a] },
      },
      origin,
    );
    expect(await identityRevision(left)).not.toBe(
      await identityRevision(right),
    );
  });
  it("rejeita terminador de linha em origem, cor, hash e path", () => {
    expect(() => normalizeSupabaseOrigin(`${origin}\n`)).toThrow();
    expect(() =>
      parseStoreIdentity({ ...fixture(), accent_color: "#AABBCC\n" }, origin),
    ).toThrow();
    const p = fixture().branding_assets;
    expect(() =>
      parseBrandingAssets({
        ...p,
        header: { ...p.header, path: `${p.header.path}\n` },
      }),
    ).toThrow();
  });
  it("dimensoes explicitamente undefined nao equivalem a campos omitidos", () => {
    const p = fixture().branding_assets;
    const header = { ...p.header, width: undefined, height: undefined };
    expect(() =>
      parseBrandingAssets({
        ...p,
        header,
        loader: header,
        originals: [header],
      }),
    ).toThrow();
  });
  it("valida, normaliza e conserva texto como dado; resultado nao compartilha referencias", () => {
    const row = fixture();
    const identity = parseStoreIdentity(row, `${origin}/`);
    expect(identity).toMatchObject({
      schemaVersion: 1,
      projectRef: "abcdefghijklmnopqrst",
      storeName: row.store_name,
      city: "Cidade",
      state: "SP",
      theme: { primary: "#AABBCC", secondary: "#112233", accent: "#000000" },
    });
    expect(identity.urls.header).toBe(row.logo_url);
    row.branding_assets.header.bytes = 999;
    expect(identity.assets.header.bytes).toBe(100);
    expect(Object.isFrozen(identity.assets.header)).toBe(true);
  });
  it.each([
    "http://abcdefghijklmnopqrst.supabase.co",
    `${origin}:443`,
    `${origin}?x=1`,
    `${origin}#x`,
    `${origin}/rest`,
    `${origin}//`,
    "https://user@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.example",
    "https://x.abcdefghijklmnopqrst.supabase.co",
    "https://localhost",
    "https://127.0.0.1",
    " https://abcdefghijklmnopqrst.supabase.co",
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
  ])("recusa origem %s", (value) => {
    expect(() => normalizeSupabaseOrigin(value)).toThrow();
  });
  it("nao mistura duas lojas", () => {
    expect(() =>
      parseStoreIdentity(fixture(), "https://zyxwvutsrqponmlkjihg.supabase.co"),
    ).toThrow();
  });
  it.each([
    "store_name",
    "store_city",
    "store_state",
    "logo_url",
    "primary_color",
    "secondary_color",
    "accent_color",
    "branding_assets",
  ])("coluna ausente %s falha fechado", (field) => {
    const row = Object.fromEntries(
      Object.entries(fixture()).filter(([key]) => key !== field),
    );
    expect(() => parseStoreIdentity(row, origin)).toThrow();
  });
  it.each([
    { store_name: " " },
    { store_name: "x".repeat(161) },
    { store_city: "x".repeat(161) },
    { store_state: "USA" },
    { primary_color: "#000000" },
    { primary_color: null },
    { secondary_color: null },
    { accent_color: "red" },
    { branding_assets: null },
    { logo_url: `${fixture().logo_url}?x=1` },
    { secret: "forbidden" },
  ])("recusa linha incompleta/invalida %#", (patch) =>
    expect(() =>
      parseStoreIdentity({ ...fixture(), ...patch }, origin),
    ).toThrow(),
  );
  it("localizacao nula ou vazia nao inventa conteudo", () => {
    expect(
      parseStoreIdentity(
        { ...fixture(), store_city: null, store_state: " " },
        origin,
      ),
    ).toMatchObject({ city: null, state: null });
  });
  it.each([
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      version: 2,
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      extra: true,
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      originals: [],
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      originals: Array(9).fill(p.header),
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, width: 1 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, height: 1, width: 8193 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, sha256: "b".repeat(64) },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, bytes: 0 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, bytes: 20971521 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, bytes: 1.5 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      header: { ...p.header, media_type: "image/png" },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      icon_192: { ...p.icon_192, width: 193 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      apple_touch: { ...p.header, width: 180, height: 180 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      og: { ...p.og, height: 631 },
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      favicon: p.og,
    }),
    (p: ReturnType<typeof fixture>["branding_assets"]) => ({
      ...p,
      loader: { ...p.header, bytes: 101 },
    }),
  ])("pacote fechado e descritores coerentes %#", (alter) =>
    expect(() =>
      parseBrandingAssets(alter(fixture().branding_assets)),
    ).toThrow(),
  );
  it.each([
    "../x.svg",
    "x.svg?x=1",
    "x.svg#x",
    "%61.svg",
    "a/b.svg",
    "a\\b.svg",
    `${"a".repeat(81)}.svg`,
  ])("recusa path inseguro %s", (name) => {
    const p = fixture().branding_assets;
    expect(() =>
      parseBrandingAssets({
        ...p,
        header: { ...p.header, path: `v1/${"a".repeat(64)}/${name}` },
      }),
    ).toThrow();
  });
  it("revisao e SHA256 canonico, independente de ordem, caixa equivalente e relogio", async () => {
    const row = fixture();
    const first = parseStoreIdentity(row, origin);
    const reordered = Object.fromEntries(Object.entries(row).reverse());
    reordered.primary_color = "#AABBCC";
    expect(await identityRevision(parseStoreIdentity(reordered, origin))).toBe(
      await identityRevision(first),
    );
    expect(await identityRevision(first)).toMatch(/^[a-f0-9]{64}$/);
    const canonical = (value: unknown): string =>
      Array.isArray(value)
        ? `[${value.map(canonical).join(",")}]`
        : value !== null && typeof value === "object"
          ? `{${Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
              .join(",")}}`
          : JSON.stringify(value);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical(first)),
    );
    expect(await identityRevision(first)).toBe(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
    expect(
      await identityRevision(
        parseStoreIdentity({ ...row, store_name: "Outra" }, origin),
      ),
    ).not.toBe(await identityRevision(first));
  });
});
