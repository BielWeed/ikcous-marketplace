// A RESERVA DA CADERNETA no porteiro (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`,
// T3 e T4). Quando a caderneta central FALHA (rede, prazo, HTTP fora de 2xx,
// corpo 2xx malformado) ou diz "não achei" para um host que a reserva conhece,
// e o host NÃO tem ficha de menos de 1 h, o porteiro abre a loja pela conexão
// da reserva — e essa conexão passa pela MESMA conferência de domínio no banco
// da própria loja (`decidirConcordancia`). É daqui que nasceria "loja A com
// dado de loja B" se a reserva pulasse a trava; por isso o teste do host
// trocado é o centro deste arquivo.
//
// A caderneta é a REAL (`resolverNaCaderneta` de `middleware.ts`, com o
// `fetch` global trocado por um dublê): os cinco modos de falha são os que a
// borda de verdade produz, não um `{tipo: "erro"}` escrito à mão. O banco de
// cada loja é outro dublê (`fetchImpl`). Nunca rede de verdade. Domínios, refs
// e chaves são INVENTADOS (repositório público).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_FRESCO_MS,
  CACHE_SEM_LOJA_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
  EntradaCacheSemLoja,
  ResolucaoEmVoo,
  ResolverLojaNaCaderneta,
} from "@/hospedagem/porteiro";
import { resolverNaCaderneta } from "../../middleware";

const REF_A = "lojaalojaalojaalojaa"; // 20 letras, inventado
const REF_B = "lojablojablojablojab"; // 20 letras, inventado
const ORIGEM_A = `https://${REF_A}.supabase.co`;
const ORIGEM_B = `https://${REF_B}.supabase.co`;
// O banco NOVO da loja A (a caderneta, de volta, aponta A para ele).
const REF_A_NOVO = "lojanovalojanovaloja"; // 20 letras, inventado
const ORIGEM_A_NOVO = `https://${REF_A_NOVO}.supabase.co`;
const K_A_NOVO = "sb_publishable_inventada_da_loja_a_nova";
const K_A = "sb_publishable_inventada_da_loja_a";
const K_B = "sb_publishable_inventada_da_loja_b";
// Montada por partes para nenhum detector de segredo confundir o fixture.
const CHAVE_SECRETA_INVENTADA = ["sb", "secret", "inventada"].join("_");
const HOST_A = "loja-a.exemplo";
const HOST_B = "loja-b.exemplo";
const ALIAS_A = "loja-a-inventada.vercel.app";
const HOST_DESCONHECIDO = "ninguem.exemplo";

const AMBIENTE: AmbientePorteiro = {
  IKCOUS_FROTA_URL: "https://principalprincipalpri.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal_inventada",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste-inventado",
  VERCEL_ENV: "production",
};

// ─── o banco de cada loja (dublê de `fetchImpl`) ───────────────────────────

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

interface BancoFake {
  readonly nome: string;
  readonly dominioPublico: string | null;
}

const BANCO_B: BancoFake = {
  nome: "Loja Beta Inventada",
  dominioPublico: HOST_B,
};
const BANCOS: Record<string, BancoFake> = {
  [ORIGEM_A]: { nome: "Loja Alfa Inventada", dominioPublico: HOST_A },
  [ORIGEM_B]: BANCO_B,
};

/** O banco de cada loja, contando quantas vezes cada origem foi lida. */
function bancosDasLojas(bancos: Record<string, BancoFake> = BANCOS) {
  const leituras: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/index.html")
      return new Response(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/rest/v1/v_store_config") {
      leituras.push(url.origin);
      const banco = bancos[url.origin];
      if (!banco) return new Response("fora do ar", { status: 500 });
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
        return Response.json([
          {
            dominio_publico: banco.dominioPublico,
            mp_public_key: null,
            vapid_public_key: null,
            pagamento_online: false,
            manutencao: false,
          },
        ]);
      return Response.json([linhaDaLoja(banco.nome, url.origin)]);
    }
    throw new Error(`rede proibida no teste: ${url.toString()}`);
  }) as typeof fetch;
  return { fetchImpl, leituras };
}

// ─── a caderneta central (o `fetch` GLOBAL que `resolverNaCaderneta` usa) ──

type ModoDaCaderneta =
  | "rede"
  | "prazo"
  | "503"
  | "401"
  | "malformado"
  | "miss"
  | "hit-a"
  | "hit-a-novo";

function cadernetaNoModo(modo: ModoDaCaderneta) {
  const chamadas = { n: 0 };
  const duble = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    chamadas.n += 1;
    switch (modo) {
      case "rede":
        throw new TypeError("fetch failed");
      case "prazo":
        // Só termina quando o `AbortController` de 5 s da caderneta abortar.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("abortado", "AbortError")),
          );
        });
      case "503":
        return new Response("indisponivel", { status: 503 });
      case "401":
        return new Response("unauthorized", { status: 401 });
      case "malformado":
        return new Response("<html>nao e json</html>", { status: 200 });
      case "miss":
        return Response.json([]);
      case "hit-a":
        return Response.json([
          {
            supabase_url: ORIGEM_A,
            publishable_key: K_A,
            project_ref: REF_A,
            nome: "Loja Alfa Inventada",
            estado: "ativa",
          },
        ]);
      case "hit-a-novo":
        return Response.json([
          {
            supabase_url: ORIGEM_A_NOVO,
            publishable_key: K_A_NOVO,
            project_ref: REF_A_NOVO,
            nome: "Loja Alfa Inventada",
            estado: "ativa",
          },
        ]);
    }
  }) as typeof fetch;
  vi.stubGlobal("fetch", duble);
  return chamadas;
}

// ─── a reserva (dublê do leitor que a T6 vai ligar) ────────────────────────

function documentoDaReserva(hosts: Record<string, unknown>) {
  return {
    v: 1,
    gerada_em: "2026-11-26T12:00:00.000Z",
    sha: "0123456789abcdef0123456789abcdef01234567",
    hosts,
  };
}

const RESERVA_CERTA = documentoDaReserva({
  [HOST_A]: { u: ORIGEM_A, k: K_A },
  [HOST_B]: { u: ORIGEM_B, k: K_B },
  [ALIAS_A]: { u: ORIGEM_A, k: K_A },
});

/** O leitor da reserva, contando as leituras. */
function leitorDaReserva(devolve: () => Promise<unknown>) {
  return vi.fn<() => Promise<unknown>>(devolve);
}

function deps(
  fetchImpl: typeof fetch,
  extra: Partial<DependenciasPorteiro> = {},
): DependenciasPorteiro {
  return {
    fetchImpl,
    resolverNaCaderneta,
    cache: new Map<string, EntradaCachePorteiro>(),
    cacheSemLoja: new Map<string, EntradaCacheSemLoja>(),
    cacheForaDoAr: new Map(),
    resolucoesEmVoo: new Map<string, ResolucaoEmVoo>(),
    agora: () => 1_000_000,
    ...extra,
  };
}

function visitar(
  d: DependenciasPorteiro,
  host = HOST_A,
  caminho = "/",
  ambiente: AmbientePorteiro = AMBIENTE,
) {
  return atenderPorteiro(new Request(`https://${host}${caminho}`), ambiente, d);
}

function espiarLog() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ═══ T3 — a caderneta FALHA e não há ficha ═════════════════════════════════

describe("porteiro — a caderneta falha, sem ficha: abre pela reserva (T3)", () => {
  for (const modo of ["rede", "503", "401", "malformado"] as const) {
    it(`${modo}: 200 com x-ikcous-caderneta reserva, e o banco DA LOJA é lido`, async () => {
      espiarLog();
      const caderneta = cadernetaNoModo(modo);
      const banco = bancosDasLojas();
      const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
      const resp = await visitar(deps(banco.fetchImpl, { lerReserva }));
      const corpo = await resp.text();

      expect(resp.status).toBe(200);
      expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
      expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
      expect(corpo).toContain("Loja Alfa Inventada");
      expect(caderneta.n).toBeGreaterThan(0);
      expect(lerReserva).toHaveBeenCalledTimes(1);
      // A conferência de domínio aconteceu no banco da PRÓPRIA loja.
      expect(banco.leituras).toContain(ORIGEM_A);
      expect(banco.leituras).not.toContain(ORIGEM_B);
    });
  }

  it("prazo de 5 s esgotado: 200 com x-ikcous-caderneta reserva", async () => {
    espiarLog();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    cadernetaNoModo("prazo");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const pedido = visitar(deps(banco.fetchImpl, { lerReserva }));
    await vi.advanceTimersByTimeAsync(5_000);
    const resp = await pedido;

    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(lerReserva).toHaveBeenCalledTimes(1);
    expect(banco.leituras).toContain(ORIGEM_A);
  });

  it("a ficha aberta pela reserva fica guardada: a visita seguinte não lê nada", async () => {
    espiarLog();
    const caderneta = cadernetaNoModo("503");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    let agora = 1_000_000;
    const d = deps(banco.fetchImpl, { lerReserva, agora: () => agora });
    expect((await visitar(d)).status).toBe(200);
    agora += CACHE_FRESCO_MS - 1;
    const resp = await visitar(d);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(caderneta.n).toBe(1);
    expect(lerReserva).toHaveBeenCalledTimes(1);
  });

  it("a reserva aponta o host A para o banco de B: 503 discorda, NUNCA o dado de B", async () => {
    espiarLog();
    cadernetaNoModo("503");
    const banco = bancosDasLojas();
    const envenenada = documentoDaReserva({
      [HOST_A]: { u: ORIGEM_B, k: K_B },
    });
    const lerReserva = leitorDaReserva(async () => envenenada);
    const d = deps(banco.fetchImpl, { lerReserva });
    const resp = await visitar(d);
    const corpo = await resp.text();

    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(corpo).not.toContain("Loja Beta Inventada");
    expect(corpo).not.toContain(REF_B);
    // O banco de B foi perguntado (é ele quem nega o domínio), e nada dele
    // ficou guardado para o host A.
    expect(banco.leituras).toContain(ORIGEM_B);
    expect(d.cache.has(HOST_A)).toBe(false);
  });

  it("alias .vercel.app na reserva: 308 para o domínio da PRÓPRIA loja", async () => {
    espiarLog();
    cadernetaNoModo("rede");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const resp = await visitar(
      deps(banco.fetchImpl, { lerReserva }),
      ALIAS_A,
      "/product-detail?id=7",
    );
    expect(resp.status).toBe(308);
    expect(resp.headers.get("location")).toBe(
      `https://${HOST_A}/product-detail?id=7`,
    );
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
  });

  it("ficha de menos de 1 h + falha: serve a ficha e faz ZERO leituras da reserva", async () => {
    espiarLog();
    cadernetaNoModo("503");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    let agora = 1_000_000;
    const d = deps(banco.fetchImpl, { lerReserva, agora: () => agora });
    // Primeiro a ficha boa, pela caderneta que funciona.
    cadernetaNoModo("hit-a");
    expect((await visitar(d)).headers.get("x-ikcous-caderneta")).toBe("hit");
    // A caderneta cai; a ficha tem 59 min.
    cadernetaNoModo("503");
    agora += 59 * 60_000;
    const resp = await visitar(d);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
    // E também pela revalidação em segundo plano (com waitUntil).
    const pendentes: Promise<unknown>[] = [];
    const comWaitUntil = {
      ...d,
      waitUntil: (p: Promise<unknown>) => {
        pendentes.push(p);
      },
    };
    agora += 30_001; // passado o recuo de 30 s
    expect((await visitar(comWaitUntil)).status).toBe(200);
    await Promise.all(pendentes);
    expect(pendentes.length).toBe(1);
    expect(lerReserva).toHaveBeenCalledTimes(0);
  });

  it("5 pedidos simultâneos do mesmo host sem ficha: UMA leitura da reserva", async () => {
    espiarLog();
    const caderneta = cadernetaNoModo("503");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const d = deps(banco.fetchImpl, { lerReserva });
    const respostas = await Promise.all(
      Array.from({ length: 5 }, () => visitar(d)),
    );
    for (const r of respostas) {
      expect(r.status).toBe(200);
      expect(r.headers.get("x-ikcous-caderneta")).toBe("reserva");
    }
    expect(caderneta.n).toBe(1);
    expect(lerReserva).toHaveBeenCalledTimes(1);
  });

  it("a reserva lança erro: 503 banco-indisponivel com erro", async () => {
    espiarLog();
    cadernetaNoModo("503");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => {
      throw new Error("global config fora do ar");
    });
    const resp = await visitar(deps(banco.fetchImpl, { lerReserva }));
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
    expect(lerReserva).toHaveBeenCalledTimes(1);
    expect(banco.leituras).toEqual([]);
  });

  for (const [nome, devolve] of [
    ["nada (undefined)", undefined],
    ["null", null],
    [
      "documento sem o host",
      documentoDaReserva({ [HOST_B]: { u: ORIGEM_B, k: K_B } }),
    ],
    [
      "documento fora do formato",
      { v: 2, hosts: { [HOST_A]: { u: ORIGEM_A, k: K_A } } },
    ],
    [
      "entrada com chave que não é pública",
      documentoDaReserva({
        [HOST_A]: { u: ORIGEM_A, k: CHAVE_SECRETA_INVENTADA },
      }),
    ],
  ] as const) {
    it(`a reserva devolve ${nome}: 503 banco-indisponivel com erro, e banco nenhum é lido`, async () => {
      espiarLog();
      cadernetaNoModo("rede");
      const banco = bancosDasLojas();
      const lerReserva = leitorDaReserva(async () => devolve);
      const resp = await visitar(deps(banco.fetchImpl, { lerReserva }));
      expect(resp.status).toBe(503);
      expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
      expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
      expect(banco.leituras).toEqual([]);
    });
  }

  it("sem leitor de reserva: tudo como antes (503 banco-indisponivel com erro)", async () => {
    espiarLog();
    cadernetaNoModo("503");
    const banco = bancosDasLojas();
    const resp = await visitar(deps(banco.fetchImpl));
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
  });

  it("a reserva aponta para um banco que falha: 503 banco-indisponivel, sem cair em outra loja", async () => {
    espiarLog();
    cadernetaNoModo("503");
    const banco = bancosDasLojas({ [ORIGEM_B]: BANCO_B });
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const resp = await visitar(deps(banco.fetchImpl, { lerReserva }));
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(banco.leituras).not.toContain(ORIGEM_B);
  });
});

describe("porteiro — a caderneta VOLTA: ela manda de novo", () => {
  // A garantia principal do desenho: a reserva só segura a loja enquanto a
  // caderneta está fora. Passada a janela fresca de 60 s, a caderneta que
  // voltou é perguntada e a resposta dela SUBSTITUI a conexão da reserva —
  // mesmo apontando outro banco para o mesmo host (loja que trocou de banco
  // depois da última gravação da reserva).
  const BANCOS_COM_O_NOVO: Record<string, BancoFake> = {
    ...BANCOS,
    [ORIGEM_A_NOVO]: {
      nome: "Loja Alfa no Banco Novo",
      dominioPublico: HOST_A,
    },
  };

  it("com waitUntil (produção): a revalidação troca a ficha, e a reserva não é mais lida", async () => {
    espiarLog();
    cadernetaNoModo("503");
    const banco = bancosDasLojas(BANCOS_COM_O_NOVO);
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    let agora = 1_000_000;
    const pendentes: Promise<unknown>[] = [];
    const d = deps(banco.fetchImpl, {
      lerReserva,
      agora: () => agora,
      waitUntil: (p) => {
        pendentes.push(p);
      },
    });

    const pelaReserva = await visitar(d);
    expect(pelaReserva.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(await pelaReserva.text()).toContain("Loja Alfa Inventada");
    expect(lerReserva).toHaveBeenCalledTimes(1);

    // A caderneta volta e aponta A para o banco NOVO; passou a janela fresca.
    const caderneta = cadernetaNoModo("hit-a-novo");
    agora += CACHE_FRESCO_MS + 1;
    await visitar(d);
    await Promise.all(pendentes);
    expect(caderneta.n).toBe(1);

    const seguinte = await visitar(d);
    expect(seguinte.status).toBe(200);
    expect(seguinte.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(await seguinte.text()).toContain("Loja Alfa no Banco Novo");
    expect(banco.leituras).toContain(ORIGEM_A_NOVO);
    expect(lerReserva).toHaveBeenCalledTimes(1);
  });

  it("sem waitUntil: a visita depois dos 60 s já sai hit com o banco da caderneta", async () => {
    espiarLog();
    cadernetaNoModo("rede");
    const banco = bancosDasLojas(BANCOS_COM_O_NOVO);
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    let agora = 1_000_000;
    const d = deps(banco.fetchImpl, { lerReserva, agora: () => agora });
    expect((await visitar(d)).headers.get("x-ikcous-caderneta")).toBe(
      "reserva",
    );

    cadernetaNoModo("hit-a-novo");
    agora += CACHE_FRESCO_MS + 1;
    const deVolta = await visitar(d);
    expect(deVolta.status).toBe(200);
    expect(deVolta.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(await deVolta.text()).toContain("Loja Alfa no Banco Novo");
    expect(lerReserva).toHaveBeenCalledTimes(1);
  });
});

describe("porteiro — quando a reserva NUNCA é lida (T3)", () => {
  it("a caderneta responde (hit): zero leituras da reserva", async () => {
    cadernetaNoModo("hit-a");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const resp = await visitar(deps(banco.fetchImpl, { lerReserva }));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(lerReserva).toHaveBeenCalledTimes(0);
  });

  it("a caderneta respondeu, mas o banco da própria loja falhou: zero leituras da reserva", async () => {
    espiarLog();
    cadernetaNoModo("hit-a");
    const banco = bancosDasLojas({ [ORIGEM_B]: BANCO_B });
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const resp = await visitar(deps(banco.fetchImpl, { lerReserva }));
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(lerReserva).toHaveBeenCalledTimes(0);
  });

  it("caderneta ausente (preview, sem as variáveis da frota): zero leituras da reserva", async () => {
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const resp = await visitar(
      deps(banco.fetchImpl, { lerReserva }),
      HOST_A,
      "/",
      { VERCEL_ENV: "preview" },
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("ausente");
    expect(lerReserva).toHaveBeenCalledTimes(0);
  });
});

// ═══ T4 — o "não achei" (`miss`) ═══════════════════════════════════════════

describe("porteiro — 'não achei' sem ficha (T4)", () => {
  it("host que a reserva conhece: abre pela reserva, sem guardar o host como desconhecido", async () => {
    cadernetaNoModo("miss");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const d = deps(banco.fetchImpl, { lerReserva });
    const resp = await visitar(d);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("reserva");
    expect(await resp.text()).toContain("Loja Alfa Inventada");
    expect(d.cacheSemLoja?.has(HOST_A)).toBe(false);
    expect(lerReserva).toHaveBeenCalledTimes(1);
  });

  it("host que a reserva NÃO conhece: 503 sem-loja/miss, guardado por 60 s", async () => {
    const caderneta = cadernetaNoModo("miss");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    let agora = 1_000_000;
    const d = deps(banco.fetchImpl, { lerReserva, agora: () => agora });

    const primeira = await visitar(d, HOST_DESCONHECIDO);
    expect(primeira.status).toBe(503);
    expect(primeira.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(primeira.headers.get("x-ikcous-caderneta")).toBe("miss");
    expect(d.cacheSemLoja?.has(HOST_DESCONHECIDO)).toBe(true);
    expect(banco.leituras).toEqual([]);

    // Dentro dos 60 s: o mesmo 503, sem perguntar a ninguém.
    agora += CACHE_SEM_LOJA_MS - 1;
    const segunda = await visitar(d, HOST_DESCONHECIDO);
    expect(segunda.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(segunda.headers.get("x-ikcous-caderneta")).toBe("miss");
    expect(caderneta.n).toBe(1);
    expect(lerReserva).toHaveBeenCalledTimes(1);

    // Passados os 60 s, pergunta de novo.
    agora += 2;
    await visitar(d, HOST_DESCONHECIDO);
    expect(caderneta.n).toBe(2);
  });

  it("x-ikcous-reserva: ligada com leitor (inclusive no 503 guardado), desligada sem", async () => {
    cadernetaNoModo("miss");
    const banco = bancosDasLojas();
    const comLeitor = deps(banco.fetchImpl, {
      lerReserva: leitorDaReserva(async () => RESERVA_CERTA),
    });
    expect(
      (await visitar(comLeitor, HOST_DESCONHECIDO)).headers.get(
        "x-ikcous-reserva",
      ),
    ).toBe("ligada");
    expect(
      (await visitar(comLeitor, HOST_DESCONHECIDO)).headers.get(
        "x-ikcous-reserva",
      ),
    ).toBe("ligada");

    const semLeitor = deps(banco.fetchImpl);
    expect(
      (await visitar(semLeitor, HOST_A)).headers.get("x-ikcous-reserva"),
    ).toBe("desligada");
    expect(
      (await visitar(semLeitor, HOST_A)).headers.get("x-ikcous-reserva"),
    ).toBe("desligada");
  });

  it("'não achei' e a reserva também falha: continua 503 sem-loja/miss", async () => {
    cadernetaNoModo("miss");
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => {
      throw new Error("global config fora do ar");
    });
    const d = deps(banco.fetchImpl, { lerReserva });
    const resp = await visitar(d);
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    expect(resp.headers.get("x-ikcous-reserva")).toBe("ligada");
  });

  it("'não achei' com ficha de menos de 1 h: serve a ficha (como hoje) e não lê a reserva", async () => {
    espiarLog();
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    let agora = 1_000_000;
    const d = deps(banco.fetchImpl, { lerReserva, agora: () => agora });
    cadernetaNoModo("hit-a");
    expect((await visitar(d)).status).toBe(200);
    cadernetaNoModo("miss");
    agora += CACHE_FRESCO_MS + 1;
    const resp = await visitar(d);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    expect(lerReserva).toHaveBeenCalledTimes(0);
  });
});

describe("porteiro — decisões da caderneta que NUNCA leem a reserva (T4)", () => {
  function cadernetaInjetada(
    resultado: Awaited<ReturnType<ResolverLojaNaCaderneta>>,
  ) {
    return vi.fn<ResolverLojaNaCaderneta>(async () => resultado);
  }

  for (const estado of ["adormecida", "encerrada"] as const) {
    it(`loja ${estado}: a página própria, e zero leituras da reserva`, async () => {
      const banco = bancosDasLojas();
      const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
      const resp = await visitar(
        deps(banco.fetchImpl, {
          lerReserva,
          resolverNaCaderneta: cadernetaInjetada({
            tipo: "fora-do-ar",
            estado,
            nome: "Loja Alfa Inventada",
            ref: REF_A,
          }),
        }),
      );
      expect(resp.headers.get("x-ikcous-porteiro")).toBe(estado);
      expect(lerReserva).toHaveBeenCalledTimes(0);
      expect(banco.leituras).toEqual([]);
    });
  }

  it("chave anômala: 503 sem-loja/erro, e zero leituras da reserva", async () => {
    const banco = bancosDasLojas();
    const lerReserva = leitorDaReserva(async () => RESERVA_CERTA);
    const resp = await visitar(
      deps(banco.fetchImpl, {
        lerReserva,
        resolverNaCaderneta: cadernetaInjetada({
          tipo: "hit",
          conexao: {
            supabaseUrl: ORIGEM_A,
            publishableKey: CHAVE_SECRETA_INVENTADA,
            origem: "caderneta",
          },
        }),
      }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
    expect(resp.headers.get("x-ikcous-reserva")).toBeNull();
    expect(lerReserva).toHaveBeenCalledTimes(0);
  });
});
