// A implementação REAL de `ResolverLojaNaCaderneta` mora em `middleware.ts`
// (nunca em `src/hospedagem/porteiro.ts`, que só recebe a função injetada —
// ver o comentário lá). Rodada B (11/09/2026, brief T3b item 1): convenção
// de chamada nova — `apikey`/`Authorization` levam `IKCOUS_FROTA_APIKEY`
// (a chave PÚBLICA do projeto da PRINCIPAL), o segredo (`IKCOUS_FROTA_CHAVE`)
// viaja SÓ no corpo JSON como `p_chave`, por `POST`, NUNCA em cabeçalho nem
// em URL. Este arquivo testa `resolverNaCaderneta` isolado, com
// `globalThis.fetch` substituído (nunca rede de verdade) — os testes
// obrigatórios (i)-(iv) do brief.
import { afterEach, describe, expect, it, vi } from "vitest";

import { FalhaRpcCaderneta, resolverConexao } from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  ResolverLojaNaCaderneta,
} from "@/hospedagem/porteiro";
import middleware, { resolverNaCaderneta } from "../../middleware";

const SEGREDO = "segredo-de-32-bytes-nunca-deveria-viajar-em-header-ou-url";
const APIKEY_PRINCIPAL = "sb_publishable_da_principal";
const FROTA_URL = "https://principal.supabase.co";

function comFetch<T>(fetchFalso: typeof fetch, executar: () => Promise<T>) {
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchFalso;
  return executar().finally(() => {
    globalThis.fetch = anterior;
  });
}

describe("resolverNaCaderneta — convenção de chamada (teste obrigatório i)", () => {
  it("usa POST; o segredo NUNCA aparece na URL nem em nenhum cabeçalho — só no corpo", async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const fetchDuble: typeof fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      chamadas.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify([
          {
            supabase_url: "https://loja-a.supabase.co",
            publishable_key: "sb_publishable_da_loja_a",
            estado: "ativa",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );

    expect(resultado).toEqual({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
    });
    expect(chamadas).toHaveLength(1);
    const [chamada] = chamadas;
    expect(chamada.init.method).toBe("POST");
    expect(chamada.url).not.toContain(SEGREDO);
    expect(chamada.url).toContain("/rest/v1/rpc/resolver_loja");
    const cabecalhos = JSON.stringify(
      chamada.init.headers instanceof Headers
        ? Object.fromEntries(chamada.init.headers.entries())
        : chamada.init.headers,
    );
    expect(cabecalhos).not.toContain(SEGREDO);
    expect(cabecalhos).toContain(APIKEY_PRINCIPAL);
    expect(String(chamada.init.body)).toContain(SEGREDO);
    expect(String(chamada.init.body)).toContain('"p_chave"');
  });
});

describe("resolverNaCaderneta — classificação da resposta (testes obrigatórios ii/iii)", () => {
  afterEach(() => {
    // Defensivo: qualquer teste que falhe antes do `finally` de `comFetch`
    // não deixa `globalThis.fetch` substituído para o próximo arquivo.
  });

  it("zero linhas (200, array vazio) -> miss", async () => {
    const fetchDuble: typeof fetch = (async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-nova.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "miss" });
  });

  it("401 (apikey inválida ou RPC recusada) -> erro", async () => {
    const fetchDuble: typeof fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "erro" });
  });

  it("resposta com forma inesperada (linha sem supabase_url) -> erro", async () => {
    const fetchDuble: typeof fetch = (async () =>
      new Response(JSON.stringify([{ supabase_url: 42 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "erro" });
  });

  it("fetch lança (rede fora do ar) -> erro, nunca propaga a exceção", async () => {
    const fetchDuble: typeof fetch = (async () => {
      throw new Error("rede fora do ar");
    }) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "erro" });
  });
});

// ETAPA 3 (ADENDO A.3): unidade de `resolverConexao` — a decisão de NÃO
// cair no ambiente do projeto ("doProjeto()") quando a caderneta está
// CONFIGURADA e devolve miss/erro. O ambiente injetado abaixo tem as DUAS
// coisas ao mesmo tempo (variáveis da frota E do projeto) de propósito: se
// `resolverConexao` regredisse para o comportamento antigo, o teste
// receberia a conexão do projeto em vez de `null`.
describe("resolverConexao — com a caderneta CONFIGURADA, miss/erro NUNCA caem no ambiente do projeto (ADENDO A.3)", () => {
  const ambienteComOsDois: AmbientePorteiro = {
    VITE_SUPABASE_URL: "https://projeto-hospedeiro.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto_hospedeiro",
    IKCOUS_FROTA_URL: FROTA_URL,
    IKCOUS_FROTA_APIKEY: APIKEY_PRINCIPAL,
    IKCOUS_FROTA_CHAVE: SEGREDO,
  };

  it("miss -> { conexao: null, caderneta: 'miss' }", async () => {
    const cadernetaMiss: ResolverLojaNaCaderneta = async () => ({
      tipo: "miss",
    });
    const resultado = await resolverConexao(
      "host-desconhecido.exemplo",
      ambienteComOsDois,
      cadernetaMiss,
    );
    expect(resultado).toEqual({ conexao: null, caderneta: "miss" });
  });

  it("erro (RPC fora do ar) -> LANÇA FalhaRpcCaderneta com caderneta 'erro' (ADENDO B.1: nunca fecha a loja aqui — quem chama herda o stale-if-error)", async () => {
    const cadernetaErro: ResolverLojaNaCaderneta = async () => ({
      tipo: "erro",
    });
    const promessa = resolverConexao(
      "host-desconhecido.exemplo",
      ambienteComOsDois,
      cadernetaErro,
    );
    await expect(promessa).rejects.toBeInstanceOf(FalhaRpcCaderneta);
    await expect(promessa).rejects.toMatchObject({ caderneta: "erro" });
  });

  it("chave anômala (não-pública) devolvida pela caderneta -> tratada como 'erro', também null (SUPOSIÇÃO desta tarefa)", async () => {
    const cadernetaChaveSecreta: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-secreta.supabase.co",
        // Curta de propósito: o secretlint do pre-commit casa `sb_secret_` com
        // 16+ caracteres depois do prefixo, e a fixture só precisa do prefixo
        // para o porteiro classificá-la como NÃO pública.
        publishableKey: "sb_secret_curta",
        origem: "caderneta",
      },
    });
    const resultado = await resolverConexao(
      "loja-secreta.exemplo",
      ambienteComOsDois,
      cadernetaChaveSecreta,
    );
    expect(resultado).toEqual({ conexao: null, caderneta: "erro" });
  });

  it("hit -> devolve a conexão da caderneta, não a do projeto", async () => {
    const cadernetaHit: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
    });
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      ambienteComOsDois,
      cadernetaHit,
    );
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
      caderneta: "hit",
    });
  });

  it("caderneta AUSENTE (nenhuma das três variáveis) -> continua caindo no ambiente do projeto, inalterado", async () => {
    const resultado = await resolverConexao(
      "host-qualquer.exemplo",
      {
        VITE_SUPABASE_URL: "https://projeto-hospedeiro.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto_hospedeiro",
      },
      undefined,
    );
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://projeto-hospedeiro.supabase.co",
        publishableKey: "sb_publishable_do_projeto_hospedeiro",
        origem: "projeto",
      },
      caderneta: "ausente",
    });
  });
});

// RODADA DE CORREÇÃO 2 (achado 1 do revisor): o ramo de robô do
// `middleware.ts` (`isBot` + `/product-detail`, middleware.ts:181-190) chama
// `obterFichaValidada` — a MESMA trava que o documento usa — mas nenhum
// teste desta peça pinava esse caminho com a caderneta em MISS. Sem este
// teste, quem voltasse a resolver conexão por fora dali (por fora de
// `obterFichaValidada`) reabriria exatamente o vazamento que a rodada C já
// consertou: o robô servindo o catálogo de outra loja com 200 enquanto o
// navegador no MESMO host recebe 503. Testa através do `middleware()` REAL
// (import default de `middleware.ts`), com `globalThis.fetch` e
// `process.env` substituídos — nunca rede de verdade.
describe("middleware — robô em /product-detail com a caderneta CONFIGURADA em miss recebe o MESMO 503 sem-loja (achado 1, rodada 2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("host desconhecido da caderneta + user-agent de robô -> 503 sem-loja, x-ikcous-caderneta: miss, nunca 200/passthrough, corpo sem byte de loja nenhuma", async () => {
    vi.stubEnv("IKCOUS_FROTA_URL", FROTA_URL);
    vi.stubEnv("IKCOUS_FROTA_APIKEY", APIKEY_PRINCIPAL);
    vi.stubEnv("IKCOUS_FROTA_CHAVE", SEGREDO);

    const fetchDuble: typeof fetch = (async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/rpc/resolver_loja_com_estado") {
        // Zero linhas -> miss (o host não está cadastrado na caderneta).
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`URL não mapeada no dublê de teste: ${url.toString()}`);
    }) as typeof fetch;

    const resp = await comFetch(fetchDuble, () =>
      middleware(
        new Request(
          "https://loja-robo-desconhecida.exemplo/product-detail?id=9",
          { headers: { "user-agent": "WhatsApp/2.23" } },
        ),
      ),
    );

    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    // Nunca a resposta de robô (produto/sem-produto) nem passthrough: prova
    // que caiu na MESMA trava de manutenção do documento, não no ramo que
    // consultaria o banco por fora dela.
    expect(resp.headers.get("x-ikcous-og")).toBeNull();
    expect(resp.headers.get("x-middleware-next")).toBeNull();
    const corpo = await resp.text();
    expect(corpo).toContain("manutenção");
    expect(corpo).not.toContain("supabase.co");
    expect(corpo).not.toContain("sb_publishable");
  });
});

// L8 (26/11/2026, lote 2, tarefa 2.1) — a caderneta passa a ser perguntada
// pela `resolver_loja_com_estado` (7 colunas: as 6 da v1 + `estado`; URL e
// chave NULL quando a loja não está `ativa`). A RESERVA para a função antiga
// é ESTREITA: só um 404 com `code: "PGRST202"` (a função ainda não existe no
// banco da caderneta) repete a pergunta em `resolver_loja` e marca a resposta
// com `versao: 1`. Qualquer outro erro (500, 401, 404 sem esse código, corpo
// que não é JSON) NUNCA cai na reserva: vira `erro`, como sempre foi.
describe("resolverNaCaderneta — resolver_loja_com_estado e a reserva estreita (L8, 2.1)", () => {
  const REF = "abcdefghijklmnopqrst";

  type Chamada = { pathname: string; corpo: string; cabecalhos: string };

  /** Responde cada RPC pela lista `respostas`, em ordem, e grava o que foi
   * pedido. Mais pedidos do que respostas = falha de teste (lança). */
  function dubleEmSequencia(respostas: Array<() => Response>) {
    const chamadas: Chamada[] = [];
    const fetchDuble: typeof fetch = (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      chamadas.push({
        pathname: url.pathname,
        corpo: String(init?.body ?? ""),
        cabecalhos: JSON.stringify(init?.headers ?? {}),
      });
      const proxima = respostas[chamadas.length - 1];
      if (!proxima) throw new Error(`pedido a mais: ${url.toString()}`);
      return proxima();
    }) as typeof fetch;
    return { chamadas, fetchDuble };
  }

  const json =
    (corpo: unknown, status = 200) =>
    () =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json" },
      });

  const resolver = (fetchDuble: typeof fetch) =>
    comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );

  const linhaAtiva = {
    id: "loja-a",
    nome: "Loja A",
    dominio_publico: "loja-a.exemplo",
    project_ref: REF,
    supabase_url: "https://loja-a.supabase.co",
    publishable_key: "sb_publishable_da_loja_a",
    estado: "ativa",
  };

  it("pergunta PRIMEIRO à resolver_loja_com_estado (POST, segredo só no corpo) e a loja ativa vira hit SEM marca de versão", async () => {
    const { chamadas, fetchDuble } = dubleEmSequencia([json([linhaAtiva])]);
    const resultado = await resolver(fetchDuble);
    expect(resultado).toStrictEqual({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
    });
    expect(chamadas.map((c) => c.pathname)).toEqual([
      "/rest/v1/rpc/resolver_loja_com_estado",
    ]);
    expect(chamadas[0].corpo).toContain(SEGREDO);
    expect(chamadas[0].cabecalhos).not.toContain(SEGREDO);
  });

  it("ativa sem URL ou sem chave -> erro (a loja ativa EXIGE as duas)", async () => {
    for (const falta of ["supabase_url", "publishable_key"] as const) {
      const linha = { ...linhaAtiva, [falta]: null };
      const { fetchDuble } = dubleEmSequencia([json([linha])]);
      expect(await resolver(fetchDuble)).toEqual({ tipo: "erro" });
    }
  });

  it.each(["adormecida", "encerrada"] as const)(
    "%s -> fora-do-ar com estado, ref e nome (URL e chave NULL, nunca usadas)",
    async (estado) => {
      const linha = {
        ...linhaAtiva,
        nome: "Loja Bela",
        supabase_url: null,
        publishable_key: null,
        estado,
      };
      const { chamadas, fetchDuble } = dubleEmSequencia([json([linha])]);
      expect(await resolver(fetchDuble)).toStrictEqual({
        tipo: "fora-do-ar",
        estado,
        ref: REF,
        nome: "Loja Bela",
      });
      expect(chamadas).toHaveLength(1);
    },
  );

  it.each([
    ["estado desconhecido", { estado: "pausada" }],
    ["estado ausente (resposta com cara da v1)", { estado: undefined }],
    ["estado não-texto", { estado: 1 }],
    ["estado com caixa diferente", { estado: "Adormecida" }],
    ["adormecida com ref curta", { estado: "adormecida", project_ref: "abc" }],
    [
      "adormecida com ref de 20 maiúsculas",
      { estado: "adormecida", project_ref: "ABCDEFGHIJKLMNOPQRST" },
    ],
    [
      "encerrada com ref que tenta injetar cabeçalho",
      { estado: "encerrada", project_ref: "abcdefghij\r\nx-a: b1" },
    ],
    ["adormecida sem nome", { estado: "adormecida", nome: null }],
  ])("%s -> erro", async (_nome, extra) => {
    const { fetchDuble } = dubleEmSequencia([
      json([{ ...linhaAtiva, ...extra }]),
    ]);
    expect(await resolver(fetchDuble)).toEqual({ tipo: "erro" });
  });

  it("linha nula ou duas linhas -> erro; zero linhas -> miss (sem reserva)", async () => {
    let duble = dubleEmSequencia([json([null])]);
    expect(await resolver(duble.fetchDuble)).toEqual({ tipo: "erro" });
    duble = dubleEmSequencia([json([linhaAtiva, linhaAtiva])]);
    expect(await resolver(duble.fetchDuble)).toEqual({ tipo: "erro" });
    duble = dubleEmSequencia([json([])]);
    expect(await resolver(duble.fetchDuble)).toStrictEqual({ tipo: "miss" });
    expect(duble.chamadas).toHaveLength(1);
  });

  it("404 PGRST202 (função nova ainda não aplicada) -> repete em resolver_loja, com o MESMO corpo, e marca versao 1", async () => {
    const { chamadas, fetchDuble } = dubleEmSequencia([
      json({ code: "PGRST202", message: "Could not find the function" }, 404),
      json([
        {
          supabase_url: "https://loja-a.supabase.co",
          publishable_key: "sb_publishable_da_loja_a",
        },
      ]),
    ]);
    expect(await resolver(fetchDuble)).toStrictEqual({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
      versao: 1,
    });
    expect(chamadas.map((c) => c.pathname)).toEqual([
      "/rest/v1/rpc/resolver_loja_com_estado",
      "/rest/v1/rpc/resolver_loja",
    ]);
    expect(chamadas[1].corpo).toBe(chamadas[0].corpo);
    expect(chamadas[1].cabecalhos).not.toContain(SEGREDO);
  });

  it("reserva: v1 com zero linhas -> miss com versao 1; v1 que falha -> erro com versao 1", async () => {
    let duble = dubleEmSequencia([json({ code: "PGRST202" }, 404), json([])]);
    expect(await resolver(duble.fetchDuble)).toStrictEqual({
      tipo: "miss",
      versao: 1,
    });
    duble = dubleEmSequencia([
      json({ code: "PGRST202" }, 404),
      json({ erro: "x" }, 500),
    ]);
    expect(await resolver(duble.fetchDuble)).toStrictEqual({
      tipo: "erro",
      versao: 1,
    });
  });

  it.each([
    ["500 com code PGRST202", json({ code: "PGRST202" }, 500)],
    ["404 com outro código", json({ code: "PGRST116" }, 404)],
    ["404 sem código", json({ message: "not found" }, 404)],
    [
      "404 com corpo que não é JSON",
      () => new Response("<html>", { status: 404 }),
    ],
    ["404 com code dentro de uma lista", json([{ code: "PGRST202" }], 404)],
    ["401 com code PGRST202", json({ code: "PGRST202" }, 401)],
    ["400 com code PGRST202", json({ code: "PGRST202" }, 400)],
  ])(
    "%s -> erro, SEM cair na reserva (um pedido só)",
    async (_nome, resposta) => {
      const { chamadas, fetchDuble } = dubleEmSequencia([resposta]);
      expect(await resolver(fetchDuble)).toStrictEqual({ tipo: "erro" });
      expect(chamadas).toHaveLength(1);
    },
  );

  it("middleware: documento servido pela reserva leva x-ikcous-caderneta-versao: 1; pela função nova, não leva", async () => {
    vi.stubEnv("IKCOUS_FROTA_URL", FROTA_URL);
    vi.stubEnv("IKCOUS_FROTA_APIKEY", APIKEY_PRINCIPAL);
    vi.stubEnv("IKCOUS_FROTA_CHAVE", SEGREDO);
    const origem = `https://${"projetoreserva".padEnd(20, "a")}.supabase.co`;
    const fetchDaLoja = (v2: "falta" | "existe"): typeof fetch =>
      (async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname === "/rest/v1/rpc/resolver_loja_com_estado")
          return v2 === "falta"
            ? json({ code: "PGRST202" }, 404)()
            : json([
                {
                  supabase_url: origem,
                  publishable_key: "sb_publishable_reserva",
                  estado: "ativa",
                },
              ])();
        if (url.pathname === "/rest/v1/rpc/resolver_loja")
          return json([
            { supabase_url: origem, publishable_key: "sb_publishable_reserva" },
          ])();
        if (url.pathname === "/index.html")
          return new Response(
            "<!DOCTYPE html><html><head></head><body></body></html>",
            { status: 200 },
          );
        if (url.pathname === "/rest/v1/v_store_config") {
          if (url.searchParams.get("select")?.startsWith("dominio_publico"))
            return json([
              {
                dominio_publico: "loja-reserva.exemplo",
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: false,
              },
            ])();
          return json([identidadeDaReserva(origem)])();
        }
        if (url.pathname === "/rest/v1/banners") return json([])();
        throw new Error(`URL não mapeada: ${url.toString()}`);
      }) as typeof fetch;

    try {
      const pelaReserva = await comFetch(fetchDaLoja("falta"), () =>
        middleware(new Request("https://loja-reserva.exemplo/")),
      );
      expect(pelaReserva.status).toBe(200);
      expect(pelaReserva.headers.get("x-ikcous-porteiro")).toBe("ok");
      expect(pelaReserva.headers.get("x-ikcous-caderneta")).toBe("hit");
      expect(pelaReserva.headers.get("x-ikcous-caderneta-versao")).toBe("1");

      // Outro host (o cache do porteiro é por host, e este não pode vir do
      // cache aquecido acima). O banco discorda dele (503), mas o que se
      // confere aqui é só a AUSÊNCIA da marca: a função nova respondeu.
      const pelaNova = await comFetch(fetchDaLoja("existe"), () =>
        middleware(new Request("https://loja-reserva-nova.exemplo/")),
      );
      expect(pelaNova.headers.get("x-ikcous-caderneta")).toBe("hit");
      expect(pelaNova.headers.get("x-ikcous-caderneta-versao")).toBeNull();

      // E a recusa (503) servida pela reserva também carrega a marca.
      const recusaPelaReserva = await comFetch(fetchDaLoja("falta"), () =>
        middleware(new Request("https://loja-reserva-recusa.exemplo/")),
      );
      expect(recusaPelaReserva.status).toBe(503);
      expect(recusaPelaReserva.headers.get("x-ikcous-caderneta-versao")).toBe(
        "1",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/** Linha crua de `v_store_config` (identidade), no formato que
 * `parseStoreIdentity` aceita — molde de `porteiro-fluxo.test.ts`. */
function identidadeDaReserva(origem: string) {
  const hash = "c".repeat(64);
  const asset = (arquivo: string, largura: number, altura: number) => ({
    path: `v1/${hash}/${arquivo}.png`,
    sha256: hash,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  });
  const header = asset("header", 64, 64);
  return {
    store_name: "Loja Reserva",
    store_city: null,
    store_state: null,
    logo_url: `${origem}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#123456",
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: asset("loader", 64, 64),
      favicon: asset("favicon", 32, 32),
      apple_touch: asset("apple", 180, 180),
      icon_192: asset("icon192", 192, 192),
      icon_512: asset("icon512", 512, 512),
      maskable_512: asset("maskable", 512, 512),
      og: asset("og", 1200, 630),
    },
  };
}
