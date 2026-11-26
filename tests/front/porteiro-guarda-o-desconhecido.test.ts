// O porteiro poupa a caderneta central (26/11/2026). Cada pergunta a ela custa
// ~80 ms de CPU no banco da principal (bcrypt na conferência da chave), e esse
// banco é o mesmo que atende a loja IKCOUS. Dois defeitos fechados aqui:
//
//   A) host que a caderneta NÃO conhece (alias antigo, `www.` não cadastrado,
//      robô com Host inventado) voltava 503 sem-loja e nunca era guardado: cada
//      pedido virava uma pergunta cara. Agora o "não achei" DEFINITIVO (miss)
//      fica guardado 60 s por host normalizado; erro/timeout/resposta malformada
//      NUNCA. Todo cache em memória tem teto de entradas (Host aleatório não
//      enche a memória da instância).
//   B) caderneta LENTA ou fora do ar: passado o fresco de 60 s, cada visita
//      esperava o prazo e batia de novo no banco doente, e N pedidos
//      simultâneos do mesmo host viravam N perguntas. Agora a falha servida com
//      a ficha velha adia a próxima tentativa daquele host por um recuo curto,
//      e pedidos simultâneos do mesmo host compartilham UMA resolução.
//
// Nunca rede de verdade: caderneta injetada e `fetch` dublê.
import { describe, expect, it, vi } from "vitest";

import {
  CACHE_SEM_LOJA_MS,
  CACHE_STALE_MAX_MS,
  RECUO_APOS_FALHA_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  TETO_ENTRADAS_CACHE,
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

/** Banco da loja (identidade + configuração pública), contando os pedidos. */
function bancoDaLoja(dominioPublico: string) {
  const pedidos: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    pedidos.push(url.toString());
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
          : [linhaDaLoja("Loja Alfa")];
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`pedido não mapeado no dublê: ${url.toString()}`);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, pedidos };
}

/** `fetch` que reprova o teste se alguém tocar a rede. */
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

function cadernetaFixa(resultado: ResultadoCaderneta) {
  return vi.fn<ResolverLojaNaCaderneta>(async () => resultado);
}

/** Caderneta cuja resposta só sai quando o teste soltar (pedido em voo). */
function cadernetaAdiada() {
  const soltas: Array<(r: ResultadoCaderneta) => void> = [];
  const falhas: Array<(e: unknown) => void> = [];
  const fn = vi.fn<ResolverLojaNaCaderneta>(
    () =>
      new Promise<ResultadoCaderneta>((resolve, reject) => {
        soltas.push(resolve);
        falhas.push(reject);
      }),
  );
  return {
    fn,
    soltar: (r: ResultadoCaderneta) => {
      for (const s of soltas) s(r);
    },
    rejeitar: (e: unknown) => {
      for (const f of falhas) f(e);
    },
  };
}

const umaVolta = () => new Promise<void>((r) => setTimeout(r, 0));

const pedido = (endereco: string) => new Request(endereco);

function cabecalho(r: ResultadoObterFicha, nome: string): string | null {
  if (r.tipo !== "manutencao") throw new Error(`esperava 503, veio ${r.tipo}`);
  return r.resposta.headers.get(nome);
}

function fichaVelha(host: string): EntradaCachePorteiro["ficha"] {
  return {
    host,
    identidade: { publicUrl: "https://velha.exemplo" },
  } as unknown as EntradaCachePorteiro["ficha"];
}

// ─── A) o "não achei" da caderneta fica guardado 60 s ───────────────────────

describe("porteiro — host desconhecido da caderneta (miss) é guardado 60 s", () => {
  it("o mesmo host 2x dentro de 60 s -> 1 pergunta; passados 60 s -> 2", async () => {
    let agora = 1_000_000;
    const caderneta = cadernetaFixa({ tipo: "miss" });
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => agora,
    };

    const primeira = await obterFichaValidada(
      pedido("https://antiga.vercel.app/"),
      AMBIENTE,
      d,
    );
    expect(cabecalho(primeira, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cabecalho(primeira, "x-ikcous-caderneta")).toBe("miss");

    agora += CACHE_SEM_LOJA_MS - 1;
    // Mesmo host em outra grafia (maiúsculas, porta, ponto de FQDN): a chave
    // é o host JÁ normalizado.
    const segunda = await obterFichaValidada(
      pedido("https://ANTIGA.vercel.app.:8443/qualquer"),
      AMBIENTE,
      d,
    );
    expect(cabecalho(segunda, "x-ikcous-porteiro")).toBe("sem-loja");
    expect(cabecalho(segunda, "x-ikcous-caderneta")).toBe("miss");
    expect((segunda as { resposta: Response }).resposta.status).toBe(503);
    expect(caderneta).toHaveBeenCalledTimes(1);
    expect([...cacheSemLoja.keys()]).toEqual(["antiga.vercel.app"]);

    agora += 1;
    await obterFichaValidada(pedido("https://antiga.vercel.app/"), AMBIENTE, d);
    expect(caderneta).toHaveBeenCalledTimes(2);
    expect(CACHE_SEM_LOJA_MS).toBe(60_000);
  });

  it("a marca de versão da reserva (função antiga) sai igual na resposta guardada", async () => {
    const caderneta = cadernetaFixa({ tipo: "miss", versao: 1 });
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja: new Map(),
      agora: () => 0,
    };
    const a = await obterFichaValidada(
      pedido("https://x.exemplo/"),
      AMBIENTE,
      d,
    );
    const b = await obterFichaValidada(
      pedido("https://x.exemplo/"),
      AMBIENTE,
      d,
    );
    expect(cabecalho(a, "x-ikcous-caderneta-versao")).toBe("1");
    expect(cabecalho(b, "x-ikcous-caderneta-versao")).toBe("1");
    expect(caderneta).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["erro da RPC (HTTP/rede/timeout)", { tipo: "erro" } as ResultadoCaderneta],
    [
      "chave anômala (sem-loja, mas NÃO é 'não achei')",
      {
        tipo: "hit",
        conexao: {
          supabaseUrl: ORIGEM,
          publishableKey: "chave-service-role-nao-publica",
          origem: "caderneta",
        },
      } as ResultadoCaderneta,
    ],
  ])("%s NUNCA é guardado como 'não achei'", async (_nome, resultado) => {
    const caderneta = cadernetaFixa(resultado);
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => 0,
    };
    await obterFichaValidada(pedido("https://y.exemplo/"), AMBIENTE, d);
    await obterFichaValidada(pedido("https://y.exemplo/"), AMBIENTE, d);
    expect(cacheSemLoja.size).toBe(0);
    expect(caderneta).toHaveBeenCalledTimes(2);
  });

  it("caderneta que LANÇA (imprevisto) também nunca é guardada", async () => {
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => {
      throw new Error("imprevisto");
    });
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => 0,
    };
    const r = await obterFichaValidada(
      pedido("https://z.exemplo/"),
      AMBIENTE,
      d,
    );
    expect(cabecalho(r, "x-ikcous-porteiro")).toBe("banco-indisponivel");
    await obterFichaValidada(pedido("https://z.exemplo/"), AMBIENTE, d);
    expect(cacheSemLoja.size).toBe(0);
    expect(caderneta).toHaveBeenCalledTimes(2);
  });

  it("loja ATIVA com ficha fresca nunca recebe 503 por causa do cache negativo", async () => {
    const cache = new Map<string, EntradaCachePorteiro>();
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    cache.set("loja-alfa.exemplo", {
      ficha: fichaVelha("loja-alfa.exemplo"),
      quando: 0,
      caderneta: "hit",
    });
    cacheSemLoja.set("loja-alfa.exemplo", { quando: 0 });
    const r = await obterFichaValidada(
      pedido("https://loja-alfa.exemplo/"),
      AMBIENTE,
      {
        fetchImpl: fetchProibido,
        resolverNaCaderneta: cadernetaFixa({ tipo: "miss" }),
        cache,
        cacheSemLoja,
        agora: () => 10,
      },
    );
    expect(r.tipo).toBe("ok");
  });

  it("loja recém-cadastrada espera no máximo 60 s; quando a caderneta a acha, o 'não achei' sai", async () => {
    let agora = 0;
    let resposta: ResultadoCaderneta = { tipo: "miss" };
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => resposta);
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const banco = bancoDaLoja("loja-alfa.exemplo");
    const d: DependenciasPorteiro = {
      fetchImpl: banco.fetchImpl,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => agora,
    };
    const antes = await obterFichaValidada(
      pedido("https://loja-alfa.exemplo/"),
      AMBIENTE,
      d,
    );
    expect(antes.tipo).toBe("manutencao");
    resposta = HIT;
    agora += CACHE_SEM_LOJA_MS;
    const depois = await obterFichaValidada(
      pedido("https://loja-alfa.exemplo/"),
      AMBIENTE,
      d,
    );
    expect(depois.tipo).toBe("ok");
    expect(cacheSemLoja.has("loja-alfa.exemplo")).toBe(false);
  });

  it("sem o mapa injetado (teste/chamada avulsa) segue como antes: cada pedido pergunta", async () => {
    const caderneta = cadernetaFixa({ tipo: "miss" });
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
    };
    await obterFichaValidada(pedido("https://w.exemplo/"), AMBIENTE, d);
    await obterFichaValidada(pedido("https://w.exemplo/"), AMBIENTE, d);
    expect(caderneta).toHaveBeenCalledTimes(2);
  });
});

// ─── teto de entradas: Host aleatório não enche a memória ───────────────────

describe("porteiro — todo cache em memória tem teto e descarta o mais antigo", () => {
  it(`hosts desconhecidos: no teto (${TETO_ENTRADAS_CACHE}) o primeiro sai e o último fica`, async () => {
    const caderneta = cadernetaFixa({ tipo: "miss" });
    const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache: new Map(),
      cacheSemLoja,
      agora: () => 0,
    };
    for (let i = 0; i <= TETO_ENTRADAS_CACHE; i += 1)
      await obterFichaValidada(
        pedido(`https://robo-${i}.exemplo/`),
        AMBIENTE,
        d,
      );
    expect(cacheSemLoja.size).toBe(TETO_ENTRADAS_CACHE);
    expect(cacheSemLoja.has("robo-0.exemplo")).toBe(false);
    expect(cacheSemLoja.has(`robo-${TETO_ENTRADAS_CACHE}.exemplo`)).toBe(true);
    // O descartado pergunta de novo; o que ficou, não.
    const antes = caderneta.mock.calls.length;
    await obterFichaValidada(pedido("https://robo-0.exemplo/"), AMBIENTE, d);
    expect(caderneta.mock.calls.length).toBe(antes + 1);
    await obterFichaValidada(
      pedido(`https://robo-${TETO_ENTRADAS_CACHE}.exemplo/`),
      AMBIENTE,
      d,
    );
    expect(caderneta.mock.calls.length).toBe(antes + 1);
    expect(TETO_ENTRADAS_CACHE).toBe(1000);
  });

  it("ficha da loja: cheio no teto, uma loja nova entra e a mais antiga sai", async () => {
    const cache = new Map<string, EntradaCachePorteiro>();
    for (let i = 0; i < TETO_ENTRADAS_CACHE; i += 1)
      cache.set(`velha-${i}.exemplo`, {
        ficha: fichaVelha(`velha-${i}.exemplo`),
        quando: 0,
        caderneta: "hit",
      });
    const banco = bancoDaLoja("loja-alfa.exemplo");
    const r = await obterFichaValidada(
      pedido("https://loja-alfa.exemplo/"),
      AMBIENTE,
      {
        fetchImpl: banco.fetchImpl,
        resolverNaCaderneta: cadernetaFixa(HIT),
        cache,
        agora: () => 0,
      },
    );
    expect(r.tipo).toBe("ok");
    expect(cache.size).toBe(TETO_ENTRADAS_CACHE);
    expect(cache.has("velha-0.exemplo")).toBe(false);
    expect(cache.has("loja-alfa.exemplo")).toBe(true);
  });

  it("decisão fora-do-ar: cheio no teto, a nova entra e a mais antiga sai", async () => {
    const cacheForaDoAr = new Map<string, EntradaCacheForaDoAr>();
    for (let i = 0; i < TETO_ENTRADAS_CACHE; i += 1)
      cacheForaDoAr.set(`dormindo-${i}.exemplo`, {
        loja: { estado: "adormecida", nome: "X", ref: REF },
        quando: 0,
      });
    await obterFichaValidada(pedido("https://loja-bela.exemplo/"), AMBIENTE, {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: cadernetaFixa({
        tipo: "fora-do-ar",
        estado: "adormecida",
        ref: REF,
        nome: "Loja Bela",
      }),
      cache: new Map(),
      cacheForaDoAr,
      agora: () => 0,
    });
    expect(cacheForaDoAr.size).toBe(TETO_ENTRADAS_CACHE);
    expect(cacheForaDoAr.has("dormindo-0.exemplo")).toBe(false);
    expect(cacheForaDoAr.has("loja-bela.exemplo")).toBe(true);
  });
});

// ─── B1) recuo depois da falha servida com a ficha velha ────────────────────

describe("porteiro — falha da caderneta com ficha velha adia a próxima tentativa", () => {
  function montar(resultadoInicial: ResultadoCaderneta, quandoDaFicha: number) {
    let resposta = resultadoInicial;
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => resposta);
    const cache = new Map<string, EntradaCachePorteiro>();
    cache.set("loja-alfa.exemplo", {
      ficha: fichaVelha("loja-alfa.exemplo"),
      quando: quandoDaFicha,
      caderneta: "hit",
    });
    const relogio = { agora: 0 };
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache,
      agora: () => relogio.agora,
    };
    const trocar = (r: ResultadoCaderneta) => {
      resposta = r;
    };
    return { caderneta, cache, relogio, d, trocar };
  }
  const visita = (d: DependenciasPorteiro, caminho = "/") =>
    obterFichaValidada(
      pedido(`https://loja-alfa.exemplo${caminho}`),
      AMBIENTE,
      d,
    );

  it("dentro do recuo serve a ficha velha SEM perguntar; depois do recuo pergunta de novo", async () => {
    const { caderneta, relogio, d } = montar({ tipo: "erro" }, -70_000);

    const primeira = await visita(d);
    expect(primeira.tipo).toBe("ok");
    if (primeira.tipo !== "ok") throw new Error("inalcançável");
    expect(primeira.caderneta).toBe("erro");
    expect(caderneta).toHaveBeenCalledTimes(1);

    relogio.agora += RECUO_APOS_FALHA_MS - 1;
    const noRecuo = await visita(d, "/outra");
    expect(noRecuo.tipo).toBe("ok");
    if (noRecuo.tipo !== "ok") throw new Error("inalcançável");
    expect(noRecuo.caderneta).toBe("erro");
    expect(noRecuo.ficha.host).toBe("loja-alfa.exemplo");
    // `publicUrl` continua sendo a do pedido atual, nunca a guardada.
    expect(noRecuo.ficha.identidade.publicUrl).toBe(
      "https://loja-alfa.exemplo",
    );
    expect(caderneta).toHaveBeenCalledTimes(1);

    relogio.agora += 1;
    await visita(d);
    expect(caderneta).toHaveBeenCalledTimes(2);
    expect(RECUO_APOS_FALHA_MS).toBe(30_000);
  });

  it("a marca de versão da falha (reserva) segue durante o recuo", async () => {
    const { caderneta, relogio, d } = montar(
      { tipo: "erro", versao: 1 },
      -70_000,
    );
    await visita(d);
    relogio.agora += 1_000;
    const r = await visita(d);
    if (r.tipo !== "ok") throw new Error("esperava a ficha velha");
    expect(r.versaoCaderneta).toBe(1);
    expect(caderneta).toHaveBeenCalledTimes(1);
  });

  it("o recuo NUNCA estica a ficha velha além de 1 h: vencida a hora, pergunta (e cai em 503 se falhar)", async () => {
    // Ficha resolvida há 1 h menos 10 s: a falha serve a velha e abre um
    // recuo de 30 s, mas aos 10 s a ficha passa do teto de 1 h.
    const { caderneta, relogio, d } = montar(
      { tipo: "erro" },
      -(CACHE_STALE_MAX_MS - 10_000),
    );
    expect((await visita(d)).tipo).toBe("ok");
    relogio.agora += 10_000;
    const vencida = await visita(d);
    expect(cabecalho(vencida, "x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(caderneta).toHaveBeenCalledTimes(2);
  });

  it("depois do recuo, a caderneta que voltou renova a ficha e o recuo some", async () => {
    const banco = bancoDaLoja("loja-alfa.exemplo");
    const { caderneta, cache, relogio, d, trocar } = montar(
      { tipo: "erro" },
      -70_000,
    );
    const dComBanco = { ...d, fetchImpl: banco.fetchImpl };
    await visita(dComBanco);
    trocar(HIT);
    relogio.agora += RECUO_APOS_FALHA_MS;
    const r = await visita(dComBanco);
    if (r.tipo !== "ok") throw new Error("esperava ficha nova");
    expect(r.caderneta).toBe("hit");
    expect(r.ficha.identidade.identity.storeName).toBe("Loja Alfa");
    expect(cache.get("loja-alfa.exemplo")?.recuo).toBeUndefined();
    expect(cache.get("loja-alfa.exemplo")?.quando).toBe(relogio.agora);
    expect(caderneta).toHaveBeenCalledTimes(2);
  });

  it("falha SEM ficha velha não abre recuo: a próxima visita pergunta de novo", async () => {
    const caderneta = cadernetaFixa({ tipo: "erro" });
    const cache = new Map<string, EntradaCachePorteiro>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: caderneta,
      cache,
      agora: () => 0,
    };
    await visita(d);
    await visita(d);
    expect(caderneta).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("loja que adormece depois do recuo: a decisão fora-do-ar apaga a ficha velha (e o recuo junto)", async () => {
    const { cache, relogio, d, trocar } = montar({ tipo: "erro" }, -70_000);
    await visita(d);
    trocar({
      tipo: "fora-do-ar",
      estado: "adormecida",
      ref: REF,
      nome: "Loja Alfa",
    });
    relogio.agora += RECUO_APOS_FALHA_MS;
    const r = await visita(d);
    expect(cabecalho(r, "x-ikcous-porteiro")).toBe("adormecida");
    expect(cache.has("loja-alfa.exemplo")).toBe(false);
  });
});

// ─── B2) pedidos simultâneos do mesmo host: UMA resolução ───────────────────

describe("porteiro — pedidos simultâneos do mesmo host compartilham uma resolução", () => {
  it("5 pedidos (miss) -> 1 pergunta, os 5 recebem a mesma decisão, o mapa esvazia", async () => {
    const adiada = cadernetaAdiada();
    const resolucoesEmVoo = new Map<string, ResolucaoEmVoo>();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: adiada.fn,
      cache: new Map(),
      resolucoesEmVoo,
      agora: () => 0,
    };
    const emCurso = Array.from({ length: 5 }, (_, i) =>
      obterFichaValidada(
        pedido(`https://desconhecido.exemplo/p${i}`),
        AMBIENTE,
        d,
      ),
    );
    await umaVolta();
    expect(adiada.fn).toHaveBeenCalledTimes(1);
    expect(resolucoesEmVoo.size).toBe(1);
    adiada.soltar({ tipo: "miss" });
    const resultados = await Promise.all(emCurso);
    for (const r of resultados) {
      expect(cabecalho(r, "x-ikcous-porteiro")).toBe("sem-loja");
      expect(cabecalho(r, "x-ikcous-caderneta")).toBe("miss");
    }
    expect(resolucoesEmVoo.size).toBe(0);
  });

  it("5 pedidos (loja ativa) -> 1 pergunta e 1 leitura do banco; cada um com a SUA publicUrl", async () => {
    const adiada = cadernetaAdiada();
    const banco = bancoDaLoja("loja-alfa.exemplo");
    const cache = new Map<string, EntradaCachePorteiro>();
    const d: DependenciasPorteiro = {
      fetchImpl: banco.fetchImpl,
      resolverNaCaderneta: adiada.fn,
      cache,
      resolucoesEmVoo: new Map(),
      agora: () => 0,
    };
    const enderecos = [
      "https://loja-alfa.exemplo/",
      "https://loja-alfa.exemplo:8443/a",
      "https://LOJA-ALFA.exemplo/b",
      "http://loja-alfa.exemplo:3000/c",
      "https://loja-alfa.exemplo./d",
    ];
    const emCurso = enderecos.map(async (endereco) => ({
      endereco,
      r: await obterFichaValidada(pedido(endereco), AMBIENTE, d),
    }));
    await umaVolta();
    adiada.soltar(HIT);
    const resultados = await Promise.all(emCurso);
    expect(adiada.fn).toHaveBeenCalledTimes(1);
    // Identidade + configuração pública: UMA leitura de cada.
    expect(banco.pedidos).toHaveLength(2);
    for (const { endereco, r } of resultados) {
      if (r.tipo !== "ok") throw new Error(`${endereco} não veio ok`);
      expect(r.caderneta).toBe("hit");
      expect(r.ficha.host).toBe("loja-alfa.exemplo");
      expect(r.ficha.identidade.identity.storeName).toBe("Loja Alfa");
      const u = new URL(endereco);
      expect(r.ficha.identidade.publicUrl).toBe(`${u.protocol}//${u.host}`);
    }
    expect(cache.size).toBe(1);
  });

  it("hosts DIFERENTES nunca compartilham: cada um pergunta a sua loja", async () => {
    const adiada = cadernetaAdiada();
    const d: DependenciasPorteiro = {
      fetchImpl: fetchProibido,
      resolverNaCaderneta: adiada.fn,
      cache: new Map(),
      resolucoesEmVoo: new Map(),
      agora: () => 0,
    };
    const emCurso = ["a", "b", "c"].map((h) =>
      obterFichaValidada(pedido(`https://${h}.exemplo/`), AMBIENTE, d),
    );
    await umaVolta();
    expect(adiada.fn).toHaveBeenCalledTimes(3);
    expect(adiada.fn.mock.calls.map((c) => c[0]).sort()).toEqual([
      "a.exemplo",
      "b.exemplo",
      "c.exemplo",
    ]);
    adiada.soltar({ tipo: "miss" });
    await Promise.all(emCurso);
  });

  it.each([
    [
      "erro da RPC",
      (a: ReturnType<typeof cadernetaAdiada>) => a.soltar({ tipo: "erro" }),
    ],
    [
      "exceção imprevista",
      (a: ReturnType<typeof cadernetaAdiada>) => a.rejeitar(new Error("caiu")),
    ],
  ])(
    "%s na resolução compartilhada chega aos 5 e libera o mapa (a próxima pergunta de novo)",
    async (_nome, falhar) => {
      const adiada = cadernetaAdiada();
      const resolucoesEmVoo = new Map<string, ResolucaoEmVoo>();
      const d: DependenciasPorteiro = {
        fetchImpl: fetchProibido,
        resolverNaCaderneta: adiada.fn,
        cache: new Map(),
        resolucoesEmVoo,
        agora: () => 0,
      };
      const emCurso = Array.from({ length: 5 }, () =>
        obterFichaValidada(pedido("https://loja-alfa.exemplo/"), AMBIENTE, d),
      );
      await umaVolta();
      falhar(adiada);
      const resultados = await Promise.all(emCurso);
      for (const r of resultados)
        expect(cabecalho(r, "x-ikcous-porteiro")).toBe("banco-indisponivel");
      expect(adiada.fn).toHaveBeenCalledTimes(1);
      expect(resolucoesEmVoo.size).toBe(0);

      const depois = obterFichaValidada(
        pedido("https://loja-alfa.exemplo/"),
        AMBIENTE,
        d,
      );
      await umaVolta();
      expect(adiada.fn).toHaveBeenCalledTimes(2);
      adiada.soltar({ tipo: "miss" });
      await depois;
    },
  );

  it("encaminhamento compartilhado: cada pedido vai para o SEU caminho, nunca o do primeiro", async () => {
    // Alias *.vercel.app em produção, caderneta ausente (banco do projeto).
    const banco = bancoDaLoja("ickous-marketplace.vercel.app");
    const d: DependenciasPorteiro = {
      fetchImpl: banco.fetchImpl,
      cache: new Map(),
      resolucoesEmVoo: new Map(),
      agora: () => 0,
    };
    const ambiente: AmbientePorteiro = {
      VITE_SUPABASE_URL: ORIGEM,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      VERCEL_ENV: "production",
    };
    const alias = "https://ickous-marketplace-git-x-abc.vercel.app";
    const caminhos = ["/", "/product-detail?id=7", "/carrinho?x=1"];
    const resultados = await Promise.all(
      caminhos.map(async (caminho) => ({
        caminho,
        r: await obterFichaValidada(pedido(`${alias}${caminho}`), ambiente, d),
      })),
    );
    expect(banco.pedidos).toHaveLength(2);
    for (const { caminho, r } of resultados) {
      expect(cabecalho(r, "x-ikcous-porteiro")).toBe("encaminha");
      expect(cabecalho(r, "location")).toBe(
        `https://ickous-marketplace.vercel.app${caminho}`,
      );
    }
  });
});
