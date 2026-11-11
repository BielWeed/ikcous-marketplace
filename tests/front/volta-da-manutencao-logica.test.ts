// @vitest-environment jsdom
//
// A tela "Servidor em Manutenção" não sumia sozinha quando a manutenção
// acabava (06/11/2026). Este arquivo prova as peças puras da cura:
//   - a PERGUNTA (`lojaSaiuDaManutencao`): só "sim" com a ficha atual dizendo
//     `manutencao === false`; qualquer dúvida (rede fora, 503, corpo que não
//     é JSON, ficha torta) é "não", nunca "sim";
//   - a TRAVA contra laço de recarga (`podeRecarregarSozinha`): no máximo 3 em
//     30 minutos e nunca duas com menos de 90 s de distância; sem
//     `sessionStorage` utilizável, não recarrega sozinha;
//   - a LIMPEZA da cópia da página guardada pelo service worker
//     (`apagarCopiaDaPaginaGuardada`): o SW responde a navegação com a cópia
//     velha primeiro; sem apagá-la, recarregar devolveria a tela de manutenção.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navegar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recuperacao-chunk", () => ({
  navegarPreservandoEndereco: navegar,
}));

import {
  CHAVE_RECARGAS_DA_MANUTENCAO,
  INTERVALO_DA_CHECAGEM_MS,
  apagarCopiaDaPaginaGuardada,
  lojaSaiuDaManutencao,
  podeRecarregarSozinha,
  recarregarComPaginaNova,
  registrarRecargaSozinha,
} from "@/lib/volta-da-manutencao";

function fichaCom(manutencao: unknown) {
  return { configuracao: { manutencao } };
}

function respostaJson(corpo: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

describe("lojaSaiuDaManutencao — a pergunta à ficha ATUAL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pede /identidade.json com cache: 'no-store' (nunca a cópia do navegador)", async () => {
    const buscar = vi.fn(async () => respostaJson(fichaCom(false)));
    vi.stubGlobal("fetch", buscar);
    await lojaSaiuDaManutencao();
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith("/identidade.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("manutencao === false => a loja voltou", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson(fichaCom(false))),
    );
    await expect(lojaSaiuDaManutencao()).resolves.toBe(true);
  });

  it("manutencao === true => continua em manutenção", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson(fichaCom(true))),
    );
    await expect(lojaSaiuDaManutencao()).resolves.toBe(false);
  });

  it.each([
    ["ficha sem o bloco configuracao", {}],
    ["manutencao ausente", { configuracao: {} }],
    ["manutencao texto 'false'", fichaCom("false")],
    ["manutencao nula", fichaCom(null)],
    ["manutencao 0", fichaCom(0)],
    ["corpo nulo", null],
    ["corpo que não é objeto", "ok"],
  ])("na dúvida não recarrega: %s", async (_nome, corpo) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson(corpo)),
    );
    await expect(lojaSaiuDaManutencao()).resolves.toBe(false);
  });

  it("503 do porteiro (loja ainda fora do ar) => continua em manutenção", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson(fichaCom(false), false, 503)),
    );
    await expect(lojaSaiuDaManutencao()).resolves.toBe(false);
  });

  it("rede fora (fetch rejeita) => continua em manutenção, sem lançar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(lojaSaiuDaManutencao()).resolves.toBe(false);
  });

  it("corpo que não é JSON (a hospedagem devolveu HTML) => continua em manutenção", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as unknown as Response,
      ),
    );
    await expect(lojaSaiuDaManutencao()).resolves.toBe(false);
  });
});

describe("podeRecarregarSozinha — a trava contra laço de recarga", () => {
  const T0 = 1_800_000_000_000;

  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("primeira vez na aba: pode", () => {
    expect(podeRecarregarSozinha(T0)).toBe(true);
  });

  it("logo depois de recarregar (< 90 s): não pode — cobre a ficha de uma borda atrasada em relação à outra", () => {
    registrarRecargaSozinha(T0);
    expect(podeRecarregarSozinha(T0 + 1_000)).toBe(false);
    expect(podeRecarregarSozinha(T0 + 89_999)).toBe(false);
  });

  it("passados 90 s, pode de novo", () => {
    registrarRecargaSozinha(T0);
    expect(podeRecarregarSozinha(T0 + 90_000)).toBe(true);
  });

  it("no máximo 3 em 30 minutos, mesmo espaçadas: a quarta espera", () => {
    registrarRecargaSozinha(T0);
    registrarRecargaSozinha(T0 + 100_000);
    registrarRecargaSozinha(T0 + 200_000);
    expect(podeRecarregarSozinha(T0 + 300_000)).toBe(false);
    expect(podeRecarregarSozinha(T0 + 29 * 60_000)).toBe(false);
  });

  it("depois de 30 minutos da mais antiga, a janela libera", () => {
    registrarRecargaSozinha(T0);
    registrarRecargaSozinha(T0 + 100_000);
    registrarRecargaSozinha(T0 + 200_000);
    // a de T0 saiu da janela; restam 2 e a última tem mais de 90 s
    expect(podeRecarregarSozinha(T0 + 30 * 60_000 + 1)).toBe(true);
  });

  it("anotação ilegível no armazenamento é ignorada, não trava nem lança", () => {
    sessionStorage.setItem(CHAVE_RECARGAS_DA_MANUTENCAO, "{isso não é json");
    expect(podeRecarregarSozinha(T0)).toBe(true);
    sessionStorage.setItem(
      CHAVE_RECARGAS_DA_MANUTENCAO,
      JSON.stringify({ nao: "uma lista" }),
    );
    expect(podeRecarregarSozinha(T0)).toBe(true);
    sessionStorage.setItem(
      CHAVE_RECARGAS_DA_MANUTENCAO,
      JSON.stringify(["texto", null, T0]),
    );
    // só o número vale: o T0 recente bloqueia
    expect(podeRecarregarSozinha(T0 + 1_000)).toBe(false);
  });

  it("registrar devolve true quando gravou e false quando só dá para LER (armazenamento cheio): quem chama não recarrega sem trava", () => {
    expect(registrarRecargaSozinha(T0)).toBe(true);
    sessionStorage.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("cheio", "QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });
    expect(podeRecarregarSozinha(T0)).toBe(true);
    expect(registrarRecargaSozinha(T0)).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sem sessionStorage utilizável (modo privado) NÃO recarrega sozinha: sem como limitar, não arrisca laço", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(podeRecarregarSozinha(T0)).toBe(false);
    expect(() => registrarRecargaSozinha(T0)).not.toThrow();
  });
});

describe("apagarCopiaDaPaginaGuardada — tira do cache só a cópia desta página", () => {
  function cacheFalso() {
    return { delete: vi.fn(async () => true) };
  }

  function instalarCaches(
    nomes: Record<string, ReturnType<typeof cacheFalso>>,
  ) {
    const porNome = new Map(Object.entries(nomes));
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => [...porNome.keys()]),
      open: vi.fn(async (nome: string) => porNome.get(nome)),
    });
  }

  function instalarLocalizacao(pathname: string, search = "") {
    vi.stubGlobal("location", {
      origin: "https://loja.exemplo.com",
      pathname,
      search,
      hash: "#topo",
      href: `https://loja.exemplo.com${pathname}${search}#topo`,
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apaga a URL exata da página (sem o fragmento) em TODOS os caches", async () => {
    const app = cacheFalso();
    const imagens = cacheFalso();
    const identidade = cacheFalso();
    instalarCaches({
      "app-cache-1.5.137": app,
      "supabase-images-cache": imagens,
      "ikcous-identidade": identidade,
    });
    instalarLocalizacao("/cart", "?a=1");

    await apagarCopiaDaPaginaGuardada();

    for (const c of [app, imagens, identidade]) {
      expect(c.delete).toHaveBeenCalledTimes(1);
      expect(c.delete).toHaveBeenCalledWith(
        "https://loja.exemplo.com/cart?a=1",
      );
    }
  });

  it("não apaga o cache inteiro (o app continua abrindo sem internet): só chama delete de entrada", async () => {
    const app = cacheFalso();
    const apagarCacheInteiro = vi.fn(async () => true);
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => ["app-cache-1.5.137"]),
      open: vi.fn(async () => app),
      delete: apagarCacheInteiro,
    });
    instalarLocalizacao("/");
    await apagarCopiaDaPaginaGuardada();
    expect(apagarCacheInteiro).not.toHaveBeenCalled();
    expect(app.delete).toHaveBeenCalledWith("https://loja.exemplo.com/");
  });

  it("estando em /index.html não apaga nada (é o arquivo do precache, não uma cópia de navegação)", async () => {
    const app = cacheFalso();
    instalarCaches({ "app-cache-1.5.137": app });
    instalarLocalizacao("/index.html");
    await apagarCopiaDaPaginaGuardada();
    expect(app.delete).not.toHaveBeenCalled();
  });

  it("um cache que falha não impede os outros nem lança", async () => {
    const quebrado = {
      delete: vi.fn(async () => {
        throw new Error("QuotaExceededError");
      }),
    };
    const bom = cacheFalso();
    instalarCaches({ a: quebrado, b: bom });
    instalarLocalizacao("/");
    await expect(apagarCopiaDaPaginaGuardada()).resolves.toBeUndefined();
    expect(bom.delete).toHaveBeenCalledTimes(1);
  });

  it("sem a API de cache (navegador antigo), segue sem lançar", async () => {
    vi.stubGlobal("caches", undefined);
    instalarLocalizacao("/");
    await expect(apagarCopiaDaPaginaGuardada()).resolves.toBeUndefined();
  });
});

describe("recarregarComPaginaNova — limpa e só então navega", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    navegar.mockClear();
  });

  it("apaga a cópia e DEPOIS navega ao mesmo endereço", async () => {
    const ordem: string[] = [];
    vi.stubGlobal("location", {
      origin: "https://loja.exemplo.com",
      pathname: "/",
      search: "",
      hash: "",
      href: "https://loja.exemplo.com/",
    });
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => ["app-cache-x"]),
      open: vi.fn(async () => ({
        delete: vi.fn(async () => {
          ordem.push("apagou");
          return true;
        }),
      })),
    });
    navegar.mockImplementation(() => {
      ordem.push("navegou");
    });

    await recarregarComPaginaNova();

    expect(ordem).toEqual(["apagou", "navegou"]);
  });

  it("mesmo que a limpeza trave para sempre, a navegação acontece (prazo)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("location", {
        origin: "https://loja.exemplo.com",
        pathname: "/",
        search: "",
        hash: "",
        href: "https://loja.exemplo.com/",
      });
      vi.stubGlobal("caches", {
        keys: vi.fn(() => new Promise(() => {})),
        open: vi.fn(),
      });
      const pronto = recarregarComPaginaNova();
      await vi.advanceTimersByTimeAsync(5_000);
      await pronto;
      expect(navegar).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("constantes", () => {
  it("a checagem automática é de 30 a 60 segundos", () => {
    expect(INTERVALO_DA_CHECAGEM_MS).toBeGreaterThanOrEqual(30_000);
    expect(INTERVALO_DA_CHECAGEM_MS).toBeLessThanOrEqual(60_000);
  });
});
