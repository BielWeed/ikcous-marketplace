// O contador de visitas LIGADO no `middleware` real (spec "visitas da loja",
// decisoes 3 e 4), com `fetch` dublê -- nunca rede de verdade. O que dói aqui:
//   - ISOLAMENTO: a entrada de uma loja so pode ser gravada no banco DA LOJA
//     do host que a recebeu (a conexao vem da ficha validada, nunca de outro
//     lugar) -- gravar na loja errada mistura o numero de duas lojistas;
//   - NUNCA ATRASA: uma gravacao que nunca responde nao pode segurar a pagina;
//   - so a PRODUCAO conta (a previa de desenvolvimento nao suja o banco);
//   - host que o banco desmente (503 discorda) nao conta, nem pelo robo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SELECT_CONFIGURACAO_PUBLICA } from "@/hospedagem/porteiro";
import middleware from "../../middleware";

const UA_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const UA_ROBO_WHATSAPP = "WhatsApp/2.23.20.0 A";

const NAVEGACAO = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "user-agent": UA_CHROME,
};

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
function identidadeFixture(nome: string, origin: string) {
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
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

// A identidade so aceita `https://<20 caracteres [a-z0-9]>.supabase.co`; a
// `chave` precisa ser unica entre os casos (o cache de ficha e o silencio do
// contador sao Maps de MODULO, que sobrevivem entre testes).
function origemDe(chave: string): string {
  return `https://${`projeto${chave}`.toLowerCase().padEnd(20, "a").slice(0, 20)}.supabase.co`;
}

type ComoResponde = "ok" | "404" | "500" | "nunca";

interface LojaDuble {
  /** Tambem e' o `dominio_publico`, salvo `dominioPublico` explicito. */
  readonly host: string;
  readonly nome: string;
  readonly origem: string;
  readonly contar?: ComoResponde;
  readonly manutencao?: boolean;
  readonly dominioPublico?: string;
}

interface Gravacao {
  readonly origem: string;
  readonly apikey: string | null;
  readonly authorization: string | null;
  readonly canal: string;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

function criarFetchDeLojas(
  lojas: readonly LojaDuble[],
  gravacoes: Gravacao[],
): typeof fetch {
  return (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/index.html")
      return new Response(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    if (url.pathname === "/rest/v1/rpc/resolver_loja") {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as {
        p_host?: string;
      };
      const loja = lojas.find((l) => l.host === corpo.p_host);
      return json(
        loja
          ? [
              {
                supabase_url: loja.origem,
                publishable_key: `sb_publishable_${new URL(loja.origem).hostname.split(".")[0]}`,
              },
            ]
          : [],
      );
    }
    const loja = lojas.find((l) => l.origem === url.origin);
    if (!loja) throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    if (url.pathname === "/rest/v1/rpc/contar_entrada") {
      const cabecalhos = new Headers(init?.headers);
      gravacoes.push({
        origem: url.origin,
        apikey: cabecalhos.get("apikey"),
        authorization: cabecalhos.get("authorization"),
        canal: (JSON.parse(String(init?.body ?? "{}")) as { p_canal: string })
          .p_canal,
      });
      switch (loja.contar ?? "ok") {
        case "nunca":
          return new Promise<Response>(() => {});
        case "404":
          return json({ code: "PGRST202" }, 404);
        case "500":
          return json({ erro: "x" }, 500);
        default:
          return new Response(null, { status: 204 });
      }
    }
    if (url.pathname === "/rest/v1/v_store_config") {
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
        return json([
          {
            dominio_publico: loja.dominioPublico ?? loja.host,
            mp_public_key: null,
            vapid_public_key: null,
            pagamento_online: false,
            manutencao: loja.manutencao ?? false,
          },
        ]);
      return json([identidadeFixture(loja.nome, loja.origem)]);
    }
    if (url.pathname === "/rest/v1/vw_produtos_public")
      return json([
        { nome: "Produto", descricao: "d", preco_venda: 10, imagem_urls: [] },
      ]);
    if (url.pathname === "/rest/v1/banners") return json([]);
    throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
  }) as typeof fetch;
}

const ENV_FROTA = {
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste",
  VITE_SUPABASE_URL: undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
  VITE_SUPABASE_ANON_KEY: undefined,
  IKCOUS_DOMINIO_PRINCIPAL: undefined,
};

async function emProducao<T>(
  vercelEnv: string | undefined,
  fetchFalso: typeof fetch,
  executar: () => Promise<T>,
): Promise<T> {
  for (const [chave, valor] of Object.entries({
    ...ENV_FROTA,
    VERCEL_ENV: vercelEnv,
  }))
    vi.stubEnv(chave, valor);
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchFalso;
  try {
    return await executar();
  } finally {
    globalThis.fetch = anterior;
  }
}

function contexto() {
  const entregues: Promise<unknown>[] = [];
  return {
    entregues,
    context: {
      waitUntil: vi.fn((promessa: Promise<unknown>) => {
        entregues.push(promessa);
      }),
    },
  };
}

function navegador(host: string, caminho = "/", extra = {}) {
  return new Request(`https://${host}${caminho}`, {
    headers: { ...NAVEGACAO, ...extra },
  });
}

function robo(host: string, caminho = "/product-detail?id=1", init = {}) {
  return new Request(`https://${host}${caminho}`, {
    headers: { "user-agent": UA_ROBO_WHATSAPP },
    ...init,
  });
}

describe("middleware + contador -- ISOLAMENTO entre lojas", () => {
  it("dois hosts, dois bancos: cada entrada grava SO no banco do seu host, com a chave publica dele", async () => {
    const a = {
      host: "iso-a.exemplo",
      nome: "Loja A",
      origem: origemDe("isoA"),
    };
    const b = {
      host: "iso-b.exemplo",
      nome: "Loja B",
      origem: origemDe("isoB"),
    };
    const gravacoes: Gravacao[] = [];
    const fetchFalso = criarFetchDeLojas([a, b], gravacoes);
    const { context, entregues } = contexto();

    await emProducao("production", fetchFalso, async () => {
      const respA = await middleware(navegador(a.host), context);
      const respB = await middleware(
        navegador(b.host, "/?utm_source=whatsapp"),
        context,
      );
      expect(respA.status).toBe(200);
      expect(respB.status).toBe(200);
      await Promise.all(entregues);
    });

    expect(gravacoes).toEqual([
      {
        origem: a.origem,
        apikey: `sb_publishable_${new URL(a.origem).hostname.split(".")[0]}`,
        authorization: `Bearer sb_publishable_${new URL(a.origem).hostname.split(".")[0]}`,
        canal: "direto",
      },
      {
        origem: b.origem,
        apikey: `sb_publishable_${new URL(b.origem).hostname.split(".")[0]}`,
        authorization: `Bearer sb_publishable_${new URL(b.origem).hostname.split(".")[0]}`,
        canal: "whatsapp",
      },
    ]);
    expect(context.waitUntil).toHaveBeenCalledTimes(2);
  });

  it("robo em /product-detail grava `previa` no banco da PROPRIA loja do host", async () => {
    const a = {
      host: "isor-a.exemplo",
      nome: "Loja A",
      origem: origemDe("isorA"),
    };
    const b = {
      host: "isor-b.exemplo",
      nome: "Loja B",
      origem: origemDe("isorB"),
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();

    await emProducao(
      "production",
      criarFetchDeLojas([a, b], gravacoes),
      async () => {
        const resp = await middleware(robo(b.host), context);
        expect(resp.status).toBe(200);
        expect(resp.headers.get("x-ikcous-og")).toBe("produto");
        await Promise.all(entregues);
      },
    );

    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0]?.origem).toBe(b.origem);
    expect(gravacoes[0]?.canal).toBe("previa");
  });

  it("robo de previa em `/` (UA inequivoco) tambem vira `previa`, nunca pessoa", async () => {
    const a = {
      host: "isop-a.exemplo",
      nome: "Loja A",
      origem: origemDe("isopA"),
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([a], gravacoes),
      async () => {
        await middleware(
          navegador(a.host, "/", { "user-agent": "facebookexternalhit/1.1" }),
          context,
        );
        await Promise.all(entregues);
      },
    );
    expect(gravacoes.map((g) => g.canal)).toEqual(["previa"]);
  });
});

describe("middleware + contador -- o ramo de robo de /product-detail usa o MESMO classificador", () => {
  const UA_WHATSAPP_EMBUTIDO = `${UA_CHROME} WhatsApp/2.24.1`;

  async function gravadoPara(
    chave: string,
    pedidoDe: (host: string) => Request,
  ): Promise<{ canais: string[]; resposta: Response }> {
    const loja = {
      host: `ramo-${chave}.exemplo`,
      nome: "Loja A",
      origem: origemDe(`ramo${chave}`),
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();
    let resposta: Response | undefined;
    await emProducao(
      "production",
      criarFetchDeLojas([loja], gravacoes),
      async () => {
        resposta = await middleware(pedidoDe(loja.host), context);
        await Promise.all(entregues);
      },
    );
    return {
      canais: gravacoes.map((g) => g.canal),
      resposta: resposta as Response,
    };
  }

  it("pessoa no navegador embutido do WhatsApp (o ramo casa /whatsapp/ e entrega HTML de robo) conta como pessoa/whatsapp, nao como previa", async () => {
    const { canais, resposta } = await gravadoPara("pessoa", (host) =>
      navegador(host, "/product-detail?id=1", {
        "user-agent": UA_WHATSAPP_EMBUTIDO,
      }),
    );
    // O roteamento antigo do ramo nao mudou: a resposta continua sendo a de robo.
    expect(resposta.headers.get("x-ikcous-og")).toBe("produto");
    expect(canais).toEqual(["whatsapp"]);
  });

  it("robo inequivoco com Sec-Fetch de navegador segue previa", async () => {
    const { canais } = await gravadoPara("twitter", (host) =>
      navegador(host, "/product-detail?id=1", {
        "user-agent": "Twitterbot/1.0",
      }),
    );
    expect(canais).toEqual(["previa"]);
  });

  it("robo do WhatsApp (UA sem Sec-Fetch) segue previa", async () => {
    const { canais } = await gravadoPara("robo", (host) => robo(host));
    expect(canais).toEqual(["previa"]);
  });

  it("pedido do ramo que o classificador nao reconhece como entrada (WhatsApp com mode=cors) nao conta", async () => {
    const { canais, resposta } = await gravadoPara("cors", (host) =>
      navegador(host, "/product-detail?id=1", {
        "user-agent": UA_WHATSAPP_EMBUTIDO,
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      }),
    );
    expect(resposta.status).toBe(200);
    expect(canais).toEqual([]);
  });
});

describe("middleware + contador -- /admin nao e' visita", () => {
  it("/admin, /admin/pedidos e /admin-orders nao gravam; o app instalado em /?source=pwa grava como direto", async () => {
    const loja = {
      host: "adm-a.exemplo",
      nome: "Loja A",
      origem: origemDe("admA"),
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([loja], gravacoes),
      async () => {
        for (const caminho of ["/admin", "/admin/pedidos", "/admin-orders"])
          expect(
            (await middleware(navegador(loja.host, caminho), context)).status,
          ).toBe(200);
        expect(gravacoes).toEqual([]);
        await middleware(navegador(loja.host, "/?source=pwa"), context);
        await Promise.all(entregues);
      },
    );
    expect(gravacoes.map((g) => g.canal)).toEqual(["direto"]);
  });
});

describe("middleware + contador -- o que nao grava", () => {
  it("host que o banco desmente (503 discorda): zero gravacoes, pelo documento E pelo robo", async () => {
    const x = {
      host: "disc-a.exemplo",
      nome: "Loja X",
      origem: origemDe("discA"),
      dominioPublico: "outra-loja.exemplo",
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([x], gravacoes),
      async () => {
        const doc = await middleware(navegador(x.host), context);
        const bot = await middleware(robo(x.host), context);
        expect(doc.status).toBe(503);
        expect(doc.headers.get("x-ikcous-porteiro")).toBe("discorda");
        expect(bot.status).toBe(503);
      },
    );
    expect(gravacoes).toEqual([]);
    expect(context.waitUntil).not.toHaveBeenCalled();
    expect(entregues).toEqual([]);
  });

  it("host sem loja na caderneta: zero gravacoes", async () => {
    const gravacoes: Gravacao[] = [];
    const { context } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([], gravacoes),
      async () => {
        const resp = await middleware(navegador("ninguem.exemplo"), context);
        expect(resp.status).toBe(503);
      },
    );
    expect(gravacoes).toEqual([]);
    expect(context.waitUntil).not.toHaveBeenCalled();
  });

  it.each(["preview", "development", undefined])(
    "VERCEL_ENV=%s nao grava (so a producao conta), nem pelo documento nem pelo robo",
    async (ambiente) => {
      const a = {
        host: `amb-${String(ambiente)}.exemplo`,
        nome: "Loja A",
        origem: origemDe(`amb${String(ambiente)}`),
      };
      const gravacoes: Gravacao[] = [];
      const { context } = contexto();
      await emProducao(
        ambiente,
        criarFetchDeLojas([a], gravacoes),
        async () => {
          const doc = await middleware(navegador(a.host), context);
          const bot = await middleware(robo(a.host), context);
          expect(doc.status).toBe(200);
          expect(bot.status).toBe(200);
        },
      );
      expect(gravacoes).toEqual([]);
      expect(context.waitUntil).not.toHaveBeenCalled();
    },
  );

  it("HEAD, arquivo (/x.txt), robo de HEAD e loja em manutencao nao gravam", async () => {
    const a = {
      host: "nao-a.exemplo",
      nome: "Loja A",
      origem: origemDe("naoA"),
    };
    const m = {
      host: "nao-m.exemplo",
      nome: "Loja M",
      origem: origemDe("naoM"),
      manutencao: true,
    };
    const gravacoes: Gravacao[] = [];
    const { context } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([a, m], gravacoes),
      async () => {
        await middleware(
          new Request(`https://${a.host}/`, {
            method: "HEAD",
            headers: NAVEGACAO,
          }),
          context,
        );
        await middleware(navegador(a.host, "/x.txt"), context);
        await middleware(
          robo(a.host, "/product-detail?id=1", { method: "HEAD" }),
          context,
        );
        await middleware(navegador(m.host), context);
        await middleware(robo(m.host), context);
      },
    );
    expect(gravacoes).toEqual([]);
  });

  it("curl (sem Sec-Fetch, sem Mozilla/) nao grava", async () => {
    const a = {
      host: "curl-a.exemplo",
      nome: "Loja A",
      origem: origemDe("curlA"),
    };
    const gravacoes: Gravacao[] = [];
    const { context } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([a], gravacoes),
      async () => {
        await middleware(
          new Request(`https://${a.host}/`, {
            headers: { "user-agent": "curl/8.4.0" },
          }),
          context,
        );
      },
    );
    expect(gravacoes).toEqual([]);
  });
});

describe("middleware + contador -- NUNCA atrasa nem derruba a pagina", () => {
  async function resolveSemEsperar<T>(
    iniciar: () => Promise<T>,
  ): Promise<{ resolveu: () => boolean; promessa: Promise<T> }> {
    let resolveu = false;
    const promessa = iniciar().then((valor) => {
      resolveu = true;
      return valor;
    });
    // 200 ms de relogio falso (muito antes do prazo de 1,5 s da gravacao), em
    // fatias de 10 ms com uma volta REAL do laco entre elas: ler o corpo de uma
    // `Response` precisa do laco do Node, que o relogio falso nao empurra. Se o
    // middleware ESPERASSE a gravacao, a pagina so sairia depois dela.
    for (let fatia = 0; fatia < 20; fatia++) {
      await vi.advanceTimersByTimeAsync(10);
      await new Promise<void>((seguir) => setImmediate(seguir));
    }
    // O relogio falso ja parou em 200 ms; so o laco REAL continua. Numa maquina
    // lenta (CI sob carga) 20 voltas nao bastam para ler os corpos das respostas,
    // entao espera-se por tempo real (ate 5 s) sem adiantar o relogio falso: se o
    // middleware dependesse da gravacao de 1,5 s, ela nunca chegaria aqui.
    const limite = Date.now() + 5_000;
    while (!resolveu && Date.now() < limite) {
      await new Promise<void>((seguir) => setImmediate(seguir));
    }
    return { resolveu: () => resolveu, promessa };
  }

  it("gravacao que nunca responde: o documento sai na hora; a gravacao entregue ao waitUntil termina sozinha em 1,5 s", async () => {
    // So os temporizadores: ler o corpo de uma `Response` usa o laco real do Node.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const a = {
      host: "nunca-a.exemplo",
      nome: "Loja A",
      origem: origemDe("nuncaA"),
      contar: "nunca" as const,
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([a], gravacoes),
      async () => {
        const { resolveu, promessa } = await resolveSemEsperar(() =>
          middleware(navegador(a.host), context),
        );
        expect(resolveu()).toBe(true);
        expect((await promessa).status).toBe(200);
        expect(gravacoes).toHaveLength(1);
        expect(entregues).toHaveLength(1);

        let terminou = false;
        const fim = (entregues[0] as Promise<unknown>).then(() => {
          terminou = true;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(terminou).toBe(false);
        await vi.advanceTimersByTimeAsync(500);
        await fim;
        expect(terminou).toBe(true);
      },
    );
  });

  it("gravacao que nunca responde: o robo de /product-detail tambem sai na hora", async () => {
    // So os temporizadores: ler o corpo de uma `Response` usa o laco real do Node.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const a = {
      host: "nunca-r.exemplo",
      nome: "Loja A",
      origem: origemDe("nuncaR"),
      contar: "nunca" as const,
    };
    const { context } = contexto();
    await emProducao("production", criarFetchDeLojas([a], []), async () => {
      const { resolveu, promessa } = await resolveSemEsperar(() =>
        middleware(robo(a.host), context),
      );
      expect(resolveu()).toBe(true);
      expect((await promessa).headers.get("x-ikcous-og")).toBe("produto");
      await vi.advanceTimersByTimeAsync(2_000);
    });
  });

  it("gravacao com 500: a pagina sai igual", async () => {
    const a = {
      host: "erro-a.exemplo",
      nome: "Loja A",
      origem: origemDe("erroA"),
      contar: "500" as const,
    };
    const { context, entregues } = contexto();
    await emProducao("production", criarFetchDeLojas([a], []), async () => {
      const resp = await middleware(navegador(a.host), context);
      expect(resp.status).toBe(200);
      await expect(Promise.all(entregues)).resolves.toBeDefined();
    });
  });

  it("sem `context` (chamada avulsa, teste) nada lanca e a pagina sai", async () => {
    const a = {
      host: "semctx-a.exemplo",
      nome: "Loja A",
      origem: origemDe("semctxA"),
    };
    const gravacoes: Gravacao[] = [];
    await emProducao(
      "production",
      criarFetchDeLojas([a], gravacoes),
      async () => {
        const resp = await middleware(navegador(a.host));
        expect(resp.status).toBe(200);
        const bot = await middleware(robo(a.host));
        expect(bot.status).toBe(200);
      },
    );
    expect(gravacoes.map((g) => g.canal)).toEqual(["direto", "previa"]);
  });

  it("`context.waitUntil` que lanca nao derruba a pagina", async () => {
    const a = {
      host: "wuthrow-a.exemplo",
      nome: "Loja A",
      origem: origemDe("wuthrowA"),
    };
    const context = {
      waitUntil: () => {
        throw new Error("waitUntil quebrou");
      },
    };
    await emProducao("production", criarFetchDeLojas([a], []), async () => {
      expect((await middleware(navegador(a.host), context)).status).toBe(200);
      expect((await middleware(robo(a.host), context)).status).toBe(200);
    });
  });
});

describe("middleware + contador -- loja que ainda nao recebeu a migration (404)", () => {
  it("depois de um 404 a MESMA loja nao recebe mais gravacao por 10 min; outra loja continua", async () => {
    const velha = {
      host: "migr-velha.exemplo",
      nome: "Loja Velha",
      origem: origemDe("migrVelha"),
      contar: "404" as const,
    };
    const nova = {
      host: "migr-nova.exemplo",
      nome: "Loja Nova",
      origem: origemDe("migrNova"),
    };
    const gravacoes: Gravacao[] = [];
    const { context, entregues } = contexto();
    await emProducao(
      "production",
      criarFetchDeLojas([velha, nova], gravacoes),
      async () => {
        await middleware(navegador(velha.host), context);
        await Promise.all(entregues);
        await middleware(navegador(velha.host), context);
        await middleware(robo(velha.host), context);
        await middleware(navegador(nova.host), context);
        await Promise.all(entregues);
      },
    );
    expect(gravacoes.map((g) => g.origem)).toEqual([velha.origem, nova.origem]);
  });
});
