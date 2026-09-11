// @vitest-environment jsdom
//
// A metade de fora de `fichaDaLoja.ts`: prova que `buildIdentity.ts`
// (src/config/buildIdentity.ts) e `env-valores.ts` (src/lib/env-valores.ts)
// REALMENTE preferem a ficha quando ela existe, e continuam batendo no
// assado quando não existe — a promessa de "zero quebra nos 3520 testes"
// da medição do passo 2
// (equipe/entregas/20260911-medicao-passo2-identidade-fora-do-build.md)
// depende disso.
//
// Asserção sempre pela DIFERENÇA (valor da ficha != valor do assado), como
// o brief pede — não basta "leu algo", tem que provar que o algo lido é o
// da ficha e não o que sobrou do define.
import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

const SUPABASE_URL_FICHA = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);

function asset(
  name: string,
  mediaType: string,
  width?: number,
  height?: number,
) {
  return {
    path: `v1/${HASH}/${name}`,
    sha256: HASH,
    media_type: mediaType,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function identidadeDaFicha() {
  const header = asset("header.png", "image/png");
  const row = {
    store_name: "Loja Da Ficha",
    store_city: null,
    store_state: null,
    primary_color: "#654321",
    secondary_color: "#abcdef",
    accent_color: "#fedcba",
    logo_url: `${SUPABASE_URL_FICHA}/storage/v1/object/public/branding/${header.path}`,
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: header,
      favicon: asset("favicon.png", "image/png"),
      apple_touch: asset("apple.png", "image/png", 180, 180),
      icon_192: asset("icon192.png", "image/png", 192, 192),
      icon_512: asset("icon512.png", "image/png", 512, 512),
      maskable_512: asset("maskable.png", "image/png", 512, 512),
      og: asset("og.png", "image/png", 1200, 630),
    },
  };
  return parseStoreIdentity(row, SUPABASE_URL_FICHA);
}

function fichaValida(overrides: Partial<FichaDaLoja> = {}): FichaDaLoja {
  return {
    schemaVersion: 1,
    host: "loja-da-ficha.exemplo.com",
    identidade: {
      identity: identidadeDaFicha(),
      localUrls: {
        originals: ["https://cdn.ficha/o.png"],
        header: "https://cdn.ficha/header.png",
        loader: "https://cdn.ficha/loader.png",
        favicon: "https://cdn.ficha/favicon.png",
        apple_touch: "https://cdn.ficha/apple.png",
        icon_192: "https://cdn.ficha/icon192.png",
        icon_512: "https://cdn.ficha/icon512.png",
        maskable_512: "https://cdn.ficha/maskable.png",
        og: "https://cdn.ficha/og.png",
      },
      publicUrl: "https://loja-da-ficha.exemplo.com",
      identityRevision: "c".repeat(64),
    },
    conexao: {
      supabaseUrl: SUPABASE_URL_FICHA,
      publishableKey: "sb_publishable_da_ficha_teste",
    },
    ...overrides,
  };
}

function injetarFicha(conteudo: string) {
  const elemento = document.createElement("script");
  elemento.type = "application/json";
  elemento.id = FICHA_DA_LOJA_ID;
  elemento.textContent = conteudo;
  document.head.appendChild(elemento);
}

describe("buildIdentity.ts e env-valores.ts — a ficha da loja vence o assado", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.stubEnv("VITE_SUPABASE_URL", "https://assado.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_assado");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    // Falha fechada por HOST (menor da revisão Opus, rodada B): a fixture
    // deste arquivo usa "loja-da-ficha.exemplo.com"; jsdom, sem isto,
    // devolve "localhost" por padrão.
    vi.stubGlobal("location", { hostname: "loja-da-ficha.exemplo.com" });
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ficha ausente: buildIdentity É o assado — zero quebra no caminho de hoje", async () => {
    vi.resetModules();
    const assado = criarBuildIdentity("Assado", "assado");
    vi.stubGlobal("__STORE_IDENTITY__", assado);

    const { buildIdentity } = await import("@/config/buildIdentity");

    expect(buildIdentity).toBe(assado);
    expect(buildIdentity.identity.storeName).toBe("Assado");
    expect(buildIdentity.source).toBe("fixture");
  });

  it("ficha ausente: env-valores lê do ambiente de build, como antes", async () => {
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity());

    const { lerSupabaseUrl, lerChaveSupabase, lerOrigemChaveSupabase } =
      await import("@/lib/env-valores");

    expect(lerSupabaseUrl()).toBe("https://assado.supabase.co");
    expect(lerChaveSupabase()).toBe("sb_publishable_assado");
    expect(lerOrigemChaveSupabase()).toBe("VITE_SUPABASE_PUBLISHABLE_KEY");
  });

  it("ficha válida: buildIdentity devolve marca e conexão DELA — diferentes do assado", async () => {
    const assado = criarBuildIdentity("Assado", "assado");
    injetarFicha(JSON.stringify(fichaValida()));
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", assado);

    const { buildIdentity } = await import("@/config/buildIdentity");

    expect(buildIdentity.source).toBe("porteiro");
    expect(buildIdentity.identity.storeName).toBe("Loja Da Ficha");
    expect(buildIdentity.identity.storeName).not.toBe(
      assado.identity.storeName,
    );
    expect(buildIdentity.publicUrl).toBe("https://loja-da-ficha.exemplo.com");
    expect(buildIdentity.publicUrl).not.toBe(assado.publicUrl);
    expect(buildIdentity.localUrls.header).toBe("https://cdn.ficha/header.png");
    expect(buildIdentity.localUrls.header).not.toBe(assado.localUrls.header);
    expect(buildIdentity.identityRevision).toBe("c".repeat(64));
    expect(buildIdentity.identityRevision).not.toBe(assado.identityRevision);

    // Os campos de CÓDIGO continuam vindo do assado — a ficha não os carrega.
    expect(buildIdentity.codeVersion).toBe(assado.codeVersion);
    expect(buildIdentity.codeSha).toBe(assado.codeSha);
    expect(buildIdentity.deliveryVersion).toBe(assado.deliveryVersion);
    expect(buildIdentity.schemaVersion).toBe(assado.schemaVersion);
  });

  it("RECONSTRUÇÃO: campos extras em `identidade` (deliveryVersion, source, codeSha) NÃO são carregados — buildIdentity.deliveryVersion continua o do assado", async () => {
    const assado = criarBuildIdentity("Assado", "assado");
    const ficha = fichaValida();
    // `validarFicha` (fichaDaLoja.ts) monta o objeto de RETORNO como um
    // literal com só os 4 campos do contrato (`identity`, `localUrls`,
    // `publicUrl`, `identityRevision`) — qualquer campo extra que uma ficha
    // MAL-FORMADA (ou um porteiro de versão futura) coloque dentro de
    // `identidade` morre na validação, nunca chega a `buildIdentity.ts`.
    // `deliveryVersion` é campo de CÓDIGO — vem SEMPRE do assado, nunca da
    // ficha (documentado no cabeçalho de `buildIdentity.ts`).
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          deliveryVersion: "injetado-pela-ficha",
          source: "injetado-pela-ficha",
          codeSha: "injetado-pela-ficha",
        },
      }),
    );
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", assado);

    const { buildIdentity } = await import("@/config/buildIdentity");

    // A marca ainda vem da ficha — a validação não jogou tudo fora.
    expect(buildIdentity.identity.storeName).toBe("Loja Da Ficha");
    // Mas os campos extras não sobreviveram, e os campos de CÓDIGO
    // continuam sendo os do assado, não o valor injetado.
    expect(buildIdentity.deliveryVersion).toBe(assado.deliveryVersion);
    expect(buildIdentity.deliveryVersion).not.toBe("injetado-pela-ficha");
    expect(buildIdentity.codeSha).toBe(assado.codeSha);
    expect(buildIdentity.codeSha).not.toBe("injetado-pela-ficha");
    expect(buildIdentity.source).toBe("porteiro");
    expect(buildIdentity.source).not.toBe("injetado-pela-ficha");
  });

  it("ficha válida: env-valores devolve a conexão DELA — diferente do ambiente de build", async () => {
    injetarFicha(JSON.stringify(fichaValida()));
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity());

    const { lerSupabaseUrl, lerChaveSupabase, lerOrigemChaveSupabase } =
      await import("@/lib/env-valores");

    expect(lerSupabaseUrl()).toBe(SUPABASE_URL_FICHA);
    expect(lerSupabaseUrl()).not.toBe("https://assado.supabase.co");
    expect(lerChaveSupabase()).toBe("sb_publishable_da_ficha_teste");
    expect(lerChaveSupabase()).not.toBe("sb_publishable_assado");
    expect(lerOrigemChaveSupabase()).toBe("ficha");
  });

  it("ficha PRESENTE e inválida: importar buildIdentity.ts LANÇA — nunca cai no assado (que pode ser de outra loja)", async () => {
    const ficha = fichaValida();
    injetarFicha(JSON.stringify({ ...ficha, schemaVersion: 2 }));
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Assado", "assado"));

    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "IDENTITY_FICHA_INVALID",
    );
  });

  it("ficha PRESENTE e inválida: IMPORTAR env-valores.ts sozinho NÃO lança — só chamar ler*() lança", async () => {
    const ficha = fichaValida();
    injetarFicha(JSON.stringify({ ...ficha, host: "" }));
    vi.resetModules();

    const mod = await import("@/lib/env-valores");

    expect(() => mod.lerSupabaseUrl()).toThrow("IDENTITY_FICHA_INVALID");
  });
});
