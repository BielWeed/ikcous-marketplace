// O LEITOR da reserva da caderneta (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`,
// T6): o pedaço que o `middleware.ts` injeta no porteiro como `lerReserva`. O
// pacote `@vercel/global-config` é um dublê (`vi.mock`) — nunca rede de verdade.
// O que dói aqui:
//   - conexão fora dos dois hosts da Vercel vira "reserva desligada" ANTES de
//     criar o cliente (o parser do pacote aceita qualquer host com id+token);
//   - leitura pendurada não pode segurar o host (`resolucoesEmVoo` do porteiro):
//     prazo de 2 s próprio, porque o pacote não aceita `AbortSignal`;
//   - a cota da store (100 mil leituras/mês no Hobby): cache de 5 min, falha
//     guardada 30 s, leituras simultâneas viram uma;
//   - o token da conexão nunca sai em erro nem em log.
// Tokens, ids, domínios e refs são INVENTADOS (repositório público).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, get } = vi.hoisted(() => {
  const get = vi.fn<(chave: string) => Promise<unknown>>();
  const createClient = vi.fn((_conexao: string, _opcoes?: unknown) => ({
    get,
  }));
  return { createClient, get };
});
vi.mock("@vercel/global-config", () => ({ createClient }));

import {
  CACHE_RESERVA_BOA_MS,
  CACHE_RESERVA_FALHA_MS,
  PRAZO_RESERVA_MS,
  conexaoDaReservaAceita,
  criarLeitorDaReserva,
  leitorDaReservaDoAmbiente,
} from "@/hospedagem/leitorDaReserva";
import {
  CACHE_FRESCO_MS,
  SELECT_CONFIGURACAO_PUBLICA,
} from "@/hospedagem/porteiro";
import { CHAVE_DA_RESERVA } from "@/hospedagem/reservaDaCaderneta";
import middleware from "../../middleware";

// Montado por partes para nenhum detector de segredo confundir o fixture.
const TOKEN = ["tok", "inventado", "SEGREDO", "9f8e7d"].join("_");
let sequencia = 0;
/** Uma conexão NOVA por teste: o leitor do ambiente é guardado por instância
 * (por conexão), e o estado de um teste não pode vazar para o outro. */
function conexaoNova(host = "global-config.vercel.com"): string {
  sequencia += 1;
  return `https://${host}/ecfg_inventada${sequencia}?token=${TOKEN}`;
}

const REF_A = "leitoraleitoraleitor"; // 20 letras, inventado
const ORIGEM_A = `https://${REF_A}.supabase.co`;
const K_A = "sb_publishable_inventada_do_leitor_a";

function documento(hosts: Record<string, unknown>) {
  return {
    v: 1,
    gerada_em: "2026-11-26T12:00:00.000Z",
    sha: "0123456789abcdef0123456789abcdef01234567",
    hosts,
  };
}
const RESERVA = documento({ "loja-leitor.exemplo": { u: ORIGEM_A, k: K_A } });

beforeEach(() => {
  createClient.mockReset();
  createClient.mockImplementation(() => ({ get }));
  get.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function silenciarLog() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
  };
}

/** O leitor ligado (falha o teste se vier desligado). */
function leitor(conexao = conexaoNova()) {
  const ler = criarLeitorDaReserva(conexao);
  if (!ler) throw new Error("o leitor deveria estar ligado");
  return ler;
}

async function motivoDaRecusa(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro) {
    return erro;
  }
  throw new Error("deveria ter rejeitado");
}

// ═══ ligar e desligar ═══════════════════════════════════════════════════════

describe("leitor da reserva — quando ele existe", () => {
  it("sem variável: o leitor NÃO é injetado (reserva desligada) e nenhum cliente nasce", () => {
    expect(leitorDaReservaDoAmbiente({})).toBeUndefined();
    expect(
      leitorDaReservaDoAmbiente({ GLOBAL_CONFIG: "", EDGE_CONFIG: "" }),
    ).toBeUndefined();
    expect(criarLeitorDaReserva(undefined)).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  for (const estranha of [
    `https://global-config.vercel.com.atacante.exemplo/ecfg_x?token=${TOKEN}`,
    `https://atacante.exemplo/ecfg_x?token=${TOKEN}`,
    `http://edge-config.vercel.com/ecfg_x?token=${TOKEN}`,
    `https://edge-config.vercel.com:8443/ecfg_x?token=${TOKEN}`,
    // Usuário e senha na URL, montados por partes (o secretlint lê o fixture).
    `https://${["usuario", "senha"].join(":")}@edge-config.vercel.com/ecfg_x?token=${TOKEN}`,
    `https://edge-config.vercel.com/outra_coisa?token=${TOKEN}`,
    `https://edge-config.vercel.com/ecfg_x/item/y?token=${TOKEN}`,
    "https://edge-config.vercel.com/ecfg_x",
    "https://edge-config.vercel.com/ecfg_x?token=",
    "edge-config:id=ecfg_x",
    `edge-config:token=${TOKEN}`,
    `https://atacante.exemplo/?id=ecfg_x&token=${TOKEN}`,
    "isto nao e conexao",
  ]) {
    it(`host/forma estranha: desligada, createClient NÃO é chamado (${estranha.replace(TOKEN, "<token>")})`, () => {
      expect(conexaoDaReservaAceita(estranha)).toBe(false);
      expect(criarLeitorDaReserva(estranha)).toBeUndefined();
      expect(leitorDaReservaDoAmbiente({ GLOBAL_CONFIG: estranha })).toBe(
        undefined,
      );
      expect(createClient).not.toHaveBeenCalled();
    });
  }

  for (const boa of [
    `https://global-config.vercel.com/ecfg_inventada?token=${TOKEN}`,
    `https://edge-config.vercel.com/ecfg_inventada?token=${TOKEN}`,
    `edge-config:id=ecfg_inventada&token=${TOKEN}`,
  ]) {
    it(`forma da Vercel aceita (${boa.replace(TOKEN, "<token>")})`, () => {
      expect(conexaoDaReservaAceita(boa)).toBe(true);
      expect(criarLeitorDaReserva(boa)).toBeTypeOf("function");
    });
  }

  it("o cliente nasce com staleIfError: false (a cópia velha da store não manda)", () => {
    const conexao = conexaoNova();
    leitor(conexao);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      conexao,
      expect.objectContaining({ staleIfError: false }),
    );
  });

  it("GLOBAL_CONFIG vence EDGE_CONFIG; EDGE_CONFIG sozinha também liga", () => {
    const global = conexaoNova();
    const edge = conexaoNova("edge-config.vercel.com");
    leitorDaReservaDoAmbiente({ GLOBAL_CONFIG: global, EDGE_CONFIG: edge });
    expect(createClient).toHaveBeenLastCalledWith(global, expect.anything());
    const soEdge = conexaoNova("edge-config.vercel.com");
    expect(leitorDaReservaDoAmbiente({ EDGE_CONFIG: soEdge })).toBeTypeOf(
      "function",
    );
    expect(createClient).toHaveBeenLastCalledWith(soEdge, expect.anything());
  });

  it("GLOBAL_CONFIG estranha NÃO cai para a EDGE_CONFIG: desligada (configuração errada não se esconde)", () => {
    expect(
      leitorDaReservaDoAmbiente({
        GLOBAL_CONFIG: `https://atacante.exemplo/ecfg_x?token=${TOKEN}`,
        EDGE_CONFIG: conexaoNova("edge-config.vercel.com"),
      }),
    ).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("um cliente por instância: o mesmo ambiente devolve o MESMO leitor", () => {
    const ambiente = { GLOBAL_CONFIG: conexaoNova() };
    const primeiro = leitorDaReservaDoAmbiente(ambiente);
    const segundo = leitorDaReservaDoAmbiente(ambiente);
    expect(primeiro).toBeTypeOf("function");
    expect(segundo).toBe(primeiro);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("createClient que lança: desligada, sem o token na mensagem", () => {
    const log = silenciarLog();
    createClient.mockImplementation(() => {
      throw new Error(`conexao ruim ${TOKEN}`);
    });
    expect(criarLeitorDaReserva(conexaoNova())).toBeUndefined();
    for (const espiao of Object.values(log))
      expect(JSON.stringify(espiao.mock.calls)).not.toContain(TOKEN);
  });
});

// ═══ a leitura ══════════════════════════════════════════════════════════════

describe("leitor da reserva — a leitura", () => {
  it("lê a chave da reserva e devolve o documento CONFERIDO", async () => {
    get.mockResolvedValue({
      ...RESERVA,
      hosts: { ...RESERVA.hosts, "HOST-ERRADO": { u: ORIGEM_A, k: K_A } },
    });
    silenciarLog();
    const reserva = await leitor()();
    expect(get).toHaveBeenCalledWith(CHAVE_DA_RESERVA);
    expect(reserva).toEqual(RESERVA);
  });

  it("leitura boa fica 5 min em cache: UMA chamada dentro da janela", async () => {
    vi.useFakeTimers();
    get.mockResolvedValue(RESERVA);
    const ler = leitor();
    await ler();
    await vi.advanceTimersByTimeAsync(CACHE_RESERVA_BOA_MS - 1);
    expect(await ler()).toEqual(RESERVA);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await ler();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("falha fica 30 s em cache: rejeita sem ler de novo, e lê depois", async () => {
    silenciarLog();
    vi.useFakeTimers();
    get.mockRejectedValueOnce(new Error("store fora do ar"));
    const ler = leitor();
    await motivoDaRecusa(ler());
    await vi.advanceTimersByTimeAsync(CACHE_RESERVA_FALHA_MS - 1);
    await motivoDaRecusa(ler());
    expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValue(RESERVA);
    await vi.advanceTimersByTimeAsync(2);
    expect(await ler()).toEqual(RESERVA);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("get que nunca resolve: rejeita aos 2 s (e não antes)", async () => {
    silenciarLog();
    vi.useFakeTimers();
    get.mockReturnValue(new Promise(() => {}));
    let terminou = false;
    const leitura = leitor()().finally(() => {
      terminou = true;
    });
    const recusa = motivoDaRecusa(leitura);
    await vi.advanceTimersByTimeAsync(PRAZO_RESERVA_MS - 1);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await recusa).toBeInstanceOf(Error);
    expect(terminou).toBe(true);
  });

  it("o get perdedor que rejeita DEPOIS do prazo não vira unhandledrejection", async () => {
    silenciarLog();
    vi.useFakeTimers();
    const soltas: unknown[] = [];
    const ouvinte = (motivo: unknown) => soltas.push(motivo);
    process.on("unhandledRejection", ouvinte);
    try {
      get.mockImplementation(
        () =>
          new Promise((_resolve, rejeitar) =>
            setTimeout(() => rejeitar(new Error("tarde demais")), 5_000),
          ),
      );
      const recusa = motivoDaRecusa(leitor()());
      await vi.advanceTimersByTimeAsync(PRAZO_RESERVA_MS);
      await recusa;
      await vi.advanceTimersByTimeAsync(5_000);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));
      expect(soltas).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvinte);
    }
  });

  it("5 leituras simultâneas viram UMA", async () => {
    vi.useFakeTimers();
    get.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(RESERVA), 100)),
    );
    const ler = leitor();
    const leituras = Promise.all(Array.from({ length: 5 }, () => ler()));
    await vi.advanceTimersByTimeAsync(100);
    for (const r of await leituras) expect(r).toEqual(RESERVA);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("5 leituras simultâneas que FALHAM também viram uma (e todas rejeitam)", async () => {
    silenciarLog();
    vi.useFakeTimers();
    get.mockReturnValue(new Promise(() => {}));
    const ler = leitor();
    const recusas = Array.from({ length: 5 }, () => motivoDaRecusa(ler()));
    await vi.advanceTimersByTimeAsync(PRAZO_RESERVA_MS);
    for (const r of await Promise.all(recusas)) expect(r).toBeInstanceOf(Error);
    expect(get).toHaveBeenCalledTimes(1);
  });

  for (const [nome, valor] of [
    ["documento inválido (v: 2)", { ...RESERVA, v: 2 }],
    ["chave ausente (undefined)", undefined],
    ["null", null],
    ["texto", "reserva"],
  ] as const) {
    it(`${nome} conta como FALHA: rejeita e fica 30 s guardado`, async () => {
      silenciarLog();
      vi.useFakeTimers();
      get.mockResolvedValue(valor);
      const ler = leitor();
      expect(await motivoDaRecusa(ler())).toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(CACHE_RESERVA_FALHA_MS - 1);
      expect(await motivoDaRecusa(ler())).toBeInstanceOf(Error);
      expect(get).toHaveBeenCalledTimes(1);
    });
  }

  it("get que lança SÍNCRONO também é falha (nunca escapa do leitor)", async () => {
    silenciarLog();
    get.mockImplementation(() => {
      throw new Error("sincrono");
    });
    expect(await motivoDaRecusa(leitor()())).toBeInstanceOf(Error);
  });

  it("o token NÃO aparece em erro nenhum, nem no log", async () => {
    const log = silenciarLog();
    vi.useFakeTimers();
    const erros: unknown[] = [];
    // Exceção do pacote que (hipoteticamente) carrega o token.
    get.mockRejectedValueOnce(
      new Error(`falhou em https://x/ecfg_y?token=${TOKEN}`, {
        cause: TOKEN,
      }),
    );
    const ler1 = leitor();
    erros.push(await motivoDaRecusa(ler1()));
    // A mesma falha, servida do cache de 30 s.
    erros.push(await motivoDaRecusa(ler1()));
    // Prazo.
    get.mockReturnValueOnce(new Promise(() => {}));
    const recusaDoPrazo = motivoDaRecusa(leitor()());
    await vi.advanceTimersByTimeAsync(PRAZO_RESERVA_MS);
    erros.push(await recusaDoPrazo);
    // Documento inválido e chave ausente.
    get.mockResolvedValueOnce({ v: 9, token: TOKEN });
    erros.push(await motivoDaRecusa(leitor()()));
    get.mockResolvedValueOnce(undefined);
    erros.push(await motivoDaRecusa(leitor()()));

    expect(erros).toHaveLength(5);
    for (const erro of erros) {
      expect(erro).toBeInstanceOf(Error);
      const e = erro as Error;
      expect(e.message).not.toContain(TOKEN);
      expect(String(e.stack)).not.toContain(TOKEN);
      expect(String(e.cause ?? "")).not.toContain(TOKEN);
      expect(JSON.stringify(e)).not.toContain(TOKEN);
    }
    for (const espiao of Object.values(log))
      expect(JSON.stringify(espiao.mock.calls)).not.toContain(TOKEN);
    // E o log fala da falha (o recuo não é silencioso).
    expect(log.warn).toHaveBeenCalled();
  });
});

// ═══ ligado no middleware real ══════════════════════════════════════════════

const HASH = "a".repeat(64);
function asset(nome: string, largura: number, altura: number) {
  return {
    path: `v1/${HASH}/${nome}.png`,
    sha256: HASH,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  };
}
function linhaDaLoja(nome: string, origem: string) {
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origem}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#123456",
    secondary_color: "#654321",
    accent_color: "#abcdef",
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

const AMBIENTE_DA_FROTA = {
  IKCOUS_FROTA_URL: "https://principalprincipalpri.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal_inventada",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste-inventado",
  VERCEL_ENV: "production",
  VITE_SUPABASE_URL: undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
  VITE_SUPABASE_ANON_KEY: undefined,
  IKCOUS_DOMINIO_PRINCIPAL: undefined,
  GLOBAL_CONFIG: undefined,
  EDGE_CONFIG: undefined,
};

/** O `fetch` global do middleware: a caderneta FALHA (503) ou diz `miss`, e o
 * banco de cada loja responde. Nunca rede de verdade. */
function redeComCaderneta(
  caderneta: "503" | "miss",
  lojas: Record<string, { nome: string; dominio: string }>,
) {
  const leiturasDosBancos: string[] = [];
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.startsWith("/rest/v1/rpc/resolver_loja"))
      return caderneta === "503"
        ? new Response("indisponivel", { status: 503 })
        : Response.json([]);
    if (url.pathname === "/index.html")
      return new Response(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    const loja = lojas[url.origin];
    if (loja && url.pathname === "/rest/v1/v_store_config") {
      leiturasDosBancos.push(url.origin);
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
        return Response.json([
          {
            dominio_publico: loja.dominio,
            mp_public_key: null,
            vapid_public_key: null,
            pagamento_online: false,
            manutencao: false,
          },
        ]);
      return Response.json([linhaDaLoja(loja.nome, url.origin)]);
    }
    if (loja && url.pathname === "/rest/v1/banners") return Response.json([]);
    if (loja && url.pathname === "/rest/v1/rpc/contar_entrada")
      return new Response(null, { status: 204 });
    throw new Error(`rede proibida no teste: ${url.toString()}`);
  }) as typeof fetch);
  return { leiturasDosBancos };
}

function ambiente(extra: Record<string, string | undefined>) {
  for (const [chave, valor] of Object.entries({
    ...AMBIENTE_DA_FROTA,
    ...extra,
  }))
    vi.stubEnv(chave, valor);
}

function navegador(host: string) {
  return new Request(`https://${host}/`, {
    headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
  });
}

describe("middleware real com o leitor ligado", () => {
  it("variável ligada e caderneta falhando: a loja abre com x-ikcous-caderneta reserva", async () => {
    silenciarLog();
    const host = "loja-mw-reserva.exemplo";
    const ref = "middlewaremiddleware";
    const origem = `https://${ref}.supabase.co`;
    ambiente({ GLOBAL_CONFIG: conexaoNova() });
    get.mockResolvedValue(
      documento({ [host]: { u: origem, k: "sb_publishable_inventada_mw" } }),
    );
    const rede = redeComCaderneta("503", {
      [origem]: { nome: "Loja do Middleware Inventada", dominio: host },
    });
    const resp = await middleware(navegador(host));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(await resp.text()).toContain("Loja do Middleware Inventada");
    expect(get).toHaveBeenCalledWith(CHAVE_DA_RESERVA);
    expect(rede.leiturasDosBancos).toContain(origem);
  });

  it("o ramo de robô (/product-detail) usa o MESMO leitor", async () => {
    silenciarLog();
    const host = "loja-mw-robo.exemplo";
    const origem = "https://middlewareroboroboro.supabase.co";
    ambiente({ GLOBAL_CONFIG: conexaoNova() });
    get.mockResolvedValue(
      documento({ [host]: { u: origem, k: "sb_publishable_inventada_robo" } }),
    );
    redeComCaderneta("503", {
      [origem]: { nome: "Loja do Robo Inventada", dominio: host },
    });
    const resp = await middleware(
      new Request(`https://${host}/product-detail`, {
        headers: { "user-agent": "WhatsApp/2.23.20.0 A" },
      }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("x-ikcous-reserva: ligada com a variável, desligada sem ela (host desconhecido, miss)", async () => {
    silenciarLog();
    get.mockResolvedValue(documento({}));
    redeComCaderneta("miss", {});
    ambiente({ GLOBAL_CONFIG: conexaoNova() });
    const ligada = await middleware(navegador("ninguem-mw-1.exemplo"));
    expect(ligada.status).toBe(503);
    expect(ligada.headers.get("x-ikcous-reserva")).toBe("ligada");

    ambiente({});
    const desligada = await middleware(navegador("ninguem-mw-2.exemplo"));
    expect(desligada.status).toBe(503);
    expect(desligada.headers.get("x-ikcous-reserva")).toBe("desligada");

    ambiente({
      GLOBAL_CONFIG: `https://atacante.exemplo/ecfg_x?token=${TOKEN}`,
    });
    const estranha = await middleware(navegador("ninguem-mw-3.exemplo"));
    expect(estranha.headers.get("x-ikcous-reserva")).toBe("desligada");
  });

  it("a caderneta VOLTA: passada a janela fresca, o middleware usa o hit e não lê a reserva de novo", async () => {
    silenciarLog();
    vi.useFakeTimers({ toFake: ["Date"] });
    const host = "loja-mw-volta.exemplo";
    const origemReserva = "https://middlewarereservavel.supabase.co";
    const origemNova = "https://middlewarecadernetan.supabase.co";
    ambiente({ GLOBAL_CONFIG: conexaoNova() });
    get.mockResolvedValue(
      documento({
        [host]: { u: origemReserva, k: "sb_publishable_inventada_velha" },
      }),
    );
    const lojas: Record<string, { nome: string; dominio: string }> = {
      [origemReserva]: { nome: "Banco Velho Inventado", dominio: host },
      [origemNova]: { nome: "Banco Novo Inventado", dominio: host },
    };
    redeComCaderneta("503", lojas);
    const pelaReserva = await middleware(navegador(host));
    expect(pelaReserva.headers.get("x-ikcous-caderneta")).toBe("reserva");

    // A caderneta volta, apontando o MESMO host para outro banco válido.
    const leiturasAntes = get.mock.calls.length;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/rpc/resolver_loja_com_estado")
        return Response.json([
          {
            supabase_url: origemNova,
            publishable_key: "sb_publishable_inventada_nova",
            project_ref: "middlewarecadernetan",
            nome: "Banco Novo Inventado",
            estado: "ativa",
          },
        ]);
      if (url.pathname === "/index.html")
        return new Response(
          "<!DOCTYPE html><html><head></head><body></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      const loja = lojas[url.origin];
      if (loja && url.pathname === "/rest/v1/v_store_config")
        return url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA
          ? Response.json([
              {
                dominio_publico: loja.dominio,
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: false,
              },
            ])
          : Response.json([linhaDaLoja(loja.nome, url.origin)]);
      if (loja && url.pathname === "/rest/v1/banners") return Response.json([]);
      throw new Error(`rede proibida no teste: ${url.toString()}`);
    }) as typeof fetch);
    vi.advanceTimersByTime(CACHE_FRESCO_MS + 1);

    // Sem `context`: a visita espera a caderneta na hora.
    const deVolta = await middleware(navegador(host));
    expect(deVolta.status).toBe(200);
    expect(deVolta.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(await deVolta.text()).toContain("Banco Novo Inventado");
    expect(get.mock.calls.length).toBe(leiturasAntes);
  });
});
