// @vitest-environment jsdom
//
// `lerFichaDaLoja()` (src/config/fichaDaLoja.ts) é o pivô da etapa 2 da
// escala (11/09/2026): antes de qualquer outra coisa, o app confere se o
// porteiro (`middleware.ts`) gravou uma FICHA DA LOJA no HTML. Este arquivo
// prova as duas metades da regra de falha fechada: elemento AUSENTE (ou sem
// `document`) devolve `null` — quem chama cai no assado; elemento PRESENTE
// e inválido LANÇA `IDENTITY_FICHA_INVALID` — nunca cai no assado, que num
// build compartilhado por N lojas pode ser de OUTRA loja.
//
// `vi.resetModules()` por caso: `lerFichaDaLoja()` cacheia o resultado no
// módulo (lê o DOM uma vez), então cada teste precisa de uma instância nova
// do módulo para não herdar o cache do teste anterior — mesmo padrão de
// `env-valores-modulo-puro-sem-efeito-colateral.test.ts`.
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
    schemaVersion: 1,
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

describe("fichaDaLoja.ts — leitura da ficha da loja", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    // Falha fechada por HOST: `location.hostname` tem de bater com
    // `ficha.host` (fixture usa "loja-a.exemplo.com"). jsdom, sem isto,
    // devolve "localhost" por padrão — cada teste que precisa de outro host
    // sobrescreve depois deste `beforeEach`.
    vi.stubGlobal("location", { hostname: "loja-a.exemplo.com" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  it("elemento ausente: devolve null (quem chama cai no assado)", async () => {
    const { lerFichaDaLoja } = await importarLimpo();

    expect(lerFichaDaLoja()).toBeNull();
  });

  it("sem `document`: devolve null, nunca lança (caso do service worker)", async () => {
    vi.stubGlobal("document", undefined);

    const { lerFichaDaLoja } = await importarLimpo();

    expect(lerFichaDaLoja()).toBeNull();
  });

  it("ficha válida: devolve host e conexão dela, e CACHEIA — segunda chamada não relê o DOM", async () => {
    injetarFicha(JSON.stringify(fichaValida()));
    const { lerFichaDaLoja } = await importarLimpo();

    const primeira = lerFichaDaLoja();
    expect(primeira?.host).toBe("loja-a.exemplo.com");
    expect(primeira?.conexao.supabaseUrl).toBe(SUPABASE_URL);
    expect(primeira?.conexao.publishableKey).toBe(
      "sb_publishable_ficha_valida_abc",
    );

    // Muda o DOM DEPOIS da primeira leitura: se o cache não existisse, a
    // segunda chamada relia o textContent quebrado e lançaria.
    document.getElementById(FICHA_DA_LOJA_ID)!.textContent = "isto nao e json";
    expect(lerFichaDaLoja()).toBe(primeira);
  });

  it("JSON quebrado: lança IDENTITY_FICHA_INVALID", async () => {
    injetarFicha("{ isto nao e json valido");
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("schemaVersion diferente de 1: lança IDENTITY_FICHA_INVALID", async () => {
    injetarFicha(JSON.stringify({ ...fichaValida(), schemaVersion: 2 }));
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("host vazio: lança IDENTITY_FICHA_INVALID", async () => {
    injetarFicha(JSON.stringify({ ...fichaValida(), host: "" }));
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("identidade fora do contrato (não passa em parseStoreIdentity): lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          identity: { storeName: "so isso, nao e uma PublicStoreIdentity" },
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("conexao.supabaseUrl fora do formato do Supabase: lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        conexao: { ...ficha.conexao, supabaseUrl: "http://nao-e-supabase.com" },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("chave vazia: lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        conexao: { ...ficha.conexao, publishableKey: "" },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("chave de service_role disfarçada de chave pública: lança IDENTITY_FICHA_INVALID", async () => {
    const b64url = (obj: unknown) =>
      btoa(JSON.stringify(obj))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const jwtServiceRole = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role: "service_role" })}.assinatura_fake`;
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        conexao: { ...ficha.conexao, publishableKey: jwtServiceRole },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("chave anon legítima (JWT role=anon): NÃO lança — só service_role é barrada", async () => {
    const b64url = (obj: unknown) =>
      btoa(JSON.stringify(obj))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const jwtAnon = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role: "anon" })}.assinatura_fake`;
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        conexao: { ...ficha.conexao, publishableKey: jwtAnon },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(lerFichaDaLoja()?.conexao.publishableKey).toBe(jwtAnon);
  });

  // T1c (rodada C, 11/09/2026): a checagem antiga (`chaveEhServiceRole`) só
  // decodificava JWT e olhava `role === "service_role"` — uma chave secreta
  // no formato NOVO do Supabase (`sb_secret_…`, sem ponto, não é JWT) passava
  // batido por ela. `assertPublicSupabaseKey` (src/lib/publicSupabaseKey.ts,
  // a MESMA função que o porteiro usa) só aceita `sb_publishable_…` ou JWT
  // `role: "anon"` — qualquer outra coisa, incluindo `sb_secret_…`, lança.
  it("chave sb_secret_… (secreta, formato novo do Supabase): lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        conexao: {
          ...ficha.conexao,
          publishableKey: "sb_secret_vazou",
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("chave sb_publishable_…: NÃO lança (formato novo, caminho feliz)", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        conexao: {
          ...ficha.conexao,
          publishableKey: "sb_publishable_abc123",
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(lerFichaDaLoja()?.conexao.publishableKey).toBe(
      "sb_publishable_abc123",
    );
  });

  it("`textContent` com `</script>` escapado (`<\\/script>`): parse correto recupera o host original", async () => {
    const hostComTagDeScript =
      "loja</script><script>alert(1)</script>.exemplo.com";
    vi.stubGlobal("location", { hostname: hostComTagDeScript });
    const ficha = fichaValida({ host: hostComTagDeScript });
    // Mesmo escape que o porteiro (src/hospedagem/ficha.ts, T3) aplica ao
    // serializar: `</` -> `<\/`. `\/` é escape JSON válido (decodifica para
    // `/`), então JSON.parse recupera o valor original sem tratamento
    // especial — é essa propriedade que este teste prova.
    const serializado = JSON.stringify(ficha).replaceAll("</", "<\\/");
    expect(serializado).toContain("<\\/script>");
    expect(serializado).not.toContain("</script>");
    injetarFicha(serializado);
    const { lerFichaDaLoja } = await importarLimpo();

    expect(lerFichaDaLoja()?.host).toBe(hostComTagDeScript);
  });

  it("localUrls sem um dos papéis de IDENTITY_ASSET_ROLES (falta `icon_512`): lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    const { icon_512: _removido, ...localUrlsIncompletas } =
      ficha.identidade.localUrls;
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: { ...ficha.identidade, localUrls: localUrlsIncompletas },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("localUrls com um papel que não é `https://` (caminho local do build de loja única): lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          localUrls: {
            ...ficha.identidade.localUrls,
            header: "/store-identity/header.png",
          },
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("localUrls.originals com item que não é string: lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          localUrls: { ...ficha.identidade.localUrls, originals: [123] },
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("publicUrl com barra final: lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          publicUrl: "https://loja-a.exemplo.com/",
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("publicUrl com caminho (não é só host): lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          publicUrl: "https://loja-a.exemplo.com/loja",
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("publicUrl com protocolo que não é http(s): lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          publicUrl: "ftp://loja-a.exemplo.com",
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("defesa em profundidade: identidade.identity.projectRef de OUTRO projeto que não o de conexao.supabaseUrl → lança IDENTITY_FICHA_INVALID", async () => {
    const ficha = fichaValida();
    // Identidade internamente consistente (bate com o PRÓPRIO projectRef
    // dela — `cloneStoreIdentity` não pega isto), mas de um projeto
    // DIFERENTE do que a `conexao` desta ficha aponta — é a marca de uma
    // loja com o banco de outra.
    const outroProjectRef = "zzzzzzzzzzzzzzzzzzzz";
    const novaOrigem = `https://${outroProjectRef}.supabase.co`;
    const identidadeDeOutroProjeto = {
      ...ficha.identidade.identity,
      projectRef: outroProjectRef,
      urls: Object.fromEntries(
        Object.entries(ficha.identidade.identity.urls).map(([papel, url]) =>
          papel === "originals"
            ? [
                papel,
                (url as readonly string[]).map((item) =>
                  item.replace(SUPABASE_URL, novaOrigem),
                ),
              ]
            : [papel, (url as string).replace(SUPABASE_URL, novaOrigem)],
        ),
      ),
    };
    injetarFicha(
      JSON.stringify({
        ...ficha,
        identidade: {
          ...ficha.identidade,
          identity: identidadeDeOutroProjeto,
        },
      }),
    );
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("ficha.host diferente de location.hostname (ficha de OUTRA loja/cache envenenado): lança IDENTITY_FICHA_INVALID", async () => {
    vi.stubGlobal("location", { hostname: "loja-b.exemplo.com" });
    injetarFicha(JSON.stringify(fichaValida()));
    const { lerFichaDaLoja } = await importarLimpo();

    expect(() => lerFichaDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("sem `location` no ambiente: a checagem de host não se aplica (caso hipotético fora de navegador)", async () => {
    injetarFicha(JSON.stringify(fichaValida()));
    vi.stubGlobal("location", undefined);
    const { lerFichaDaLoja } = await importarLimpo();

    expect(lerFichaDaLoja()?.host).toBe("loja-a.exemplo.com");
  });
});
