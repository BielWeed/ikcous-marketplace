// @vitest-environment jsdom
//
// O CATCHUP ESPERA O CATÁLOGO QUE JÁ ESTÁ SENDO BAIXADO (1ª visita, 30/10/2026).
//
// O DEFEITO: a configuração da loja (3 KB) chega antes do catálogo (48 KB) e
// liga o motor. A rodada de reconciliação lê o cofre -- ainda VAZIO, porque o
// catálogo só é gravado depois de baixar -- e baixa tudo de novo por id
// (+57 KB de dados, +71 KB de fotos), e a vitrine troca os cartões de lugar.
//
// O CONSERTO: `buscarProdutos` registra o catálogo em trânsito
// (src/lib/deposito-do-catalogo.ts) e o `catchUp`, ANTES de qualquer consulta
// ou leitura do cofre, espera esse registro (prazo de 8 s).
//
// O QUE ESTA SUÍTE TRAVA:
//   1. catálogo pendente: nenhum `from()` da rodada até resolver, e zero
//      consultas `.in("id")`; depois de resolvido (cofre já cheio) segue sem
//      baixar nada por id;
//   2. a promessa que nunca resolve: a rodada segue depois do prazo;
//   3. o "Sair" (stop) durante a espera: nada é consultado nem gravado;
//   4. duas consultas registradas: espera a mais NOVA (inclusive a que abre
//      com a rodada já esperando);
//   5. sem registro: as MESMAS chamadas de hoje, e nenhum relógio criado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: unknown; error: null };

const servidor = vi.hoisted(() => ({
  resumo: [] as unknown[],
  detalhe: [] as unknown[],
  consultasDeResumo: 0,
  consultasDeDetalhe: 0,
}));

const tabelasConsultadas = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      tabelasConsultadas.push(tabela);
      if (tabela === "vw_produtos_public" || tabela === "vw_produtos_admin") {
        return builderDeProduto();
      }
      return builderDeOutraTabela(tabela);
    }),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })) })),
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

function builderDeProduto(): any {
  const consulta: any = {};
  let ehDetalhe = false;
  consulta.is = vi.fn(() => consulta);
  consulta.order = vi.fn(() => consulta);
  consulta.eq = vi.fn(() => consulta);
  consulta.select = vi.fn(() => consulta);
  consulta.in = vi.fn(() => {
    ehDetalhe = true;
    return consulta;
  });
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
  consulta.then = (
    onOk: (v: Resposta) => unknown,
    onErro: (e: unknown) => unknown,
  ) => {
    if (ehDetalhe) servidor.consultasDeDetalhe += 1;
    else servidor.consultasDeResumo += 1;
    const dados = ehDetalhe ? servidor.detalhe : servidor.resumo;
    return Promise.resolve({ data: dados, error: null }).then(onOk, onErro);
  };
  return consulta;
}

function builderDeOutraTabela(_tabela: string): any {
  const consulta: any = {};
  consulta.is = vi.fn(() => consulta);
  consulta.in = vi.fn(() => consulta);
  consulta.order = vi.fn(() => consulta);
  consulta.eq = vi.fn(() => consulta);
  consulta.select = vi.fn(() => consulta);
  consulta.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
  consulta.then = (
    onOk: (v: Resposta) => unknown,
    onErro: (e: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(onOk, onErro);
  return consulta;
}

const HORA_DO_SERVIDOR = "2026-10-25T00:00:00.000Z";

/** Cofre cujo catálogo "chega" quando o teste manda (simula a gravação da vitrine). */
function dubleDeCofre() {
  let gravados: unknown[] = [];
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async (_loja?: string) => gravados),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async (_loja?: string, _itens?: unknown[]) => {}),
    deleteById: vi.fn(async (_loja?: string, _id?: string) => {}),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(async (_loja?: string, _itens?: unknown[]) => {}),
    getByIndex: vi.fn(async () => [] as unknown[]),
    /** A vitrine terminou de gravar o catálogo no cofre. */
    gravarCatalogo(itens: unknown[]) {
      gravados = itens;
    },
  };
}

function produtoDoServidor(id: string) {
  return {
    id,
    nome: `Produto ${id}`,
    preco_venda: 10,
    estoque: 1,
    ativo: true,
    product_variants: [],
  };
}

// A trava do motor e o registro do catálogo são de módulo: import fresco por
// teste, e os DOIS módulos vêm do mesmo grafo (o motor enxerga o registro que
// o teste abre).
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
  // O dublê do módulo é o mesmo entre os testes: zera a contagem de chamadas.
  vi.mocked(supabase.from).mockClear();
  return { engine: RealtimeSyncEngine, deposito, supabase };
}

/** Deixa as promessas já resolvidas correrem até o próximo ponto de espera. */
const soltar = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("catchUp espera o catálogo que a vitrine já está baixando", () => {
  beforeEach(() => {
    tabelasConsultadas.length = 0;
    servidor.resumo = [{ id: "p1", ultima_atualizacao: HORA_DO_SERVIDOR }];
    servidor.detalhe = [produtoDoServidor("p1")];
    servidor.consultasDeResumo = 0;
    servidor.consultasDeDetalhe = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("catálogo pendente: nenhuma consulta da rodada até resolver, e nada baixado por id depois", async () => {
    const { engine, deposito, supabase } = await carregar();
    const cofre = dubleDeCofre();
    const fechar = deposito.abrirCatalogoEmVoo();

    const rodada = engine.catchUp(cofre as any, false);
    await soltar();
    await soltar();

    // Esperando: a rodada não tocou a rede nem leu o cofre.
    expect(supabase.from).not.toHaveBeenCalled();
    expect(servidor.consultasDeResumo).toBe(0);
    expect(servidor.consultasDeDetalhe).toBe(0);
    expect(cofre.getAllOrThrow).not.toHaveBeenCalled();

    // O catálogo termina de gravar no cofre e fecha o registro.
    cofre.gravarCatalogo([
      { id: "p1", name: "Produto p1", updatedAt: HORA_DO_SERVIDOR },
    ]);
    fechar();
    await rodada;

    // A rodada rodou (resumo consultado), achou o cofre em dia e NÃO baixou
    // nenhum produto por id.
    expect(servidor.consultasDeResumo).toBe(1);
    expect(servidor.consultasDeDetalhe).toBe(0);
    expect(
      tabelasConsultadas.filter((t) => t === "vw_produtos_public"),
    ).toHaveLength(1);
    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("promessa que nunca resolve: a rodada segue depois do prazo e baixa como hoje", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine, deposito, supabase } = await carregar();
    const cofre = dubleDeCofre();
    deposito.abrirCatalogoEmVoo(); // ninguém chama o fechar

    const rodada = engine.catchUp(cofre as any, false);
    await vi.advanceTimersByTimeAsync(
      deposito.PRAZO_DE_ESPERA_DO_CATALOGO_MS - 1,
    );
    expect(supabase.from).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await rodada;

    // Segue como hoje: cofre vazio => baixa por id.
    expect(servidor.consultasDeResumo).toBe(1);
    expect(servidor.consultasDeDetalhe).toBe(1);
    expect(cofre.putMany).toHaveBeenCalledTimes(1);
  });

  it('"Sair" durante a espera: nada é consultado nem gravado', async () => {
    const { engine, deposito, supabase } = await carregar();
    const cofre = dubleDeCofre();
    const fechar = deposito.abrirCatalogoEmVoo();

    const rodada = engine.catchUp(cofre as any, true);
    await soltar();
    engine.stop(); // o Sair: a geração do cofre muda
    fechar();
    await rodada;

    expect(supabase.from).not.toHaveBeenCalled();
    expect(cofre.getAllOrThrow).not.toHaveBeenCalled();
    expect(cofre.putMany).not.toHaveBeenCalled();
    expect(cofre.replaceAll).not.toHaveBeenCalled();
    expect(cofre.setLastSync).not.toHaveBeenCalled();
  });

  it("duas consultas registradas: espera a mais nova, não a primeira que terminar", async () => {
    const { engine, deposito, supabase } = await carregar();
    const cofre = dubleDeCofre();
    const fecharAntiga = deposito.abrirCatalogoEmVoo();
    const fecharNova = deposito.abrirCatalogoEmVoo();

    const rodada = engine.catchUp(cofre as any, false);
    fecharAntiga(); // a superada termina primeiro
    await soltar();
    await soltar();
    expect(supabase.from).not.toHaveBeenCalled();

    cofre.gravarCatalogo([
      { id: "p1", name: "Produto p1", updatedAt: HORA_DO_SERVIDOR },
    ]);
    fecharNova();
    await rodada;

    expect(servidor.consultasDeResumo).toBe(1);
    expect(servidor.consultasDeDetalhe).toBe(0);
  });

  it("consulta mais nova que abre com a rodada já esperando: espera por ela também", async () => {
    const { engine, deposito, supabase } = await carregar();
    const cofre = dubleDeCofre();
    const fecharPrimeira = deposito.abrirCatalogoEmVoo();

    const rodada = engine.catchUp(cofre as any, false);
    await soltar();
    const fecharSegunda = deposito.abrirCatalogoEmVoo(); // a lojista consultou de novo
    fecharPrimeira();
    await soltar();
    await soltar();
    expect(supabase.from).not.toHaveBeenCalled();

    cofre.gravarCatalogo([
      { id: "p1", name: "Produto p1", updatedAt: HORA_DO_SERVIDOR },
    ]);
    fecharSegunda();
    await rodada;

    expect(servidor.consultasDeResumo).toBe(1);
    expect(servidor.consultasDeDetalhe).toBe(0);
  });

  it("sem registro: as mesmas chamadas de hoje, na mesma ordem, sem criar relógio", async () => {
    // Relógio falso que NUNCA avança: se a rodada criasse um prazo e esperasse
    // por ele, ela nunca terminaria.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine } = await carregar();
    const cofre = dubleDeCofre();

    await engine.catchUp(cofre as any, false);

    expect(vi.getTimerCount()).toBe(0);
    expect(tabelasConsultadas).toEqual([
      "vw_produtos_public", // o resumo é montado primeiro
      "v_store_config",
      "categorias",
      "banners",
      "vw_produtos_public", // o detalhe por id (cofre vazio)
    ]);
    expect(servidor.consultasDeResumo).toBe(1);
    expect(servidor.consultasDeDetalhe).toBe(1);
    expect(cofre.putMany).toHaveBeenCalledTimes(1);
  });

  it("registro já fechado antes da rodada não segura nada", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine, deposito } = await carregar();
    const cofre = dubleDeCofre();
    deposito.abrirCatalogoEmVoo()();

    await engine.catchUp(cofre as any, false);

    expect(vi.getTimerCount()).toBe(0);
    expect(servidor.consultasDeResumo).toBe(1);
  });
});
