// O "não achei" da caderneta não apaga a loja que tem ficha recente
// (26/11/2026). A caderneta central é um ponto único de falha: se ela passa a
// responder ZERO linhas para TODAS as lojas (chave trocada só de um lado,
// tabela restaurada errada), em ~60 s a frota inteira ia para manutenção — o
// porteiro guardava o host como desconhecido, apagava a ficha boa, e o service
// worker apagava a página guardada no celular da cliente ao ver o 503
// `sem-loja`.
//
// Agora o `miss` para um host que tem ficha boa de menos de 1 h usa a MESMA
// reserva da falha (#1885): a ficha velha, 30 s de recuo sem perguntar e uma
// linha `[porteiro]` no log. O que NÃO muda:
//   - host sem ficha recente continua recebendo "não achei" (503 `sem-loja`,
//     guardado 60 s): loja inexistente não ganha vitrine;
//   - loja adormecida/encerrada sai do ar pelo estado EXPLÍCITO da caderneta;
//   - passada 1 h da última resolução boa, o "não achei" volta a valer;
//   - chave anômala e `discorda` continuam fechando na hora.
//
// Nunca rede de verdade: caderneta injetada e `fetch` dublê.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_FRESCO_MS,
  CACHE_STALE_MAX_MS,
  RECUO_APOS_FALHA_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
  obterFichaValidada,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCacheForaDoAr,
  EntradaCachePorteiro,
  EntradaCacheSemLoja,
  ResolucaoEmVoo,
  ResolverLojaNaCaderneta,
  ResultadoCaderneta,
  ResultadoObterFicha,
} from "@/hospedagem/porteiro";

const ORIGEM = "https://projetoaaaaaaaaaaaaa.supabase.co";
const REF = "abcdefghijklmnopqrst";
const HOST = "loja-alfa.exemplo";

const AMBIENTE: AmbientePorteiro = {
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste",
};

const fetchProibido = (async (input: RequestInfo | URL) => {
  throw new Error(`rede proibida: ${String(input)}`);
}) as typeof fetch;

const MISS: ResultadoCaderneta = { tipo: "miss" };

function fichaVelha(host: string): EntradaCachePorteiro["ficha"] {
  return {
    host,
    identidade: {
      publicUrl: "https://velha.exemplo",
      identity: { storeName: "Loja Velha" },
    },
  } as unknown as EntradaCachePorteiro["ficha"];
}

/** Ficha boa de `idadeMs` atrás, em relação a `agora`. */
function comFicha(agora: number, idadeMs: number, host = HOST) {
  const cache = new Map<string, EntradaCachePorteiro>();
  cache.set(host, {
    ficha: fichaVelha(host),
    quando: agora - idadeMs,
    caderneta: "hit",
  });
  return cache;
}

function espiarLog() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

const visitar = (d: DependenciasPorteiro, endereco = `https://${HOST}/`) =>
  obterFichaValidada(new Request(endereco), AMBIENTE, d);

function cabecalho(r: ResultadoObterFicha, nome: string): string | null {
  if (r.tipo !== "manutencao") throw new Error(`esperava 503, veio ${r.tipo}`);
  return r.resposta.headers.get(nome);
}

function fichaDe(r: ResultadoObterFicha) {
  if (r.tipo !== "ok") {
    throw new Error(
      `esperava a ficha, veio ${r.resposta.status} ${r.resposta.headers.get("x-ikcous-porteiro")}`,
    );
  }
  return r;
}

/** Caderneta cuja resposta só sai quando o teste soltar (pedido em voo). */
function cadernetaAdiada() {
  const soltas: Array<(r: ResultadoCaderneta) => void> = [];
  const fn = vi.fn<ResolverLojaNaCaderneta>(
    () =>
      new Promise<ResultadoCaderneta>((resolve) => {
        soltas.push(resolve);
      }),
  );
  return {
    fn,
    soltar: (r: ResultadoCaderneta) => {
      for (const s of soltas.splice(0)) s(r);
    },
  };
}

// ─── na hora (sem waitUntil) ────────────────────────────────────────────────

describe("porteiro — 'não achei' com ficha de menos de 1 h usa a reserva (na hora)", () => {
  it("serve a ficha velha, não guarda o host como desconhecido e abre o recuo de 30 s", async () => {
    espiarLog();
    let agora = 1_000_000;
    const cache = comFicha(agora, CACHE_FRESCO_MS + 10_000);
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => MISS);
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache,
      cacheSemLoja,
      agora: () => agora,
    };

    const r = fichaDe(await visitar(d));
    expect(r.ficha.identidade.identity.storeName).toBe("Loja Velha");
    expect(r.ficha.identidade.publicUrl).toBe(`https://${HOST}`);
    // O estado desta tentativa vai no cabeçalho: ela disse "não achei".
    expect(r.caderneta).toBe("miss");
    expect(cacheSemLoja.has(HOST)).toBe(false);
    const guardada = cache.get(HOST);
    expect(guardada?.ficha.identidade.identity.storeName).toBe("Loja Velha");
    // O teto de 1 h continua contando da última resolução BOA.
    expect(guardada?.quando).toBe(agora - (CACHE_FRESCO_MS + 10_000));
    expect(guardada?.recuo).toEqual({
      ate: agora + RECUO_APOS_FALHA_MS,
      caderneta: "miss",
    });

    // Dentro do recuo: a ficha, sem perguntar de novo.
    agora += RECUO_APOS_FALHA_MS - 1;
    expect(fichaDe(await visitar(d)).caderneta).toBe("miss");
    expect(caderneta).toHaveBeenCalledTimes(1);
  });

  it("miss pela função antiga (versão 1): a marca de versão viaja com a reserva", async () => {
    espiarLog();
    const cache = comFicha(0, CACHE_FRESCO_MS + 1);
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => ({
        tipo: "miss",
        versao: 1,
      })),
      cache,
      cacheSemLoja: new Map(),
      agora: () => 0,
    };
    const r = fichaDe(await visitar(d));
    expect(r.caderneta).toBe("miss");
    expect(r.versaoCaderneta).toBe(1);
    expect(cache.get(HOST)?.recuo?.versaoCaderneta).toBe(1);
  });

  it("a caderneta diz 'não achei' para a FROTA INTEIRA: toda loja com ficha recente continua no ar", async () => {
    espiarLog();
    const agora = 7_000_000;
    const hosts = ["loja-a.exemplo", "loja-b.exemplo", "loja-c.exemplo"];
    const cache = new Map<string, EntradaCachePorteiro>();
    hosts.forEach((h, i) => {
      cache.set(h, {
        ficha: fichaVelha(h),
        // Idades diferentes, todas dentro da reserva.
        quando: agora - CACHE_FRESCO_MS - i * 600_000,
        caderneta: "hit",
      });
    });
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => MISS),
      cache,
      cacheSemLoja: new Map(),
      agora: () => agora,
    };
    for (const h of hosts) {
      const r = fichaDe(await visitar(d, `https://${h}/produto`));
      expect(r.ficha.host).toBe(h);
    }
    expect(cache.size).toBe(3);
  });

  it("host SEM ficha continua recebendo 'não achei' (503 sem-loja, guardado 60 s)", async () => {
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => MISS);
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: comFicha(0, CACHE_FRESCO_MS + 1, "outra-loja.exemplo"),
      cacheSemLoja,
      agora: () => 0,
    };
    const r = await visitar(d, "https://inventado.exemplo/");
    expect(cabecalho(r, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cabecalho(r, "x-ikcous-caderneta")).toBe("miss");
    expect(cacheSemLoja.get("inventado.exemplo")?.recuo).toBeUndefined();
    await visitar(d, "https://inventado.exemplo/");
    expect(caderneta).toHaveBeenCalledTimes(1);
  });

  it("ficha de 1 h ou mais: o 'não achei' vale como hoje (503 sem-loja, guardado)", async () => {
    const agora = 9_000_000;
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => MISS),
      cache: comFicha(agora, CACHE_STALE_MAX_MS),
      cacheSemLoja,
      agora: () => agora,
    };
    const r = await visitar(d);
    expect(cabecalho(r, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cacheSemLoja.has(HOST)).toBe(true);
  });

  it("a reserva NÃO se renova sozinha: 'não achei' seguido por 1 h sem confirmação volta ao comportamento de hoje", async () => {
    espiarLog();
    let agora = 0;
    const cache = comFicha(agora, CACHE_FRESCO_MS + 1);
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => MISS);
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache,
      cacheSemLoja,
      agora: () => agora,
    };
    // Recuo atrás de recuo, sempre "não achei", até a ficha passar de 1 h.
    const limite = CACHE_STALE_MAX_MS - (CACHE_FRESCO_MS + 1);
    while (agora < limite) {
      expect((await visitar(d)).tipo).toBe("ok");
      agora += RECUO_APOS_FALHA_MS;
    }
    // Aqui a ficha já tem 1 h ou mais desde a última resolução boa.
    const depois = await visitar(d);
    expect(cabecalho(depois, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cacheSemLoja.has(HOST)).toBe(true);
  });

  it("loja ADORMECIDA (estado explícito) sai do ar mesmo com ficha recente, e a ficha sai", async () => {
    const cache = comFicha(0, CACHE_FRESCO_MS + 1);
    const cacheForaDoAr = new Map<string, EntradaCacheForaDoAr>();
    const r = await visitar({
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => ({
        tipo: "fora-do-ar",
        estado: "adormecida",
        ref: REF,
        nome: "Loja Alfa",
      })),
      cache,
      cacheForaDoAr,
      cacheSemLoja: new Map(),
      agora: () => 0,
    });
    expect(cabecalho(r, "x-ikcous-porteiro")).toBe("adormecida");
    expect(cache.has(HOST)).toBe(false);
    expect(cacheForaDoAr.has(HOST)).toBe(true);
  });

  it("chave anômala (sem-loja com caderneta 'erro') continua fechando na hora, mesmo com ficha recente", async () => {
    const r = await visitar({
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => ({
        tipo: "hit",
        conexao: {
          supabaseUrl: ORIGEM,
          publishableKey: "chave-service-role-nao-publica",
          origem: "caderneta",
        },
      })),
      cache: comFicha(0, CACHE_FRESCO_MS + 1),
      cacheSemLoja: new Map(),
      agora: () => 0,
    });
    expect(cabecalho(r, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cabecalho(r, "x-ikcous-caderneta")).toBe("erro");
  });

  it("5 visitas simultâneas com 'não achei': 1 pergunta, as 5 recebem a ficha, 1 linha de log", async () => {
    const espiao = espiarLog();
    const adiada = cadernetaAdiada();
    const resolucoesEmVoo = new Map<string, ResolucaoEmVoo>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: adiada.fn,
      cache: comFicha(0, CACHE_FRESCO_MS + 1),
      cacheSemLoja: new Map(),
      resolucoesEmVoo,
      agora: () => 0,
    };
    const emCurso = Array.from({ length: 5 }, () => visitar(d));
    await new Promise<void>((r) => setTimeout(r, 0));
    adiada.soltar(MISS);
    for (const r of await Promise.all(emCurso))
      expect(fichaDe(r).caderneta).toBe("miss");
    expect(adiada.fn).toHaveBeenCalledTimes(1);
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(resolucoesEmVoo.size).toBe(0);
  });
});

// ─── em segundo plano (com waitUntil) ──────────────────────────────────────

describe("porteiro — 'não achei' na revalidação de fundo também usa a reserva", () => {
  function montar() {
    const adiada = cadernetaAdiada();
    const cache = comFicha(0, CACHE_FRESCO_MS + 10_000);
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const entregues: Promise<unknown>[] = [];
    const relogio = { agora: 0 };
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: adiada.fn,
      cache,
      cacheForaDoAr: new Map(),
      cacheSemLoja,
      resolucoesEmVoo: new Map(),
      waitUntil: (p) => {
        entregues.push(p);
      },
      agora: () => relogio.agora,
    };
    return { adiada, cache, cacheSemLoja, entregues, relogio, d };
  }

  it("a ficha fica, com recuo de 30 s, e a próxima visita recebe a vitrine", async () => {
    espiarLog();
    const { adiada, cache, cacheSemLoja, entregues, relogio, d } = montar();
    expect((await visitar(d)).tipo).toBe("ok");
    relogio.agora = 500;
    adiada.soltar(MISS);
    await expect(Promise.all(entregues)).resolves.toBeDefined();
    expect(cache.get(HOST)?.recuo).toEqual({
      ate: 500 + RECUO_APOS_FALHA_MS,
      caderneta: "miss",
    });
    expect(cacheSemLoja.has(HOST)).toBe(false);
    const proxima = fichaDe(await visitar(d));
    expect(proxima.ficha.identidade.identity.storeName).toBe("Loja Velha");
    expect(proxima.caderneta).toBe("miss");
    expect(adiada.fn).toHaveBeenCalledTimes(1);
  });

  it("revalidação que termina DEPOIS de 1 h da última resolução boa: o 'não achei' vale (a ficha sai)", async () => {
    const { adiada, cache, cacheSemLoja, entregues, relogio, d } = montar();
    expect((await visitar(d)).tipo).toBe("ok");
    relogio.agora = CACHE_STALE_MAX_MS;
    adiada.soltar(MISS);
    await Promise.all(entregues);
    expect(cache.has(HOST)).toBe(false);
    expect(cacheSemLoja.has(HOST)).toBe(true);
  });
});

// ─── o log ──────────────────────────────────────────────────────────────────

describe("porteiro — a reserva usada por 'não achei' deixa UMA linha no log, sem segredo", () => {
  it("diz o host, que foi 'não achei' e o recuo; nunca chave nem URL", async () => {
    const espiao = espiarLog();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => MISS),
      cache: comFicha(0, CACHE_FRESCO_MS + 1),
      cacheSemLoja: new Map(),
      agora: () => 0,
    };
    await visitar(d);
    await visitar(d);
    expect(espiao).toHaveBeenCalledTimes(1);
    const linha = String(espiao.mock.calls[0]?.[0]);
    expect(linha).toContain("[porteiro]");
    expect(linha).toContain(`host=${HOST}`);
    expect(linha).toContain("causa=nao-achei");
    expect(linha).toContain("caderneta=miss");
    expect(linha).toContain(`recuo=${RECUO_APOS_FALHA_MS / 1000}s`);
    const tudo = JSON.stringify(espiao.mock.calls);
    expect(tudo).not.toContain(AMBIENTE.IKCOUS_FROTA_CHAVE);
    expect(tudo).not.toContain(AMBIENTE.IKCOUS_FROTA_APIKEY);
    expect(tudo).not.toContain("principal.supabase.co");
  });
});

// ─── a resposta inteira (o que o service worker vê) ────────────────────────

const HTML_ASSADO =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" /><title>Loja Fixture</title><style id="dynamic-branding-style">:root {--primary-color:#000000;}</style></head><body></body></html>';

function linhaDaLoja(nome: string) {
  const hash = "a".repeat(64);
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
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${ORIGEM}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#111111",
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

const fetchDaLoja = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/index.html")
    return new Response(HTML_ASSADO, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  if (url.origin === ORIGEM && url.pathname === "/rest/v1/v_store_config") {
    const corpo =
      url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA
        ? [
            {
              dominio_publico: HOST,
              mp_public_key: null,
              vapid_public_key: null,
              pagamento_online: false,
              manutencao: false,
            },
          ]
        : [linhaDaLoja("Loja Alfa")];
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`pedido não mapeado no dublê: ${url.toString()}`);
}) as typeof fetch;

describe("atenderPorteiro — a vitrine servida pela reserva do 'não achei'", () => {
  it("é 200 com x-ikcous-porteiro ok (nunca o par 503 + sem-loja que faz o service worker apagar a página)", async () => {
    espiarLog();
    let agora = 0;
    let resposta: ResultadoCaderneta = {
      tipo: "hit",
      conexao: {
        supabaseUrl: ORIGEM,
        publishableKey: "sb_publishable_a",
        origem: "caderneta",
      },
    };
    const d: DependenciasPorteiro = {
      fetchImpl: fetchDaLoja,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => resposta),
      cache: new Map(),
      cacheSemLoja: new Map(),
      agora: () => agora,
    };
    const pedidoDaVitrine = () => new Request(`https://${HOST}/`);
    expect((await atenderPorteiro(pedidoDaVitrine(), AMBIENTE, d)).status).toBe(
      200,
    );
    resposta = MISS;
    agora += CACHE_FRESCO_MS;
    const r = await atenderPorteiro(pedidoDaVitrine(), AMBIENTE, d);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ikcous-porteiro")).toBe("ok");
    expect(r.headers.get("x-ikcous-caderneta")).toBe("miss");
    expect(await r.text()).toContain("Loja Alfa");
  });
});
