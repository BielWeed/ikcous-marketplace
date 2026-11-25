// Caça por mutação (25/11/2026) em `src/hospedagem/porteiro.ts`. Cada caso nasceu
// de um defeito de uma linha plantado de propósito que nenhum dos ~17 testes
// `porteiro-*` derrubava. Em linguagem de loja: o endereço de OUTRA loja que
// só termina igual ao da loja não pode passar por ela; a chave de serviço
// nunca vira conexão; o banco que manda um número no lugar de "sim/não" fecha a
// loja; o corpo da leitura do banco tem teto EXATO de 256 KiB; e as janelas de
// cache (60 s da ficha, 1 h de reserva, 10 min do mapa) valem no milissegundo.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_FRESCO_MS,
  CACHE_MAPA_FRESCO_MS,
  CACHE_MAPA_STALE_MAX_MS,
  CACHE_STALE_MAX_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
  decidirConcordancia,
  montarFicha,
  obterFichaValidada,
  resolverConexao,
  respostaManutencao,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCacheMapa,
  EntradaCachePorteiro,
  ResolverLojaNaCaderneta,
} from "@/hospedagem/porteiro";
import { parseStoreIdentity } from "@/lib/storeIdentity";

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);
const HOST = "loja-a.exemplo.com";
const CHAVE = "sb_publishable_do_projeto";

function jwtDeTeste(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.assinatura`;
}

function asset(name: string, width?: number, height?: number) {
  return {
    path: `v1/${HASH}/${name}`,
    sha256: HASH,
    media_type: "image/png",
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function criarIdentidade() {
  const header = asset("header.png");
  return parseStoreIdentity(
    {
      store_name: "Doces da Vovó Maria",
      store_city: null,
      store_state: null,
      primary_color: "#123456",
      secondary_color: "#abcdef",
      accent_color: "#fedcba",
      logo_url: `${SUPA}/storage/v1/object/public/branding/${header.path}`,
      branding_assets: {
        version: 1,
        originals: [header],
        header,
        loader: header,
        favicon: asset("favicon.png"),
        apple_touch: asset("apple.png", 180, 180),
        icon_192: asset("icon192.png", 192, 192),
        icon_512: asset("icon512.png", 512, 512),
        maskable_512: asset("maskable.png", 512, 512),
        og: asset("og.png", 1200, 630),
      },
    },
    SUPA,
  );
}

const IDENTIDADE = criarIdentidade();
const CONFIGURACAO = {
  mpPublicKey: null,
  vapidPublicKey: null,
  pagamentoOnline: false,
  manutencao: false,
};
const CONEXAO = {
  supabaseUrl: SUPA,
  publishableKey: CHAVE,
  origem: "projeto" as const,
};

const AMBIENTE: AmbientePorteiro = {
  VITE_SUPABASE_URL: SUPA,
  VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE,
  VERCEL_ENV: "production",
};

const AMBIENTE_FROTA = {
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_da_principal",
  IKCOUS_FROTA_CHAVE: "segredo-da-frota",
};

const linhaConfig = (extra: Record<string, unknown> = {}) => ({
  dominio_publico: HOST,
  mp_public_key: null,
  vapid_public_key: null,
  pagamento_online: false,
  manutencao: false,
  ...extra,
});

const json = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function criarFicha() {
  return montarFicha({
    host: HOST,
    identity: IDENTIDADE,
    publicUrl: `https://${HOST}`,
    conexao: CONEXAO,
    configuracao: CONFIGURACAO,
  });
}

interface Chamada {
  url: string;
  init: RequestInit | undefined;
}

function criarDeps(
  atender: (url: string, init: RequestInit | undefined) => Promise<Response>,
  relogio = { t: 1_000_000_000 },
) {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    chamadas.push({ url, init });
    return atender(url, init);
  }) as typeof fetch;
  const deps: DependenciasPorteiro = {
    fetchImpl,
    cache: new Map<string, EntradaCachePorteiro>(),
    cacheMapa: new Map<string, EntradaCacheMapa>(),
    lerIdentidade: (async () =>
      IDENTIDADE) as unknown as DependenciasPorteiro["lerIdentidade"],
    agora: () => relogio.t,
  };
  return { deps, chamadas, relogio };
}

const pedido = (caminho = "/") => new Request(`https://${HOST}${caminho}`);

async function ler(deps: DependenciasPorteiro, ambiente = AMBIENTE) {
  return obterFichaValidada(pedido(), ambiente, deps);
}

function motivoDe(resultado: Awaited<ReturnType<typeof ler>>) {
  expect(resultado.tipo).toBe("manutencao");
  return resultado.tipo === "manutencao"
    ? resultado.resposta.headers.get("x-ikcous-porteiro")
    : null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolverConexao — o caminho do próprio projeto", () => {
  it("chave de serviço (service_role) no ambiente nunca vira conexão", async () => {
    const resultado = await resolverConexao(HOST, {
      VITE_SUPABASE_URL: SUPA,
      VITE_SUPABASE_PUBLISHABLE_KEY: jwtDeTeste("service_role"),
    });

    expect(resultado).toEqual({ conexao: null, caderneta: "ausente" });
  });

  it("endereço do banco vazio no ambiente: sem conexão", async () => {
    const resultado = await resolverConexao(HOST, {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE,
    });

    expect(resultado).toEqual({ conexao: null, caderneta: "ausente" });
  });
});

describe("resolverConexao — a caderneta só é perguntada com as TRÊS variáveis", () => {
  const hit: ResolverLojaNaCaderneta = async () => ({
    tipo: "hit",
    conexao: {
      supabaseUrl: "https://frota-encontrou.supabase.co",
      publishableKey: "sb_publishable_da_frota",
      origem: "caderneta",
    },
  });

  it.each([
    ["endereço da frota vazio", { ...AMBIENTE_FROTA, IKCOUS_FROTA_URL: "" }],
    [
      "chave pública da frota vazia",
      { ...AMBIENTE_FROTA, IKCOUS_FROTA_APIKEY: "" },
    ],
    ["segredo da frota vazio", { ...AMBIENTE_FROTA, IKCOUS_FROTA_CHAVE: "" }],
  ])(
    "%s: a caderneta nem é chamada e vale o projeto",
    async (_rotulo, frota) => {
      const caderneta = vi.fn(hit);

      const resultado = await resolverConexao(
        HOST,
        { ...AMBIENTE, ...frota },
        caderneta,
      );

      expect(caderneta).not.toHaveBeenCalled();
      expect(resultado.caderneta).toBe("ausente");
      expect(resultado.conexao?.origem).toBe("projeto");
    },
  );
});

describe("decidirConcordancia — o host precisa SER o domínio, não só terminar nele", () => {
  const decidir = (
    host: string,
    dominioPublico: string | null,
    vercelEnv?: string,
  ) =>
    decidirConcordancia({
      host,
      dominioPublico,
      vercelEnv,
      dominioPrincipal: undefined,
    });

  it("domínio cadastrado em caixa alta ainda concorda com o host (minúsculo)", () => {
    expect(decidir("loja-a.exemplo.com", "LOJA-A.Exemplo.com")).toBe("ok");
  });

  it("host que apenas TERMINA com o domínio da loja ('evil-loja-a.exemplo.com') não concorda", () => {
    expect(decidir("evil-loja-a.exemplo.com", "loja-a.exemplo.com")).toBe(
      "discorda",
    );
    expect(decidir("loja-a.exemplo.com.evil.com", "loja-a.exemplo.com")).toBe(
      "discorda",
    );
  });

  it("em produção só o sufixo '.vercel.app' (com o ponto) é encaminhado; 'meuvercel.app' é recusado", () => {
    expect(decidir("loja.vercel.app", "loja-a.exemplo.com", "production")).toBe(
      "encaminha",
    );
    expect(decidir("meuvercel.app", "loja-a.exemplo.com", "production")).toBe(
      "discorda",
    );
  });
});

describe("montarFicha — o endereço público entra na ficha como veio", () => {
  it("publicUrl com protocolo e porta do ensaio local é preservado", async () => {
    const ficha = await montarFicha({
      host: "LOJA-A.localhost",
      identity: IDENTIDADE,
      publicUrl: "http://loja-a.localhost:4310",
      conexao: CONEXAO,
      configuracao: CONFIGURACAO,
    });

    expect(ficha.identidade.publicUrl).toBe("http://loja-a.localhost:4310");
    expect(ficha.host).toBe("loja-a.localhost");
  });
});

describe("respostaManutencao — a página recarrega sozinha a cada 30 s", () => {
  it("o corpo traz o refresh de 30 segundos e o status é 503 sem cache", async () => {
    const resposta = respostaManutencao("sem-loja", "ausente");

    expect(resposta.status).toBe(503);
    expect(await resposta.text()).toContain(
      '<meta http-equiv="refresh" content="30">',
    );
  });
});

describe("leitura do banco da loja — a consulta que o porteiro faz", () => {
  it("pede a linha 1, no máximo 2 linhas, sem seguir redirecionamento e sem credenciais", async () => {
    const { deps, chamadas } = criarDeps(async () => json([linhaConfig()]));

    await ler(deps);

    const config = chamadas.find((c) => c.url.includes("/v_store_config"));
    expect(config?.url).toBe(
      `${SUPA}/rest/v1/v_store_config?select=${SELECT_CONFIGURACAO_PUBLICA}&id=eq.1&limit=2`,
    );
    expect(config?.init?.redirect).toBe("error");
    expect(config?.init?.credentials).toBe("omit");
  });

  it.each([
    ["duas linhas", [linhaConfig(), linhaConfig()]],
    ["nenhuma linha", []],
  ])("%s: loja fechada com banco-indisponivel", async (_r, corpo) => {
    const { deps } = criarDeps(async () => json(corpo));

    expect(motivoDe(await ler(deps))).toBe("banco-indisponivel");
  });

  it.each([
    ["pagamento_online como texto", { pagamento_online: "sim" }],
    ["manutencao como número", { manutencao: 1 }],
  ])("%s: fecha a loja, nunca vira verdadeiro", async (_r, extra) => {
    const { deps } = criarDeps(async () => json([linhaConfig(extra)]));

    expect(motivoDe(await ler(deps))).toBe("banco-indisponivel");
  });
});

describe("leitura do banco da loja — teto EXATO de 256 KiB no corpo", () => {
  const TETO = 256 * 1024;
  const corpoComBytes = (bytes: number) => {
    const base = JSON.stringify([linhaConfig()]);
    return base + " ".repeat(bytes - base.length);
  };

  it("pelo fluxo de bytes: exatamente 262144 passa; 262145 fecha a loja", async () => {
    const exato = criarDeps(async () => new Response(corpoComBytes(TETO)));
    expect((await ler(exato.deps)).tipo).toBe("ok");

    const passou = criarDeps(async () => new Response(corpoComBytes(TETO + 1)));
    expect(motivoDe(await ler(passou.deps))).toBe("banco-indisponivel");
  });

  it("resposta sem fluxo (só texto): exatamente 262144 passa; 262145 fecha a loja", async () => {
    const semFluxo = (texto: string) =>
      ({
        ok: true,
        status: 200,
        body: null,
        text: async () => texto,
      }) as unknown as Response;

    const exato = criarDeps(async () => semFluxo(corpoComBytes(TETO)));
    expect((await ler(exato.deps)).tipo).toBe("ok");

    const passou = criarDeps(async () => semFluxo(corpoComBytes(TETO + 1)));
    expect(motivoDe(await ler(passou.deps))).toBe("banco-indisponivel");
  });

  it("corpo que estoura o teto tem o fluxo CANCELADO (o resto não é baixado)", async () => {
    const cancelado = vi.fn();
    const fluxo = new ReadableStream<Uint8Array>({
      start(controle) {
        controle.enqueue(new Uint8Array(TETO + 1).fill(32));
      },
      cancel: cancelado,
    });
    const { deps } = criarDeps(async () => new Response(fluxo));

    expect(motivoDe(await ler(deps))).toBe("banco-indisponivel");
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelado).toHaveBeenCalledOnce();
  });
});

describe("leitura do banco da loja — o prazo de 10 s aborta o pedido", () => {
  it("o sinal só é abortado quando completam 10000 ms, e a loja fecha", async () => {
    vi.useFakeTimers();
    let sinal: AbortSignal | undefined;
    const { deps } = criarDeps(async (url, init) => {
      if (url.includes("/v_store_config")) {
        sinal = init?.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }
      return json([]);
    });

    const leitura = ler(deps);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sinal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(sinal?.aborted).toBe(true);
    expect(motivoDe(await leitura)).toBe("banco-indisponivel");
  });
});

describe("rótulo da caderneta nas respostas de falha", () => {
  it("a caderneta deu 'hit' e depois o banco da loja caiu: a resposta diz 'hit', não 'ausente'", async () => {
    const caderneta: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: CONEXAO,
    });
    const { deps } = criarDeps(async () => {
      throw new TypeError("rede caiu");
    });

    const resultado = await ler(
      { ...deps, resolverNaCaderneta: caderneta },
      { ...AMBIENTE, ...AMBIENTE_FROTA },
    );

    expect(motivoDe(resultado)).toBe("banco-indisponivel");
    expect(
      resultado.tipo === "manutencao" &&
        resultado.resposta.headers.get("x-ikcous-caderneta"),
    ).toBe("hit");
  });

  it("a caderneta lançou um erro que não é o dela: a resposta diz 'ausente'", async () => {
    const caderneta: ResolverLojaNaCaderneta = async () => {
      throw new Error("explodiu por dentro");
    };
    const { deps } = criarDeps(async () => json([linhaConfig()]));

    const resultado = await ler(
      { ...deps, resolverNaCaderneta: caderneta },
      { ...AMBIENTE, ...AMBIENTE_FROTA },
    );

    expect(motivoDe(resultado)).toBe("banco-indisponivel");
    expect(
      resultado.tipo === "manutencao" &&
        resultado.resposta.headers.get("x-ikcous-caderneta"),
    ).toBe("ausente");
  });
});

describe("cache da ficha — as janelas valem no milissegundo", () => {
  async function comFichaNoCache(idade: number, rede: "boa" | "caida") {
    const ficha = await criarFicha();
    const { deps, chamadas, relogio } = criarDeps(async () => {
      if (rede === "caida") throw new TypeError("rede caiu");
      return json([linhaConfig()]);
    });
    deps.cache.set(HOST, {
      ficha,
      quando: relogio.t - idade,
      caderneta: "hit",
    });
    return { deps, chamadas };
  }

  it("com 59999 ms de idade a ficha vem do cache, sem tocar a rede", async () => {
    expect(CACHE_FRESCO_MS).toBe(60_000);
    const { deps, chamadas } = await comFichaNoCache(59_999, "boa");

    expect((await ler(deps)).tipo).toBe("ok");
    expect(chamadas).toHaveLength(0);
  });

  it("com EXATAMENTE 60000 ms o cache já não é fresco: lê o banco de novo", async () => {
    const { deps, chamadas } = await comFichaNoCache(60_000, "boa");

    expect((await ler(deps)).tipo).toBe("ok");
    expect(chamadas.length).toBeGreaterThan(0);
  });

  it("rede caída: com 3599999 ms a ficha antiga ainda serve; com EXATAMENTE 3600000 ms a loja fecha", async () => {
    expect(CACHE_STALE_MAX_MS).toBe(3_600_000);

    const dentro = await comFichaNoCache(3_599_999, "caida");
    expect((await ler(dentro.deps)).tipo).toBe("ok");

    const fora = await comFichaNoCache(3_600_000, "caida");
    expect(motivoDe(await ler(fora.deps))).toBe("banco-indisponivel");
  });
});

describe("cache do mapa do site — 10 min fresco, 1 h de reserva, no milissegundo", () => {
  const ID_VELHO = "produto-velho";
  const ID_NOVO = "produto-novo";

  async function pedirMapa(idade: number, produtos: "bons" | "caidos") {
    const ficha = await criarFicha();
    const { deps, chamadas, relogio } = criarDeps(async (url) => {
      if (url.includes("/vw_produtos_public")) {
        if (produtos === "caidos") return new Response(null, { status: 500 });
        return json([{ id: ID_NOVO }]);
      }
      return json([linhaConfig()]);
    });
    deps.cache.set(HOST, { ficha, quando: relogio.t, caderneta: "hit" });
    deps.cacheMapa?.set(`${HOST}|${SUPA}`, {
      ids: [ID_VELHO],
      quando: relogio.t - idade,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resposta = await atenderPorteiro(
      pedido("/sitemap.xml"),
      AMBIENTE,
      deps,
    );
    return {
      resposta,
      corpo: await resposta.text(),
      consultouProdutos: chamadas.some((c) =>
        c.url.includes("/vw_produtos_public"),
      ),
    };
  }

  it("com 599999 ms o mapa vem do cache; com EXATAMENTE 600000 ms o catálogo é lido de novo", async () => {
    expect(CACHE_MAPA_FRESCO_MS).toBe(600_000);

    const fresco = await pedirMapa(599_999, "bons");
    expect(fresco.consultouProdutos).toBe(false);
    expect(fresco.corpo).toContain(ID_VELHO);

    const vencido = await pedirMapa(600_000, "bons");
    expect(vencido.consultouProdutos).toBe(true);
    expect(vencido.corpo).toContain(ID_NOVO);
    expect(vencido.corpo).not.toContain(ID_VELHO);
  });

  it("catálogo fora do ar: com 3599999 ms serve o último mapa bom ('stale'); com EXATAMENTE 3600000 ms só as páginas fixas ('estatico')", async () => {
    expect(CACHE_MAPA_STALE_MAX_MS).toBe(3_600_000);

    const dentro = await pedirMapa(3_599_999, "caidos");
    expect(dentro.resposta.headers.get("x-ikcous-mapa")).toBe("stale");
    expect(dentro.corpo).toContain(ID_VELHO);

    const fora = await pedirMapa(3_600_000, "caidos");
    expect(fora.resposta.headers.get("x-ikcous-mapa")).toBe("estatico");
    expect(fora.corpo).not.toContain(ID_VELHO);
  });
});

describe("manifest da loja montado pelo porteiro", () => {
  it("cor de fundo é a primária; ícones têm 'maskable' e 'monochrome'; tipo de conteúdo exato", async () => {
    const ficha = await criarFicha();
    const { deps, relogio } = criarDeps(async () => json([linhaConfig()]));
    deps.cache.set(HOST, { ficha, quando: relogio.t, caderneta: "hit" });

    const resposta = await atenderPorteiro(
      pedido("/manifest.webmanifest"),
      AMBIENTE,
      deps,
    );
    const manifest = await resposta.json();

    expect(resposta.headers.get("content-type")).toBe(
      "application/manifest+json; charset=utf-8",
    );
    expect(manifest.theme_color).toBe("#123456");
    expect(manifest.background_color).toBe("#123456");
    expect(manifest.icons.map((i: { purpose?: string }) => i.purpose)).toEqual([
      undefined,
      undefined,
      "maskable",
      "monochrome",
    ]);
  });
});
