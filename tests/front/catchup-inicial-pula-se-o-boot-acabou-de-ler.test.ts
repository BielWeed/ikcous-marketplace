// @vitest-environment jsdom
//
// A RODADA INICIAL NÃO REPETE O QUE O BOOT ACABOU DE LER (Black Friday,
// 24/11/2026).
//
// O DEFEITO: ao abrir o app o StoreContext lê configuração, banners,
// categorias e catálogo. Logo depois a primeira rodada de reconciliação do
// motor (`catchUp`) lia TUDO de novo (configuração, categorias, banners e o
// resumo `id, ultima_atualizacao` de todos os produtos): ~8 leituras onde 4
// bastavam, em toda abertura de visitante e de cliente logada.
//
// O CONSERTO: a rodada INICIAL do aparelho SEM canal de catálogo (visitante e
// cliente) pergunta ao cofre quando os produtos foram sincronizados pela
// última vez (`getLastSync("products")`) e, se foi há menos de 60 s (a mesma
// janela dos outros gatilhos), não lê nada. Tudo o mais continua como era:
// reconexão do canal da lojista, volta à aba e `online` chamam `catchUp` SEM o
// pedido de pular e rodam completo.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. abertura logo após o boot (lastSync < 60 s): zero leituras, zero
//      gravações, e a trava da rodada é solta (a próxima rodada roda);
//   2. abertura com lastSync antigo (>= 60 s), nunca sincronizado (0), de um
//      relógio que andou para trás (futuro) ou com o cofre sem resposta: roda;
//   3. a espera do catálogo em voo vem ANTES da pergunta: o carimbo que o boot
//      grava no fim do download é o que vale;
//   4. `catchUp` sem o pedido (reconexão, aba, online) ignora o carimbo;
//   5. pelo `start`: sem canal a rodada inicial pede para pular; com canal,
//      toda SUBSCRIBED (a primeira e a reconexão) roda completa; a volta à
//      aba depois de uma subida pulada roda como rodava.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabelasConsultadas = vi.hoisted(() => [] as string[]);
const canal = vi.hoisted(() => ({
  aoAssinar: null as null | ((status: string, err?: unknown) => void),
}));

vi.mock("@/lib/supabase", () => {
  const builder = (tabela: string): any => {
    const consulta: any = {};
    for (const metodo of ["is", "in", "order", "limit", "eq", "gt", "select"]) {
      consulta[metodo] = vi.fn(() => consulta);
    }
    consulta.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
    consulta.then = (
      onOk: (v: { data: unknown[]; error: null }) => unknown,
      onErro: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(onOk, onErro);
    void tabela;
    return consulta;
  };
  return {
    supabase: {
      from: vi.fn((tabela: string) => {
        tabelasConsultadas.push(tabela);
        return builder(tabela);
      }),
      channel: vi.fn(() => {
        const c: any = {
          on: vi.fn(() => c),
          subscribe: vi.fn((cb: (status: string, err?: unknown) => void) => {
            canal.aoAssinar = cb;
          }),
        };
        return c;
      }),
      removeChannel: vi.fn(() => Promise.resolve()),
    },
  };
});

const JANELA_MS = 60_000;

/**
 * Cofre cujos carimbos o teste define. A função recebe a gaveta perguntada
 * (`products`, `store_config`); quem a ignora devolve o mesmo carimbo para
 * todas.
 */
function dubleDeCofre(
  ultimaSincronizacao: (loja: string) => number | Promise<number>,
) {
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async (_loja?: string) => [] as unknown[]),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async () => {}),
    deleteById: vi.fn(async () => {}),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(async () => {}),
    getByIndex: vi.fn(async () => [] as unknown[]),
    getLastSync: vi.fn(async (loja: string) => ultimaSincronizacao(loja)),
  };
}

const PEDIDO_INICIAL = { rodadaInicial: true } as const;

async function carregar() {
  vi.resetModules();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
  const deposito = await import("@/lib/deposito-do-catalogo");
  const { supabase } = await import("@/lib/supabase");
  vi.mocked(supabase.from).mockClear();
  return { engine: RealtimeSyncEngine, deposito, supabase };
}

function defineVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

const soltar = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rodada inicial do catchUp não repete o que o boot acabou de ler", () => {
  beforeEach(() => {
    tabelasConsultadas.length = 0;
    canal.aoAssinar = null;
    defineVisibilidade("visible");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("(1) aberta logo após o boot (carimbo de 5 s): zero leituras e zero gravações", async () => {
    const { engine, supabase } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() - 5_000);

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

    expect(cofre.getLastSync).toHaveBeenCalledWith("products");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(tabelasConsultadas).toEqual([]);
    expect(cofre.getAllOrThrow).not.toHaveBeenCalled();
    expect(cofre.putMany).not.toHaveBeenCalled();
    expect(cofre.replaceAll).not.toHaveBeenCalled();
    expect(cofre.setLastSync).not.toHaveBeenCalled();
  });

  it("(1b) a rodada pulada solta a trava: a seguinte roda completa", async () => {
    const { engine, supabase } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() - 5_000);

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);
    expect(supabase.from).not.toHaveBeenCalled();

    // Reconexão/aba/online chamam sem o pedido: ignoram o carimbo.
    await engine.catchUp(cofre as any, false);

    expect(tabelasConsultadas).toEqual([
      "v_store_config",
      "categorias",
      "banners",
      "vw_produtos_public",
    ]);
  });

  it("(2) aberta com carimbo antigo (61 s): roda completa, as 4 leituras de sempre", async () => {
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() - (JANELA_MS + 1_000));

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

    expect(tabelasConsultadas).toEqual([
      "v_store_config",
      "categorias",
      "banners",
      "vw_produtos_public",
    ]);
    expect(cofre.getAllOrThrow).toHaveBeenCalledWith("products");
  });

  it("(2b) limite: carimbo de exatamente 60 s já NÃO pula (a janela é aberta no fim)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() - JANELA_MS);

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

    expect(tabelasConsultadas).toContain("v_store_config");
  });

  it("(2c) nunca sincronizado (carimbo 0, 1ª visita ou cofre limpo): roda", async () => {
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => 0);

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

    expect(tabelasConsultadas).toContain("v_store_config");
  });

  it("(2d) carimbo no FUTURO (relógio do aparelho andou para trás): roda, não confia", async () => {
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() + 30_000);

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

    expect(tabelasConsultadas).toContain("v_store_config");
  });

  it("(2e) cofre sem resposta (getLastSync lança): roda como sempre rodou", async () => {
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => {
      throw new Error("conexão do cofre fechada");
    });

    await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

    expect(tabelasConsultadas).toContain("v_store_config");
  });

  it("(2f) cofre de versão sem getLastSync (dublê antigo): roda", async () => {
    const { engine } = await carregar();
    const cofre: any = dubleDeCofre(() => Date.now());
    cofre.getLastSync = undefined;

    await engine.catchUp(cofre, false, PEDIDO_INICIAL);

    expect(tabelasConsultadas).toContain("v_store_config");
  });

  it("(3) catálogo ainda em voo: espera ANTES de perguntar o carimbo (o carimbo é gravado no fim do download)", async () => {
    const { engine, deposito, supabase } = await carregar();
    let carimbo = 0; // o boot ainda não gravou
    const cofre = dubleDeCofre(() => carimbo);
    const fechar = deposito.abrirCatalogoEmVoo();

    const rodada = engine.catchUp(cofre as any, false, PEDIDO_INICIAL);
    await soltar();
    await soltar();
    expect(cofre.getLastSync).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();

    // O download termina: grava o carimbo e fecha o registro.
    carimbo = Date.now();
    fechar();
    await rodada;

    // Uma pergunta por gaveta (produtos e configuração), ambas depois da espera.
    expect(cofre.getLastSync).toHaveBeenCalledTimes(2);
    expect(cofre.getLastSync).toHaveBeenCalledWith("products");
    expect(cofre.getLastSync).toHaveBeenCalledWith("store_config");
    expect(supabase.from).not.toHaveBeenCalled(); // pulou: carimbo fresco
  });

  it('(3b) "Sair" no meio da espera: nada é perguntado nem lido', async () => {
    const { engine, deposito, supabase } = await carregar();
    const cofre = dubleDeCofre(() => Date.now());
    const fechar = deposito.abrirCatalogoEmVoo();

    const rodada = engine.catchUp(cofre as any, false, PEDIDO_INICIAL);
    await soltar();
    engine.stop();
    fechar();
    await rodada;

    expect(cofre.getLastSync).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("(4) sem o pedido (reconexão, aba, online) o carimbo fresco é ignorado", async () => {
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() - 1_000);

    await engine.catchUp(cofre as any, false);

    expect(cofre.getLastSync).not.toHaveBeenCalled();
    expect(tabelasConsultadas).toContain("v_store_config");
    expect(tabelasConsultadas).toContain("vw_produtos_public");
  });

  it("(4b) painel (isAdmin): o pedido vale também para as tabelas do painel, e a rodada completa usa as dele", async () => {
    const { engine } = await carregar();
    const cofre = dubleDeCofre(() => Date.now() - JANELA_MS - 1);

    await engine.catchUp(cofre as any, true, PEDIDO_INICIAL);

    expect(tabelasConsultadas[0]).toBe("store_config");
    expect(tabelasConsultadas).toContain("produtos");
  });

  // REVISÃO OPUS (24/11): conferir só o carimbo dos PRODUTOS deixava passar a
  // configuração velha. Se a leitura da config no boot falha uma vez (prazo,
  // 5xx) mas o catálogo chega, e a cliente tem uma cópia antiga da config no
  // aparelho, o StoreContext não tenta de novo (já há config na tela) -- era a
  // rodada inicial que consertava, relendo a config. O pulo agora exige os DOIS
  // carimbos recentes; o boot só carimba `store_config` quando LEU da rede.
  describe("a configuração também precisa ter sido lida agora", () => {
    const carimbos =
      (produtos: () => number, config: () => number) => (loja: string) => {
        if (loja === "products") return produtos();
        if (loja === "store_config") return config();
        throw new Error(`gaveta inesperada: ${loja}`);
      };

    it("(7) config FALHOU no boot (nunca carimbada) e catálogo ok: NÃO pula, relê a config", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => 0,
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(tabelasConsultadas).toEqual([
        "v_store_config",
        "categorias",
        "banners",
        "vw_produtos_public",
      ]);
    });

    it("(7b) config falhou no boot com carimbo de uma sessão antiga (10 min) e catálogo ok: NÃO pula", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => Date.now() - 10 * JANELA_MS,
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(tabelasConsultadas).toContain("v_store_config");
    });

    it("(7c) config e catálogo lidos agora (ambos < 60 s): pula, zero leituras", async () => {
      const { engine, supabase } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => Date.now() - 3_000,
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(supabase.from).not.toHaveBeenCalled();
      expect(cofre.setLastSync).not.toHaveBeenCalled();
    });

    it("(7d) config lida agora mas catálogo antigo: NÃO pula", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - (JANELA_MS + 1_000),
          () => Date.now() - 2_000,
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(tabelasConsultadas).toContain("v_store_config");
      expect(tabelasConsultadas).toContain("vw_produtos_public");
    });

    it("(7e) config com carimbo no FUTURO e catálogo ok: NÃO pula", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => Date.now() + 30_000,
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(tabelasConsultadas).toContain("v_store_config");
    });

    it("(7f) cofre falha só na pergunta da config: NÃO pula", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => {
            throw new Error("leitura do carimbo da config falhou");
          },
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(tabelasConsultadas).toContain("v_store_config");
    });

    it("(7g) limite: config de exatamente 60 s já NÃO pula", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => Date.now() - JANELA_MS,
        ),
      );

      await engine.catchUp(cofre as any, false, PEDIDO_INICIAL);

      expect(tabelasConsultadas).toContain("v_store_config");
    });

    it("(7h) pelo start() sem canal: config não lida no boot faz a subida ler as 4 de sempre", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(
        carimbos(
          () => Date.now() - 2_000,
          () => 0,
        ),
      );

      const parar = engine.start(cofre as any, true, false, false);
      await soltar();
      await soltar();

      expect(tabelasConsultadas).toContain("v_store_config");
      expect(tabelasConsultadas).toContain("vw_produtos_public");

      parar();
    });
  });

  describe("pelo start()", () => {
    it("(5) sem canal (visitante/cliente): a subida pede para pular e não lê nada com o carimbo fresco", async () => {
      const { engine, supabase } = await carregar();
      const espiao = vi.spyOn(engine, "catchUp");
      const cofre = dubleDeCofre(() => Date.now() - 2_000);

      const parar = engine.start(cofre as any, true, false, false);
      await soltar();
      await soltar();

      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao).toHaveBeenCalledWith(cofre, false, PEDIDO_INICIAL);
      expect(supabase.from).not.toHaveBeenCalled();

      parar();
    });

    it("(5b) sem canal e carimbo antigo: a subida lê as 4 de sempre", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(() => Date.now() - 5 * JANELA_MS);

      const parar = engine.start(cofre as any, true, false, false);
      await soltar();
      await soltar();

      expect(tabelasConsultadas).toContain("v_store_config");
      expect(tabelasConsultadas).toContain("vw_produtos_public");

      parar();
    });

    it("(5c) depois da subida pulada, voltar à aba roda a rodada completa como rodava", async () => {
      const { engine } = await carregar();
      const cofre = dubleDeCofre(() => Date.now() - 2_000);

      const parar = engine.start(cofre as any, true, false, false);
      await soltar();
      await soltar();
      expect(tabelasConsultadas).toEqual([]);

      document.dispatchEvent(new Event("visibilitychange"));
      await soltar();
      await soltar();

      expect(tabelasConsultadas).toContain("v_store_config");
      expect(tabelasConsultadas).toContain("vw_produtos_public");

      parar();
    });

    it("(5d) segunda volta à aba dentro da janela de 60 s: pula como hoje", async () => {
      const { engine, supabase } = await carregar();
      const cofre = dubleDeCofre(() => Date.now() - 2_000);
      const parar = engine.start(cofre as any, true, false, false);
      await soltar();

      document.dispatchEvent(new Event("visibilitychange")); // roda
      await soltar();
      await soltar();
      const leiturasDaPrimeira = vi.mocked(supabase.from).mock.calls.length;
      expect(leiturasDaPrimeira).toBeGreaterThan(0);

      document.dispatchEvent(new Event("visibilitychange")); // dentro da janela
      await soltar();
      await soltar();
      expect(vi.mocked(supabase.from).mock.calls.length).toBe(
        leiturasDaPrimeira,
      );

      parar();
    });

    it("(6) lojista, canal assinado: a SUBSCRIBED roda completa MESMO com carimbo fresco, e a reconexão também", async () => {
      const { engine, supabase } = await carregar();
      const espiao = vi.spyOn(engine, "catchUp");
      const cofre = dubleDeCofre(() => Date.now() - 1_000);

      const parar = engine.start(cofre as any, true, true, true);
      expect(canal.aoAssinar).toBeTypeOf("function");
      // Antes de assinar o canal ninguém leu nada.
      expect(supabase.from).not.toHaveBeenCalled();

      canal.aoAssinar?.("SUBSCRIBED");
      await soltar();
      await soltar();
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao).toHaveBeenLastCalledWith(cofre, true);
      expect(tabelasConsultadas).toContain("store_config");
      expect(tabelasConsultadas).toContain("produtos");

      // Reconexão do canal: nova SUBSCRIBED.
      tabelasConsultadas.length = 0;
      canal.aoAssinar?.("SUBSCRIBED");
      await soltar();
      await soltar();
      expect(espiao).toHaveBeenCalledTimes(2);
      expect(espiao).toHaveBeenLastCalledWith(cofre, true);
      expect(tabelasConsultadas).toContain("store_config");

      parar();
    });
  });
});
