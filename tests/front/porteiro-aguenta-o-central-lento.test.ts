// O porteiro aguenta a caderneta central lenta ou oscilando (26/11/2026). Na
// Black Friday, ou logo depois de uma publicação (toda instância nasce sem
// nada guardado), três defeitos faziam o porteiro martelar o banco central
// justamente quando ele oscila:
//
//   A) instância NOVA (nada guardado) + caderneta com erro/timeout: o recuo de
//      30 s só existia com ficha velha guardada, então cada visita perguntava
//      de novo. Agora o erro sem ficha abre um recuo de 10 s por host no mapa
//      do "desconhecido" (mesmo teto de 1000), servindo o mesmo 503 de hoje —
//      e NUNCA vira "não achei".
//   B) passado o fresco de 60 s, a próxima visita ESPERAVA a caderneta (lenta,
//      mas dentro do prazo de 5 s). Agora, com ficha dentro da reserva de 1 h
//      e `waitUntil` disponível, a visita sai na hora com a ficha guardada e a
//      caderneta é perguntada em segundo plano (uma só por host).
//   C) a falha era calada: agora sai UM `console.error` curto por host por
//      recuo, sem chave nem URL.
//
// Nunca rede de verdade: caderneta injetada e `fetch` dublê.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_FRESCO_MS,
  CACHE_SEM_LOJA_MS,
  CACHE_STALE_MAX_MS,
  RECUO_APOS_FALHA_MS,
  RECUO_SEM_FICHA_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  TETO_ENTRADAS_CACHE,
  obterFichaValidada,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
  EntradaCacheSemLoja,
  ResolucaoEmVoo,
  ResolverLojaNaCaderneta,
  ResultadoCaderneta,
  ResultadoObterFicha,
} from "@/hospedagem/porteiro";

const ORIGEM = "https://projetoaaaaaaaaaaaaa.supabase.co";
const REF = "abcdefghijklmnopqrst";

const AMBIENTE: AmbientePorteiro = {
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste",
};

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

function linhaDaLoja(nome: string) {
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

/** Banco da loja (identidade + configuração pública). */
function bancoDaLoja(dominioPublico: string, nome = "Loja Nova") {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === ORIGEM && url.pathname === "/rest/v1/v_store_config") {
      const corpo =
        url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA
          ? [
              {
                dominio_publico: dominioPublico,
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: false,
              },
            ]
          : [linhaDaLoja(nome)];
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`pedido não mapeado no dublê: ${url.toString()}`);
  });
  return fetchImpl as unknown as typeof fetch;
}

const fetchProibido = (async (input: RequestInfo | URL) => {
  throw new Error(`rede proibida: ${String(input)}`);
}) as typeof fetch;

const HIT: ResultadoCaderneta = {
  tipo: "hit",
  conexao: {
    supabaseUrl: ORIGEM,
    publishableKey: "sb_publishable_a",
    origem: "caderneta",
  },
};

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

const umaVolta = () => new Promise<void>((r) => setTimeout(r, 0));
const PRESO = Symbol("preso");
/** O resultado, ou `PRESO` se a visita ainda espera depois de 50 ms. */
function ouPreso<T>(p: Promise<T>): Promise<T | typeof PRESO> {
  return Promise.race([
    p,
    new Promise<typeof PRESO>((r) => setTimeout(() => r(PRESO), 50)),
  ]);
}

const pedido = (endereco: string) => new Request(endereco);

function cabecalho(r: ResultadoObterFicha, nome: string): string | null {
  if (r.tipo !== "manutencao") throw new Error(`esperava 503, veio ${r.tipo}`);
  return r.resposta.headers.get(nome);
}

function fichaVelha(host: string): EntradaCachePorteiro["ficha"] {
  return {
    host,
    identidade: {
      publicUrl: "https://velha.exemplo",
      identity: { storeName: "Loja Velha" },
    },
  } as unknown as EntradaCachePorteiro["ficha"];
}

function espiarLog() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

const visitar = (
  d: DependenciasPorteiro,
  endereco = "https://loja-alfa.exemplo/",
) => obterFichaValidada(pedido(endereco), AMBIENTE, d);

// ─── A) erro sem nada guardado: recuo curto de 10 s ────────────────────────

describe("porteiro — instância nova com a caderneta em erro não martela o central", () => {
  it.each([
    ["erro da RPC (HTTP/rede/timeout)", { tipo: "erro" } as ResultadoCaderneta],
    [
      "erro pela reserva (função antiga)",
      { tipo: "erro", versao: 1 } as ResultadoCaderneta,
    ],
  ])(
    "%s: dentro de 10 s responde o MESMO 503 sem perguntar; passados 10 s pergunta de novo",
    async (_nome, resultado) => {
      espiarLog();
      let agora = 5_000;
      const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => resultado);
      const d: DependenciasPorteiro = {
        fetchImpl: fetchProibido,
        resolverNaCaderneta: caderneta,
        cache: new Map(),
        cacheSemLoja: new Map(),
        agora: () => agora,
      };
      const primeira = await visitar(d);
      const versao = resultado.tipo === "erro" ? resultado.versao : undefined;
      expect(cabecalho(primeira, "x-ikcous-porteiro")).toBe(
        "banco-indisponivel",
      );
      agora += RECUO_SEM_FICHA_MS - 1;
      const noRecuo = await visitar(d, "https://LOJA-ALFA.exemplo:8443/outra");
      expect(caderneta).toHaveBeenCalledTimes(1);
      if (noRecuo.tipo !== "manutencao") throw new Error("esperava 503");
      expect(noRecuo.resposta.status).toBe(503);
      for (const nome of [
        "x-ikcous-porteiro",
        "x-ikcous-caderneta",
        "x-ikcous-caderneta-versao",
        "retry-after",
        "cache-control",
        "content-type",
      ])
        expect(cabecalho(noRecuo, nome)).toBe(cabecalho(primeira, nome));
      expect(cabecalho(noRecuo, "x-ikcous-caderneta")).toBe("erro");
      expect(cabecalho(noRecuo, "x-ikcous-caderneta-versao")).toBe(
        versao === undefined ? null : "1",
      );
      expect(await noRecuo.resposta.text()).toContain("em manutenção");

      agora += 1;
      await visitar(d);
      expect(caderneta).toHaveBeenCalledTimes(2);
      expect(RECUO_SEM_FICHA_MS).toBe(10_000);
    },
  );

  it("caderneta que LANÇA (imprevisto) também abre o recuo de 10 s", async () => {
    espiarLog();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => {
      throw new Error("imprevisto");
    });
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja: new Map(),
      agora: () => 0,
    };
    const a = await visitar(d);
    const b = await visitar(d);
    expect(cabecalho(a, "x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(cabecalho(b, "x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(caderneta).toHaveBeenCalledTimes(1);
  });

  it("o erro NUNCA vira 'não achei': nem durante o recuo, nem depois; um miss depois do recuo é guardado normalmente", async () => {
    espiarLog();
    let agora = 0;
    let resposta: ResultadoCaderneta = { tipo: "erro" };
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => resposta);
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => agora,
    };
    await visitar(d);
    // Muito além do recuo, mas dentro dos 60 s do "não achei": se o erro
    // tivesse sido guardado como miss, sairia 503 sem-loja sem perguntar.
    agora += RECUO_SEM_FICHA_MS + 1;
    resposta = HIT;
    const dComBanco = { ...d, fetchImpl: bancoDaLoja("loja-alfa.exemplo") };
    const voltou = await visitar(dComBanco);
    expect(voltou.tipo).toBe("ok");
    expect(caderneta).toHaveBeenCalledTimes(2);
    expect(cacheSemLoja.has("loja-alfa.exemplo")).toBe(false);

    // Outro host: erro, recuo vence, depois miss -> guardado 60 s como miss.
    resposta = { tipo: "erro" };
    await visitar(d, "https://outra.exemplo/");
    agora += RECUO_SEM_FICHA_MS;
    resposta = { tipo: "miss" };
    const miss = await visitar(d, "https://outra.exemplo/");
    expect(cabecalho(miss, "x-ikcous-porteiro")).toBe("sem-loja");
    agora += CACHE_SEM_LOJA_MS - 1;
    const missGuardado = await visitar(d, "https://outra.exemplo/");
    expect(cabecalho(missGuardado, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cabecalho(missGuardado, "x-ikcous-caderneta")).toBe("miss");
    expect(caderneta).toHaveBeenCalledTimes(4);
  });

  it("chave anômala (sem-loja com caderneta 'erro') segue sem recuo: pergunta de novo, como antes", async () => {
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: ORIGEM,
        publishableKey: "chave-service-role-nao-publica",
        origem: "caderneta",
      },
    }));
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => 0,
    };
    await visitar(d);
    await visitar(d);
    expect(caderneta).toHaveBeenCalledTimes(2);
    expect(cacheSemLoja.size).toBe(0);
  });

  it("ficha guardada há mais de 1 h + erro: sem reserva, cai no mesmo recuo de 10 s", async () => {
    espiarLog();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => ({
      tipo: "erro",
    }));
    const cache = new Map<string, EntradaCachePorteiro>();
    cache.set("loja-alfa.exemplo", {
      ficha: fichaVelha("loja-alfa.exemplo"),
      quando: -CACHE_STALE_MAX_MS - 1,
      caderneta: "hit",
    });
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache,
      cacheSemLoja: new Map(),
      agora: () => 0,
    };
    expect(cabecalho(await visitar(d), "x-ikcous-porteiro")).toBe(
      "banco-indisponivel",
    );
    expect(cabecalho(await visitar(d), "x-ikcous-porteiro")).toBe(
      "banco-indisponivel",
    );
    expect(caderneta).toHaveBeenCalledTimes(1);
  });

  it(`o recuo sem ficha mora no mapa do desconhecido, com o mesmo teto (${TETO_ENTRADAS_CACHE}), e nunca empurra a ficha de uma loja`, async () => {
    espiarLog();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => ({
      tipo: "erro",
    }));
    const cache = new Map<string, EntradaCachePorteiro>();
    cache.set("loja-real.exemplo", {
      ficha: fichaVelha("loja-real.exemplo"),
      quando: 0,
      caderneta: "hit",
    });
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache,
      cacheSemLoja,
      agora: () => 0,
    };
    for (let i = 0; i <= TETO_ENTRADAS_CACHE; i += 1)
      await visitar(d, `https://robo-${i}.exemplo/`);
    expect(cacheSemLoja.size).toBe(TETO_ENTRADAS_CACHE);
    expect(cacheSemLoja.has("robo-0.exemplo")).toBe(false);
    expect(cache.size).toBe(1);
    expect(cache.has("loja-real.exemplo")).toBe(true);
  });

  it("5 visitas simultâneas na instância nova: 1 pergunta, e o recuo vale para a seguinte", async () => {
    espiarLog();
    const adiada = cadernetaAdiada();
    const resolucoesEmVoo = new Map<string, ResolucaoEmVoo>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: adiada.fn,
      cache: new Map(),
      cacheSemLoja: new Map(),
      resolucoesEmVoo,
      agora: () => 0,
    };
    const emCurso = Array.from({ length: 5 }, () => visitar(d));
    await umaVolta();
    adiada.soltar({ tipo: "erro" });
    for (const r of await Promise.all(emCurso))
      expect(cabecalho(r, "x-ikcous-porteiro")).toBe("banco-indisponivel");
    await visitar(d);
    expect(adiada.fn).toHaveBeenCalledTimes(1);
    expect(resolucoesEmVoo.size).toBe(0);
  });
});

// ─── B) ficha passada dos 60 s: responde já, pergunta em segundo plano ──────

describe("porteiro — ficha na reserva sai na hora e a caderneta é perguntada em segundo plano", () => {
  function montar(quandoDaFicha = -(CACHE_FRESCO_MS + 10_000)) {
    const adiada = cadernetaAdiada();
    const cache = new Map<string, EntradaCachePorteiro>();
    cache.set("loja-alfa.exemplo", {
      ficha: fichaVelha("loja-alfa.exemplo"),
      quando: quandoDaFicha,
      caderneta: "hit",
    });
    const entregues: Promise<unknown>[] = [];
    const waitUntil = vi.fn((p: Promise<unknown>) => {
      entregues.push(p);
    });
    const relogio = { agora: 0 };
    const cacheForaDoAr = new Map();
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const resolucoesEmVoo = new Map<string, ResolucaoEmVoo>();
    const d: DependenciasPorteiro = {
      fetchImpl: bancoDaLoja("loja-alfa.exemplo"),
      resolverNaCaderneta: adiada.fn,
      cache,
      cacheForaDoAr,
      cacheSemLoja,
      resolucoesEmVoo,
      waitUntil,
      agora: () => relogio.agora,
    };
    return {
      adiada,
      cache,
      cacheSemLoja,
      cacheForaDoAr,
      resolucoesEmVoo,
      entregues,
      waitUntil,
      relogio,
      d,
    };
  }

  it("caderneta lenta: a visita NÃO espera; recebe a ficha guardada e a revalidação vai para o waitUntil", async () => {
    const { adiada, cache, entregues, waitUntil, relogio, d } = montar();
    const r = await ouPreso(visitar(d, "https://loja-alfa.exemplo/produto"));
    expect(r).not.toBe(PRESO);
    if (r === PRESO || r.tipo !== "ok") throw new Error("esperava a ficha");
    expect(r.ficha.identidade.identity.storeName).toBe("Loja Velha");
    expect(r.caderneta).toBe("hit");
    // `publicUrl` continua sendo a do pedido atual.
    expect(r.ficha.identidade.publicUrl).toBe("https://loja-alfa.exemplo");
    expect(adiada.fn).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    relogio.agora += 2_000;
    adiada.soltar(HIT);
    await Promise.all(entregues);
    const renovada = cache.get("loja-alfa.exemplo");
    expect(renovada?.ficha.identidade.identity.storeName).toBe("Loja Nova");
    expect(renovada?.recuo).toBeUndefined();
    // A próxima visita usa a ficha nova, fresca, sem perguntar.
    const depois = await visitar(d);
    if (depois.tipo !== "ok") throw new Error("esperava a ficha");
    expect(depois.ficha.identidade.identity.storeName).toBe("Loja Nova");
    expect(adiada.fn).toHaveBeenCalledTimes(1);
  });

  it("várias visitas durante a revalidação: UMA pergunta e UM waitUntil por host", async () => {
    const { adiada, entregues, waitUntil, resolucoesEmVoo, d } = montar();
    for (let i = 0; i < 4; i += 1) {
      const r = await ouPreso(visitar(d, `https://loja-alfa.exemplo/p${i}`));
      expect(r).not.toBe(PRESO);
    }
    expect(adiada.fn).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(resolucoesEmVoo.size).toBe(1);
    adiada.soltar(HIT);
    await Promise.all(entregues);
    expect(resolucoesEmVoo.size).toBe(0);
  });

  it("sem waitUntil disponível, o comportamento é o de hoje: a visita espera a caderneta", async () => {
    const { adiada, d } = montar();
    const semWaitUntil: DependenciasPorteiro = { ...d, waitUntil: undefined };
    const emCurso = visitar(semWaitUntil);
    expect(await ouPreso(emCurso)).toBe(PRESO);
    adiada.soltar(HIT);
    const r = await emCurso;
    if (r.tipo !== "ok") throw new Error("esperava a ficha");
    expect(r.ficha.identidade.identity.storeName).toBe("Loja Nova");
  });

  it("waitUntil que lança não derruba a visita: ela sai com a ficha guardada", async () => {
    const { adiada, d } = montar();
    const quebrado: DependenciasPorteiro = {
      ...d,
      waitUntil: () => {
        throw new Error("waitUntil quebrou");
      },
    };
    const r = await ouPreso(visitar(quebrado));
    expect(r).not.toBe(PRESO);
    if (r === PRESO || r.tipo !== "ok") throw new Error("esperava a ficha");
    expect(r.ficha.identidade.identity.storeName).toBe("Loja Velha");
    adiada.soltar(HIT);
    await umaVolta();
  });

  it("ficha ainda FRESCA (< 60 s) não dispara revalidação nenhuma", async () => {
    const { adiada, waitUntil, d } = montar(-(CACHE_FRESCO_MS - 1));
    expect((await visitar(d)).tipo).toBe("ok");
    expect(adiada.fn).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("ficha passada de 1 h não é servida: a visita espera (e falha fechada se a caderneta falhar)", async () => {
    espiarLog();
    const { adiada, waitUntil, d } = montar(-CACHE_STALE_MAX_MS);
    const emCurso = visitar(d);
    expect(await ouPreso(emCurso)).toBe(PRESO);
    adiada.soltar({ tipo: "erro" });
    expect(cabecalho(await emCurso, "x-ikcous-porteiro")).toBe(
      "banco-indisponivel",
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("a revalidação de fundo que falha abre o recuo de 30 s (a promessa entregue nunca rejeita)", async () => {
    espiarLog();
    const { adiada, cache, entregues, relogio, d } = montar();
    await visitar(d);
    adiada.soltar({ tipo: "erro" });
    await expect(Promise.all(entregues)).resolves.toBeDefined();
    expect(cache.get("loja-alfa.exemplo")?.recuo?.ate).toBe(
      RECUO_APOS_FALHA_MS,
    );
    relogio.agora += RECUO_APOS_FALHA_MS - 1;
    const noRecuo = await visitar(d);
    if (noRecuo.tipo !== "ok") throw new Error("esperava a ficha velha");
    expect(noRecuo.caderneta).toBe("erro");
    expect(adiada.fn).toHaveBeenCalledTimes(1);
  });

  it("loja que ADORMECEU: a revalidação vale para a PRÓXIMA visita (a ficha velha sai)", async () => {
    const { adiada, cache, entregues, d } = montar();
    const primeira = await visitar(d);
    expect(primeira.tipo).toBe("ok");
    adiada.soltar({
      tipo: "fora-do-ar",
      estado: "adormecida",
      ref: REF,
      nome: "Loja Alfa",
    });
    await Promise.all(entregues);
    expect(cache.has("loja-alfa.exemplo")).toBe(false);
    const proxima = await visitar(d);
    expect(cabecalho(proxima, "x-ikcous-porteiro")).toBe("adormecida");
    expect(adiada.fn).toHaveBeenCalledTimes(1);
  });

  // 26/11/2026: o "não achei" com ficha de até 1 h usa a MESMA reserva da
  // falha (a caderneta dizendo zero linhas para a frota inteira não pode
  // fechar todas as lojas). Os casos em detalhe estão em
  // `porteiro-nao-achei-com-ficha-usa-a-reserva.test.ts`.
  it("loja que SAIU da caderneta (miss): a ficha fica na reserva; passada 1 h, o 'não achei' vale e ela nunca reaparece em segundo plano", async () => {
    espiarLog();
    const { adiada, cache, entregues, relogio, waitUntil, d } = montar();
    await visitar(d);
    adiada.soltar({ tipo: "miss" });
    await Promise.all(entregues);
    expect(cache.get("loja-alfa.exemplo")?.recuo?.caderneta).toBe("miss");
    const proxima = await visitar(d);
    if (proxima.tipo !== "ok") throw new Error("esperava a ficha da reserva");
    expect(proxima.caderneta).toBe("miss");
    // Passada 1 h da última resolução boa, a visita pergunta e ESPERA: a
    // vitrine velha não volta a aparecer enquanto a caderneta responde.
    relogio.agora = CACHE_STALE_MAX_MS - (CACHE_FRESCO_MS + 10_000);
    const emCurso = visitar(d);
    expect(await ouPreso(emCurso)).toBe(PRESO);
    adiada.soltar({ tipo: "miss" });
    expect(cabecalho(await emCurso, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("recuo vencido: a visita sai na hora com o último estado conhecido (a falha) e revalida no fundo", async () => {
    espiarLog();
    const { adiada, cache, waitUntil, relogio, d } = montar();
    cache.set("loja-alfa.exemplo", {
      ficha: fichaVelha("loja-alfa.exemplo"),
      quando: -(CACHE_FRESCO_MS + 10_000),
      caderneta: "hit",
      recuo: { ate: 0, caderneta: "erro", versaoCaderneta: 1 },
    });
    relogio.agora = 1;
    const r = await ouPreso(visitar(d));
    if (r === PRESO || r.tipo !== "ok") throw new Error("esperava a ficha");
    expect(r.caderneta).toBe("erro");
    expect(r.versaoCaderneta).toBe(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    adiada.soltar(HIT);
    await umaVolta();
  });
});

// ─── C) a falha deixa rastro no log, sem segredo e sem inundar ─────────────

describe("porteiro — falha da caderneta escreve UM log curto por host por recuo", () => {
  function semSegredo(espiao: ReturnType<typeof espiarLog>) {
    const tudo = JSON.stringify(espiao.mock.calls);
    expect(tudo).not.toContain(AMBIENTE.IKCOUS_FROTA_CHAVE);
    expect(tudo).not.toContain(AMBIENTE.IKCOUS_FROTA_APIKEY);
    expect(tudo).not.toContain("principal.supabase.co");
    expect(tudo).not.toContain("sb_publishable_a");
    expect(tudo).not.toContain(ORIGEM);
  }

  it("sem ficha: 5 visitas simultâneas + visitas no recuo = 1 log; vencido o recuo, nova falha = 2º log", async () => {
    const espiao = espiarLog();
    let agora = 0;
    const adiada = cadernetaAdiada();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: adiada.fn,
      cache: new Map(),
      cacheSemLoja: new Map(),
      resolucoesEmVoo: new Map(),
      agora: () => agora,
    };
    const emCurso = Array.from({ length: 5 }, () => visitar(d));
    await umaVolta();
    agora += 1_234;
    adiada.soltar({ tipo: "erro" });
    await Promise.all(emCurso);
    await visitar(d);
    expect(espiao).toHaveBeenCalledTimes(1);
    const linha = String(espiao.mock.calls[0]?.[0]);
    expect(linha).toContain("[porteiro]");
    expect(linha).toContain("loja-alfa.exemplo");
    expect(linha).toContain("etapa=caderneta");
    expect(linha).toContain("ms=1234");
    semSegredo(espiao);

    agora += RECUO_SEM_FICHA_MS;
    const outra = visitar(d);
    await umaVolta();
    adiada.soltar({ tipo: "erro" });
    await outra;
    expect(espiao).toHaveBeenCalledTimes(2);
  });

  it("com ficha velha (na hora e no fundo): 1 log por recuo, apontando a etapa do banco da loja quando é ele que falha", async () => {
    const espiao = espiarLog();
    const cache = new Map<string, EntradaCachePorteiro>();
    cache.set("loja-alfa.exemplo", {
      ficha: fichaVelha("loja-alfa.exemplo"),
      quando: -(CACHE_FRESCO_MS + 1),
      caderneta: "hit",
    });
    const entregues: Promise<unknown>[] = [];
    const d: DependenciasPorteiro = {
      // A caderneta responde, mas o banco da loja cai.
      fetchImpl: fetchProibido,
      resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(async () => HIT),
      cache,
      resolucoesEmVoo: new Map(),
      waitUntil: (p) => {
        entregues.push(p);
      },
      agora: () => 0,
    };
    await visitar(d);
    await Promise.all(entregues);
    await visitar(d);
    await visitar(d);
    expect(espiao).toHaveBeenCalledTimes(1);
    const linha = String(espiao.mock.calls[0]?.[0]);
    expect(linha).toContain("loja-alfa.exemplo");
    expect(linha).toContain("etapa=banco-da-loja");
    expect(linha).toContain("caderneta=hit");
    semSegredo(espiao);
  });

  it("sucesso e decisões (miss, fora do ar) não escrevem log de falha", async () => {
    const espiao = espiarLog();
    for (const resultado of [
      { tipo: "miss" },
      { tipo: "fora-do-ar", estado: "encerrada", ref: REF, nome: "X" },
    ] as ResultadoCaderneta[])
      await visitar({
        fetchImpl: fetchProibido,
        resolverNaCaderneta: vi.fn<ResolverLojaNaCaderneta>(
          async () => resultado,
        ),
        cache: new Map(),
        cacheSemLoja: new Map(),
        agora: () => 0,
      });
    expect(espiao).not.toHaveBeenCalled();
  });
});
