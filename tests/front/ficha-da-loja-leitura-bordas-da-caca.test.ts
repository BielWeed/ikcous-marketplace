// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) em `src/config/fichaDaLoja.ts`: bordas da
// validação da ficha que o porteiro escreve no HTML e que o app confere ANTES
// de abrir a loja (falha fechada: ficha presente e torta LANÇA, nunca cai no
// assado de outra loja). Cada caso nasceu de um defeito de uma linha plantado
// de propósito que os testes vizinhos (`ficha-da-loja-leitura.test.ts` e
// `ficha-da-loja-falha-visivel.test.ts`) deixavam passar:
//  - o endereço público da loja pode ser http COM PORTA (o ensaio local dos
//    hosts usa `http://loja-a.localhost:<porta>`), e a porta conta na conferência;
//  - os endereços das imagens têm de ser texto que COMEÇA com `https://`: http,
//    prefixo disfarçado e valor que não é texto (lista de um texto) não valem;
//  - host vazio é recusado mesmo quando não há `location` para comparar.
import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
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

function identidadeValida() {
  const header = asset("header.png", "image/png");
  const row = {
    store_name: "Loja Teste",
    store_city: null,
    store_state: null,
    primary_color: "#123456",
    secondary_color: "#abcdef",
    accent_color: "#fedcba",
    logo_url: `${SUPABASE_URL}/storage/v1/object/public/branding/${header.path}`,
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
  return parseStoreIdentity(row, SUPABASE_URL);
}

function fichaValida(overrides: Partial<FichaDaLoja> = {}): FichaDaLoja {
  return {
    schemaVersion: 2,
    host: "loja-a.exemplo.com",
    identidade: {
      identity: identidadeValida(),
      localUrls: {
        originals: ["https://cdn.exemplo/originals/o.png"],
        header: "https://cdn.exemplo/header.png",
        loader: "https://cdn.exemplo/loader.png",
        favicon: "https://cdn.exemplo/favicon.png",
        apple_touch: "https://cdn.exemplo/apple.png",
        icon_192: "https://cdn.exemplo/icon192.png",
        icon_512: "https://cdn.exemplo/icon512.png",
        maskable_512: "https://cdn.exemplo/maskable.png",
        og: "https://cdn.exemplo/og.png",
      },
      publicUrl: "https://loja-a.exemplo.com",
      identityRevision: "b".repeat(64),
    },
    conexao: {
      supabaseUrl: SUPABASE_URL,
      publishableKey: "sb_publishable_ficha_valida_abc",
    },
    configuracao: {
      mpPublicKey: "APP_USR-ficha-valida",
      vapidPublicKey: "Bficha-valida",
      pagamentoOnline: true,
      manutencao: false,
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

async function importarLimpo() {
  vi.resetModules();
  return import("@/config/fichaDaLoja");
}

describe("fichaDaLoja.ts — bordas da validação da ficha", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.stubGlobal("location", { hostname: "loja-a.exemplo.com" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  async function ler(ficha: unknown) {
    injetarFicha(JSON.stringify(ficha));
    const { lerFichaDaLoja } = await importarLimpo();
    return lerFichaDaLoja;
  }

  function comLocalUrls(troca: Record<string, unknown>) {
    const ficha = fichaValida();
    return {
      ...ficha,
      identidade: {
        ...ficha.identidade,
        localUrls: { ...ficha.identidade.localUrls, ...troca },
      },
    };
  }

  it("endereço público http com PORTA (ensaio local dos hosts) é aceito e devolvido inteiro", async () => {
    const ficha = fichaValida();
    const lerFicha = await ler({
      ...ficha,
      identidade: {
        ...ficha.identidade,
        publicUrl: "http://loja-a.exemplo.com:4310",
      },
    });

    expect(lerFicha()?.identidade.publicUrl).toBe(
      "http://loja-a.exemplo.com:4310",
    );
  });

  it("endereço público com a porta que o endereço recebido não tem (ou o contrário) é recusado", async () => {
    const ficha = fichaValida();
    const lerFicha = await ler({
      ...ficha,
      identidade: {
        ...ficha.identidade,
        publicUrl: "https://loja-a.exemplo.com:443/",
      },
    });

    expect(() => lerFicha()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it.each([
    ["http (sem o s)", "http://cdn.exemplo/header.png"],
    ["https escondido depois de outro começo", "javascript:alert('https://')"],
    ["https escondido no meio do endereço", "x-https://cdn.exemplo/header.png"],
  ])(
    "imagem da loja com endereço %s: lança IDENTITY_FICHA_INVALID",
    async (_rotulo, endereco) => {
      const lerFicha = await ler(comLocalUrls({ header: endereco }));

      expect(() => lerFicha()).toThrow("IDENTITY_FICHA_INVALID");
    },
  );

  it("imagem da loja que não é texto, mesmo sendo uma lista com o endereço https: lança IDENTITY_FICHA_INVALID", async () => {
    const lerFicha = await ler(
      comLocalUrls({ header: ["https://cdn.exemplo/header.png"] }),
    );

    expect(() => lerFicha()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("host vazio é recusado até quando não há `location` para comparar (service worker)", async () => {
    vi.stubGlobal("location", undefined);
    const lerFicha = await ler({ ...fichaValida(), host: "" });

    expect(() => lerFicha()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("sem `location` (service worker), uma ficha válida passa sem comparar o host", async () => {
    vi.stubGlobal("location", undefined);
    const lerFicha = await ler(fichaValida());

    expect(lerFicha()?.host).toBe("loja-a.exemplo.com");
  });
  it("revisão da identidade vazia: lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    const lerFicha = await ler({
      ...ficha,
      identidade: { ...ficha.identidade, identityRevision: "" },
    });

    expect(() => lerFicha()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("chave pública da conexão vazia: lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    const lerFicha = await ler({
      ...ficha,
      conexao: { ...ficha.conexao, publishableKey: "" },
    });

    expect(() => lerFicha()).toThrow("IDENTITY_FICHA_INVALID");
  });
  it("o host do navegador em caixa mista ainda bate com o host da ficha (que é minúsculo)", async () => {
    vi.stubGlobal("location", { hostname: "LOJA-A.Exemplo.com" });
    const lerFicha = await ler(fichaValida());

    expect(lerFicha()?.host).toBe("loja-a.exemplo.com");
  });
  it("a ficha devolvida diz schemaVersion 2 e a conexão com a barra final do banco já retirada", async () => {
    const ficha = fichaValida();
    const lerFicha = await ler({
      ...ficha,
      conexao: { ...ficha.conexao, supabaseUrl: `${SUPABASE_URL}/` },
    });

    const lida = lerFicha();
    expect(lida?.schemaVersion).toBe(2);
    expect(lida?.conexao.supabaseUrl).toBe(SUPABASE_URL);
  });
});
