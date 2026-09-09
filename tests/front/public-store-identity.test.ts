import {
  downloadIdentityAssets,
  readPublicStoreIdentity,
} from "@/lib/publicStoreIdentity";
import { identityRevision, parseStoreIdentity } from "@/lib/storeIdentity";
import type { PublicStoreIdentity } from "@/lib/storeIdentity";
import { afterEach, describe, expect, it, vi } from "vitest";
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};

const origin = "https://abcdefghijklmnopqrst.supabase.co";
const publicKey = "sb_publishable_fixture_public_a";
const base64url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const jwt = (role: string) =>
  `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url(JSON.stringify({ role }))}.fictional_signature`;
// Independently computed once with node:crypto, not with the production revision code.
const knownHashes = new Map([
  [
    "header.svg",
    "5dd241dc69885d23c9ebb806f760b3b9e79615c390b882c77cc8f5048783e0d7",
  ],
  ["f.ico", "28e706fa02a2fe0b5959eb913740ee9cbb99d9b8da6fd0f4212e5030ddb7044b"],
  [
    "180.png",
    "f9cdb73f64e5033e6eedfab5cb2b61df71fd979f94396fc16c165c6b52a2f94a",
  ],
  [
    "192.png",
    "284aadb5202d7b62a44944230d9b4740f55e7c2205d780523ffc228b3046091d",
  ],
  [
    "512.png",
    "be40e81f3cbf4e836206a4af8254e309b0e0e2e529ba88f8c16e893ee438cdb4",
  ],
  [
    "og.png",
    "53163cb9e505bd25d57b19037b815a8c4355d06de24dffe2de8324f6e0e110d3",
  ],
]);
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function fixture(project = origin) {
  const files = new Map<string, Uint8Array>();
  const file = (
    name: string,
    width?: number,
    height?: number,
    mime = "image/png",
  ) => {
    const bytes =
      mime === "image/svg+xml"
        ? new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg"><title>Marca</title></svg>',
          )
        : mime === "image/vnd.microsoft.icon"
          ? new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0])
          : new Uint8Array([
              137,
              80,
              78,
              71,
              13,
              10,
              26,
              10,
              ...new TextEncoder().encode(name),
            ]);
    const sha256 = knownHashes.get(name)!;
    const path = `v1/${sha256}/${name}`;
    files.set(path, bytes);
    return {
      path,
      sha256,
      media_type: mime,
      bytes: bytes.length,
      ...(width === undefined ? {} : { width, height }),
    };
  };
  const header = file("header.svg", undefined, undefined, "image/svg+xml");
  const icon = file("512.png", 512, 512);
  const row = {
    store_name: "Loja ficticia",
    store_city: null,
    store_state: null,
    primary_color: "#123456",
    secondary_color: "#ABCDEF",
    accent_color: "#FEDCBA",
    logo_url: `${project}/storage/v1/object/public/branding/${header.path}`,
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: header,
      favicon: file("f.ico", undefined, undefined, "image/vnd.microsoft.icon"),
      apple_touch: file("180.png", 180, 180),
      icon_192: file("192.png", 192, 192),
      icon_512: icon,
      maskable_512: icon,
      og: file("og.png", 1200, 630),
    },
  };
  return { row, files, identity: () => parseStoreIdentity(row, project) };
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const textUrl = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : String(input);
function assetFetch(f: ReturnType<typeof fixture>): typeof fetch {
  return vi.fn(async (input, init) => {
    const url = textUrl(input);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(new Headers(init?.headers).has("apikey")).toBe(false);
    const path = url.slice(
      `${origin}/storage/v1/object/public/branding/`.length,
    );
    const bytes = f.files.get(path);
    if (!bytes) throw Error("UNEXPECTED_FETCH");
    const mime = path.endsWith(".svg")
      ? "image/svg+xml; charset=utf-8"
      : path.endsWith(".ico")
        ? "image/vnd.microsoft.icon"
        : "image/png";
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": mime },
    });
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("consulta publica isolada", () => {
  it("prazo da consulta inclui consumo do JSON depois dos headers", async () => {
    const cancel = vi.fn();
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel,
        }),
        { headers: { "content-type": "application/json" } },
      );
    await expect(
      readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey,
        fetchImpl,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_TIMEOUT" });
    expect(cancel).toHaveBeenCalled();
  });
  it("401/403 sem corpo ainda informam permissao", async () => {
    for (const status of [401, 403])
      await expect(
        readPublicStoreIdentity({
          supabaseUrl: origin,
          publicKey,
          fetchImpl: async () => new Response(null, { status }),
        }),
      ).rejects.toMatchObject({ code: "IDENTITY_PERMISSION" });
  });
  it("chave com terminador de linha nao chega a rede", async () => {
    const fetchImpl = vi.fn(async () => response([fixture().row]));
    await expect(
      readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey: `${publicKey}\n`,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_KEY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("importar nao consulta rede nem exige ambiente", async () => {
    const fetchSpy = vi.fn(() => {
      throw Error("UNEXPECTED_FETCH");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.resetModules();
    await import("@/lib/publicStoreIdentity");
    await import("@/lib/storeIdentity");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each([publicKey, jwt("anon")])(
    "SDK consulta somente a view e usa chave publica sem sessao %#",
    async (key) => {
      const f = fixture();
      const fetchImpl = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(textUrl(input));
          expect(url.origin).toBe(origin);
          expect(url.pathname).toBe("/rest/v1/v_store_config");
          expect(url.searchParams.get("select")).toBe(
            "store_name,store_city,store_state,logo_url,primary_color,secondary_color,accent_color,branding_assets",
          );
          expect(url.searchParams.get("id")).toBe("eq.1");
          expect(url.searchParams.get("limit")).toBe("2");
          expect(init?.redirect).toBe("error");
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          expect(new Headers(init?.headers).get("apikey")).toBe(key);
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            `Bearer ${key}`,
          );
          return response([f.row]);
        },
      );
      const identity = await readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey: key,
        fetchImpl,
      });
      expect(identity).toEqual(f.identity());
      expect(JSON.stringify(identity)).not.toContain(key);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "sb_secret_super_private",
    jwt("service_role"),
    jwt("authenticated"),
    "opaque",
    "",
    "sb_publishable_bad key",
  ])("chave privilegiada/ambigua e recusada antes da rede %#", async (key) => {
    const fetchImpl = vi.fn();
    await expect(
      readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey: key,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_KEY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    [401, "IDENTITY_PERMISSION"],
    [403, "IDENTITY_PERMISSION"],
    [500, "IDENTITY_FETCH"],
  ])("HTTP %s gera erro limpo", async (status, code) => {
    const fetchImpl = vi.fn(async () =>
      response({ message: `${publicKey} SECRET RESPONSE` }, Number(status)),
    );
    const error = await readPublicStoreIdentity({
      supabaseUrl: origin,
      publicKey,
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(publicKey);
    expect(String(error)).not.toContain("SECRET RESPONSE");
  });
  it("schema velho e linhas ausentes/multiplas nao viram fallback", async () => {
    await expect(
      readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey,
        fetchImpl: async () =>
          response({ code: "42703", message: "secret" }, 400),
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_SCHEMA" });
    for (const rows of [[], [fixture().row, fixture().row]])
      await expect(
        readPublicStoreIdentity({
          supabaseUrl: origin,
          publicKey,
          fetchImpl: async () => response(rows),
        }),
      ).rejects.toMatchObject({ code: "IDENTITY_ROWS" });
  });
  it("timeout total aborta mesmo quando o transporte nunca responde", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    };
    await expect(
      readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey,
        fetchImpl,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_TIMEOUT" });
    expect(signal?.aborted).toBe(true);
  });
  it("resposta redirecionada e rejeitada", async () => {
    const redirected = response([fixture().row]);
    Object.defineProperty(redirected, "url", {
      value: "https://evil.example/data",
    });
    await expect(
      readPublicStoreIdentity({
        supabaseUrl: origin,
        publicKey,
        fetchImpl: async () => redirected,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_ORIGIN" });
  });
  it("duas lojas e chaves distintas nao cruzam identidade", async () => {
    const second = "https://zyxwvutsrqponmlkjihg.supabase.co";
    const a = await readPublicStoreIdentity({
      supabaseUrl: origin,
      publicKey,
      fetchImpl: async () => response([fixture().row]),
    });
    const b = await readPublicStoreIdentity({
      supabaseUrl: second,
      publicKey: "sb_publishable_fixture_b",
      fetchImpl: async () => response([fixture(second).row]),
    });
    expect(a.urls.header).not.toBe(b.urls.header);
    expect(await identityRevision(a)).not.toBe(await identityRevision(b));
    const a2 = await readPublicStoreIdentity({
      supabaseUrl: origin,
      publicKey: "sb_publishable_rotated_key",
      fetchImpl: async () => response([fixture().row]),
    });
    expect(await identityRevision(a2)).toBe(await identityRevision(a));
  });
});

describe("arquivos completos e intactos", () => {
  it.each(["image/jpeg", "image/webp"])(
    "original %s com assinatura valida preserva bytes",
    async (mime) => {
      const f = fixture();
      const bytes = new Uint8Array(
        mime === "image/jpeg"
          ? [255, 216, 255, 224, 0, 4, 1, 2]
          : [82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80],
      );
      const sha256 = await hash(bytes);
      const path = `v1/${sha256}/original.${mime === "image/jpeg" ? "jpg" : "webp"}`;
      const row = {
        ...f.row,
        branding_assets: {
          ...f.row.branding_assets,
          originals: [{ path, sha256, bytes: bytes.length, media_type: mime }],
        },
      };
      const other = assetFetch(f);
      const fetchImpl: typeof fetch = async (input, init) =>
        textUrl(input).endsWith(path)
          ? new Response(bytes, { headers: { "content-type": mime } })
          : other(input, init);
      const result = await downloadIdentityAssets(
        parseStoreIdentity(row, origin),
        { fetchImpl },
      );
      expect(result.files.find((file) => file.path === path)?.bytes).toEqual(
        bytes,
      );
    },
  );
  it("PNG SVG ICO preservados byte a byte; caminho compartilhado baixa uma vez", async () => {
    const f = fixture();
    const fetchImpl = assetFetch(f);
    const result = await downloadIdentityAssets(f.identity(), { fetchImpl });
    expect(result.files).toHaveLength(f.files.size);
    expect(fetchImpl).toHaveBeenCalledTimes(f.files.size);
    for (const file of result.files) {
      expect(file.bytes).toEqual(f.files.get(file.path));
      expect(file.sha256).toBe(await hash(file.bytes));
    }
    expect(result.revision).toBe(await identityRevision(f.identity()));
  });
  it("falha no ultimo arquivo recusa todo resultado", async () => {
    const f = fixture();
    const good = assetFetch(f);
    let calls = 0;
    const fetchImpl: typeof fetch = async (...args) => {
      calls++;
      return calls === f.files.size
        ? new Response(null, { status: 404 })
        : good(...args);
    };
    await expect(
      downloadIdentityAssets(f.identity(), { fetchImpl }),
    ).rejects.toMatchObject({ code: "IDENTITY_ASSET_STATUS" });
    expect(calls).toBe(f.files.size);
  });
  it.each(["mime", "size", "hash", "signature", "redirect"])(
    "recusa %s divergente",
    async (kind) => {
      const f = fixture();
      const bytes = f.files.get(f.row.branding_assets.header.path)!;
      let body: Uint8Array = new Uint8Array(bytes);
      let mime = "image/svg+xml";
      if (kind === "mime") mime = "text/html";
      if (kind === "size") body = new Uint8Array(bytes.length + 1);
      if (kind === "hash") body[body.length - 1] ^= 1;
      const fetchImpl: typeof fetch = async () => {
        const r = new Response(body as Uint8Array<ArrayBuffer>, {
          headers: { "content-type": mime },
        });
        if (kind === "redirect")
          Object.defineProperty(r, "redirected", { value: true });
        return r;
      };
      if (kind === "signature") {
        const p = f.row.branding_assets;
        const png = f.files.get(p.icon_512.path)!;
        png[0] = 0;
        const sha = await hash(png);
        const changed = {
          ...p.icon_512,
          path: `v1/${sha}/512.png`,
          sha256: sha,
        };
        p.icon_512 = changed;
        p.maskable_512 = changed;
        f.files.set(changed.path, png);
        await expect(
          downloadIdentityAssets(f.identity(), { fetchImpl: assetFetch(f) }),
        ).rejects.toMatchObject({ code: "IDENTITY_ASSET_MIME" });
      } else
        await expect(
          downloadIdentityAssets(f.identity(), { fetchImpl }),
        ).rejects.toHaveProperty("code");
    },
  );
  it("stream acima do descritor e cancelado antes de ler sem limite", async () => {
    const cancel = vi.fn();
    const f = fixture();
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024));
          },
          cancel,
        }),
        { headers: { "content-type": "image/svg+xml" } },
      );
    await expect(
      downloadIdentityAssets(f.identity(), { fetchImpl }),
    ).rejects.toMatchObject({ code: "IDENTITY_ASSET_SIZE" });
    expect(cancel).toHaveBeenCalled();
  });
  it("prazo cobre corpo parado e cancela leitor", async () => {
    const cancel = vi.fn();
    const f = fixture();
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel,
        }),
        { headers: { "content-type": "image/svg+xml" } },
      );
    await expect(
      downloadIdentityAssets(f.identity(), { fetchImpl, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "IDENTITY_TIMEOUT" });
    expect(cancel).toHaveBeenCalled();
  });
  it("clona antes do primeiro await; mutacao externa nao altera revisao/bytes", async () => {
    const f = fixture();
    const identity = structuredClone(
      f.identity(),
    ) as Mutable<PublicStoreIdentity>;
    const good = assetFetch(f);
    const fetchImpl: typeof fetch = async (...args) => {
      identity.storeName = "changed";
      identity.assets.header.bytes = 999;
      return good(...args);
    };
    const result = await downloadIdentityAssets(identity, { fetchImpl });
    expect(result.identity.storeName).toBe("Loja ficticia");
    expect(result.revision).toBe(await identityRevision(f.identity()));
  });
  it("identidade forjada com URL de outro host falha antes da rede", async () => {
    const f = fixture();
    const forged = {
      ...f.identity(),
      urls: { ...f.identity().urls, og: "https://evil.example/a.png" },
    };
    const fetchImpl = vi.fn();
    await expect(
      downloadIdentityAssets(forged, { fetchImpl }),
    ).rejects.toMatchObject({ code: "IDENTITY_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
