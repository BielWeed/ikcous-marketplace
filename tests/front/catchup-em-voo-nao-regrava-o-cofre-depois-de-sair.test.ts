// @vitest-environment jsdom
//
// UMA RODADA DE SINCRONIZAÇÃO EM VOO NÃO REGRAVA O COFRE DEPOIS DO "SAIR"
// (caça 4, ressalva K1, 25/10/2026).
//
// O DEFEITO: o "Sair" esvazia as gavetas `products` e `product_variants` do
// cofre local (IndexedDB) de quem era lojista -- o catálogo de ADMIN traz o
// CUSTO. Mas um `catchUp` que já estava a caminho (resposta do servidor ainda
// na rede) terminava DEPOIS da limpeza e gravava o catálogo com custo de volta
// no aparelho. Tablet de balcão compartilhado: o custo ficava legível no
// DevTools depois do Sair.
//
// O CONSERTO: um contador de geração (src/lib/geracao-do-cofre.ts). O
// `stop()` do motor e o esquecimento do "Sair" (lojista) o incrementam; cada
// rodada captura a geração ao começar e, DEPOIS de cada espera e ANTES de cada
// escrita, confere. Geração diferente => a rodada se descarta sem gravar.
//
// O QUE ESTA SUÍTE TRAVA (cada caso cai se a conferência correspondente sair):
//   1. detalhe do produto em voo + stop()  => nada vai ao cofre;
//   2. resumo (1ª consulta) em voo + stop() => nenhuma gaveta é tocada;
//   3. lote 2 de detalhes em voo + stop()   => nem o lote 1 é gravado;
//   4. stop() no meio da gravação dos produtos => as variações não são gravadas;
//   5. leitura do cofre local em voo + stop() => nada é apagado do cofre;
//   6. o outro lado: rodada normal grava; rodada da sessão NOVA (A -> B)
//      grava mesmo com a da sessão antiga ainda pendente, e a antiga, ao
//      terminar, não grava nem solta a trava da nova;
//   7. o aviso às OUTRAS abas (que levaria o custo e as faria gravar) também
//      não sai de uma rodada descartada;
//   8. o "Sair" de lojista (esquecerCofreDeQuemSaiu(true)) invalida; o de
//      cliente comum (false) não.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: unknown; error: null };
type Portao<T> = { promessa: Promise<T>; abrir: (valor: T) => void };

function criarPortao<T>(): Portao<T> {
  let abrir!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    abrir = resolve;
  });
  return { promessa, abrir };
}

// O que as rodadas mandaram às outras abas (BroadcastChannel é dublê aqui).
const avisosAsOutrasAbas = vi.hoisted(() => [] as Array<{ type?: string }>);

const servidor = vi.hoisted(() => ({
  // Cada consulta de resumo/detalhe tira a próxima resposta da fila; fila
  // vazia = resposta imediata com `padrao*`.
  filaDeResumos: [] as Array<() => Promise<unknown>>,
  filaDeDetalhes: [] as Array<() => Promise<unknown>>,
  resumoPadrao: [] as unknown[],
  detalhePadrao: [] as unknown[],
  categorias: [] as unknown[],
  consultasDeResumo: 0,
  consultasDeDetalhe: 0,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      if (
        tabela === "produtos" ||
        tabela === "vw_produtos_admin" ||
        tabela === "vw_produtos_public"
      ) {
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
    let resposta: Promise<unknown>;
    if (ehDetalhe) {
      servidor.consultasDeDetalhe += 1;
      const proxima = servidor.filaDeDetalhes.shift();
      resposta = proxima
        ? proxima()
        : Promise.resolve({ data: servidor.detalhePadrao, error: null });
    } else {
      servidor.consultasDeResumo += 1;
      const proxima = servidor.filaDeResumos.shift();
      resposta = proxima
        ? proxima()
        : Promise.resolve({ data: servidor.resumoPadrao, error: null });
    }
    return (resposta as Promise<Resposta>).then(onOk, onErro);
  };
  return consulta;
}

function builderDeOutraTabela(tabela: string): any {
  const consulta: any = {};
  const dados = tabela === "categorias" ? servidor.categorias : null;
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
  ) => Promise.resolve({ data: dados, error: null }).then(onOk, onErro);
  return consulta;
}

function dubleDeCofre() {
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async (_loja?: string) => [] as unknown[]),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async (_loja?: string, _itens?: unknown[]) => {}),
    deleteById: vi.fn(async (_loja?: string, _id?: string) => {}),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(),
    getByIndex: vi.fn(async () => [] as unknown[]),
  };
}

function produtoDoServidor(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    nome: `Produto ${id}`,
    preco_venda: 10,
    custo: 12.5,
    estoque: 1,
    ativo: true,
    product_variants: [],
    ...extra,
  };
}

function resumoDe(ids: string[]) {
  return ids.map((id) => ({
    id,
    ultima_atualizacao: "2026-10-25T00:00:00.000Z",
  }));
}

// A trava do motor é de módulo: um import fresco por teste evita herdar
// rodada pendente de um caso para o outro.
async function motor() {
  vi.resetModules();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage(mensagem: { type?: string }) {
        avisosAsOutrasAbas.push(mensagem);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
  return RealtimeSyncEngine;
}

/** Deixa as promessas já resolvidas correrem até o próximo ponto de espera. */
const soltar = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("catchUp em voo não regrava o cofre depois do Sair (K1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    avisosAsOutrasAbas.length = 0;
    servidor.filaDeResumos = [];
    servidor.filaDeDetalhes = [];
    servidor.resumoPadrao = resumoDe(["p1"]);
    servidor.detalhePadrao = [produtoDoServidor("p1")];
    servidor.categorias = [];
    servidor.consultasDeResumo = 0;
    servidor.consultasDeDetalhe = 0;
  });

  it("rodada normal, sem Sair no meio, grava produtos e marca a sincronia (controle)", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();

    await engine.catchUp(cofre as any, true);

    expect(cofre.putMany).toHaveBeenCalledTimes(1);
    expect(cofre.putMany.mock.calls.at(0)?.[0]).toBe("products");
    expect(cofre.setLastSync).toHaveBeenCalledWith("products");
  });

  it("detalhe do produto (com custo) em voo + stop(): nada é gravado nem avisado", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    const aviso = vi.fn();
    const sair = engine.onSync(aviso);
    const portao = criarPortao<unknown>();
    servidor.filaDeDetalhes.push(() => portao.promessa);

    const rodada = engine.catchUp(cofre as any, true);
    await soltar(); // a rodada chegou ao detalhe e espera a rede
    expect(servidor.consultasDeDetalhe).toBe(1);

    engine.stop(); // o Sair
    portao.abrir({ data: [produtoDoServidor("p1")], error: null });
    await rodada;
    sair();

    // As categorias da rodada foram gravadas ANTES do Sair (a rodada era
    // legítima até ali); o que não pode existir é produto depois dele.
    expect(cofre.putMany).not.toHaveBeenCalled();
    expect(cofre.setLastSync).not.toHaveBeenCalledWith("products");
    expect(cofre.setLastSync).not.toHaveBeenCalledWith("product_variants");
    const avisados = aviso.mock.calls.map((c) => c[0]?.store);
    expect(avisados).not.toContain("products");
    expect(avisosAsOutrasAbas.map((m) => m.type)).not.toContain(
      "db_change_bulk_products",
    );
  });

  it("resumo em voo + stop(): nenhuma gaveta é tocada (categorias, leitura, produtos)", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    servidor.categorias = [{ id: "c1", nome: "Cabos" }];
    const portao = criarPortao<unknown>();
    servidor.filaDeResumos.push(() => portao.promessa);

    const rodada = engine.catchUp(cofre as any, true);
    await soltar();
    engine.stop();
    portao.abrir({ data: resumoDe(["p1"]), error: null });
    await rodada;

    expect(cofre.replaceAll).not.toHaveBeenCalled();
    expect(cofre.getAllOrThrow).not.toHaveBeenCalled();
    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("lote 2 de detalhes em voo + stop(): nem o lote 1, que já tinha chegado, é gravado", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
    servidor.resumoPadrao = resumoDe(ids);
    const portao2 = criarPortao<unknown>();
    servidor.filaDeDetalhes.push(
      () =>
        Promise.resolve({
          data: ids.slice(0, 100).map((id) => produtoDoServidor(id)),
          error: null,
        }),
      () => portao2.promessa,
    );

    const rodada = engine.catchUp(cofre as any, true);
    await soltar();
    expect(servidor.consultasDeDetalhe).toBe(2);
    engine.stop();
    portao2.abrir({
      data: ids.slice(100).map((id) => produtoDoServidor(id)),
      error: null,
    });
    await rodada;

    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("stop() no meio da gravação dos produtos: as variações não são gravadas", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    servidor.detalhePadrao = [
      produtoDoServidor("p1", {
        product_variants: [
          {
            id: "v1",
            product_id: "p1",
            nome: "Preto",
            estoque: 2,
            ativo: true,
          },
        ],
      }),
    ];
    // O Sair cai enquanto o cofre ainda grava os produtos.
    cofre.putMany.mockImplementationOnce(async () => {
      engine.stop();
    });

    await engine.catchUp(cofre as any, true);

    const gavetas = cofre.putMany.mock.calls.map((c) => c[0]);
    expect(gavetas).toEqual(["products"]);
  });

  it("leitura do cofre local em voo + stop(): nada é apagado nem gravado", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    const portao = criarPortao<unknown[]>();
    // O cofre local tem um produto que o servidor já não lista.
    cofre.getAllOrThrow.mockImplementationOnce(() => portao.promessa);
    servidor.resumoPadrao = resumoDe(["p1"]);

    const rodada = engine.catchUp(cofre as any, true);
    await soltar();
    engine.stop();
    portao.abrir([{ id: "fantasma", updatedAt: "2026-01-01T00:00:00.000Z" }]);
    await rodada;

    expect(cofre.deleteById).not.toHaveBeenCalled();
    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("stop() durante a gravação das variações: o aviso às outras abas (com custo) não sai", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    servidor.detalhePadrao = [
      produtoDoServidor("p1", {
        product_variants: [
          {
            id: "v1",
            product_id: "p1",
            nome: "Preto",
            estoque: 2,
            ativo: true,
          },
        ],
      }),
    ];
    // A 1ª gravação (produtos) passa; a das variações é a que vê o Sair cair.
    cofre.putMany.mockImplementation(async (loja?: string) => {
      if (loja === "product_variants") engine.stop();
    });

    await engine.catchUp(cofre as any, true);

    expect(cofre.putMany.mock.calls.map((c) => c[0])).toEqual([
      "products",
      "product_variants",
    ]);
    expect(avisosAsOutrasAbas.map((m) => m.type)).not.toContain(
      "db_change_bulk_products",
    );
  });

  it("controle do aviso: rodada normal avisa as outras abas dos produtos", async () => {
    const engine = await motor();
    await engine.catchUp(dubleDeCofre() as any, true);

    expect(avisosAsOutrasAbas.map((m) => m.type)).toContain(
      "db_change_bulk_products",
    );
  });

  it("stop() logo depois de chamar a rodada: nem uma consulta vai à rede", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();

    const rodada = engine.catchUp(cofre as any, true);
    engine.stop(); // antes de a rodada ter qualquer chance de consultar
    await rodada;

    expect(servidor.consultasDeResumo).toBe(0);
    expect(servidor.consultasDeDetalhe).toBe(0);
    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("leitura do cofre em voo + stop(), cofre vazio: nenhuma consulta de detalhe é gasta", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    const portao = criarPortao<unknown[]>();
    cofre.getAllOrThrow.mockImplementationOnce(() => portao.promessa);

    const rodada = engine.catchUp(cofre as any, true);
    await soltar();
    engine.stop();
    portao.abrir([]); // p1 pareceria "faltando no cofre" e seria buscado
    await rodada;

    expect(servidor.consultasDeDetalhe).toBe(0);
    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("stop() no meio das exclusões: o 2º produto fantasma não é apagado", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    servidor.resumoPadrao = resumoDe(["p1"]);
    cofre.getAllOrThrow.mockResolvedValueOnce([
      { id: "g1", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "g2", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "p1", updatedAt: "2026-10-25T00:00:00.000Z" },
    ]);
    // g1 tem uma variação; o Sair cai ao apagá-la, ainda dentro da iteração de g1.
    cofre.getByIndex.mockResolvedValueOnce([{ id: "v-de-g1" }]);
    cofre.deleteById.mockImplementation(async (_loja?: string, id?: string) => {
      if (id === "v-de-g1") engine.stop();
    });

    await engine.catchUp(cofre as any, true);

    const apagados = cofre.deleteById.mock.calls.map((c) => c[1]);
    expect(apagados).toEqual(["g1", "v-de-g1"]);
  });

  it("stop() ao apagar a última variação: a marca de sincronia das exclusões não é gravada", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();
    servidor.resumoPadrao = resumoDe(["p1"]);
    cofre.getAllOrThrow.mockResolvedValueOnce([
      { id: "g1", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "p1", updatedAt: "2026-10-25T00:00:00.000Z" },
    ]);
    cofre.getByIndex.mockResolvedValueOnce([{ id: "v-de-g1" }]);
    cofre.deleteById.mockImplementation(async (_loja?: string, id?: string) => {
      if (id === "v-de-g1") engine.stop();
    });

    await engine.catchUp(cofre as any, true);

    expect(cofre.setLastSync).not.toHaveBeenCalledWith("products");
    expect(cofre.setLastSync).not.toHaveBeenCalledWith("product_variants");
  });

  it("sessão NOVA (A -> B): a rodada nova grava; a antiga, ao terminar, não grava", async () => {
    const engine = await motor();
    const cofreA = dubleDeCofre();
    const cofreB = dubleDeCofre();
    const portaoDeA = criarPortao<unknown>();
    servidor.filaDeDetalhes.push(() => portaoDeA.promessa);

    const rodadaA = engine.catchUp(cofreA as any, true);
    await soltar();

    // A sai e B entra: stop() + start() da sessão nova dispara a rodada de B
    // enquanto a de A ainda espera a rede.
    engine.stop();
    const rodadaB = engine.catchUp(cofreB as any, true);
    await rodadaB;

    expect(servidor.consultasDeDetalhe).toBe(2); // B NÃO foi barrada pela trava de A
    expect(cofreB.putMany).toHaveBeenCalledTimes(1);
    expect(cofreB.putMany.mock.calls.at(0)?.[0]).toBe("products");

    portaoDeA.abrir({ data: [produtoDoServidor("p1")], error: null });
    await rodadaA;

    expect(cofreA.putMany).not.toHaveBeenCalled();
    expect(cofreA.setLastSync).not.toHaveBeenCalledWith("products");
  });

  it("a antiga, ao terminar, não solta a trava da rodada nova que ainda está em voo", async () => {
    const engine = await motor();
    const cofreA = dubleDeCofre();
    const cofreB = dubleDeCofre();
    const cofreC = dubleDeCofre();
    const portaoDeA = criarPortao<unknown>();
    const portaoDeB = criarPortao<unknown>();
    servidor.filaDeDetalhes.push(
      () => portaoDeA.promessa,
      () => portaoDeB.promessa,
    );

    const rodadaA = engine.catchUp(cofreA as any, true);
    await soltar();
    engine.stop();
    const rodadaB = engine.catchUp(cofreB as any, true);
    await soltar();
    expect(servidor.consultasDeResumo).toBe(2);

    // A termina primeiro, B segue em voo: uma terceira chamada da MESMA
    // sessão de B tem de ser barrada pela trava (rodada concorrente).
    portaoDeA.abrir({ data: [produtoDoServidor("p1")], error: null });
    await rodadaA;
    await engine.catchUp(cofreC as any, true);
    expect(servidor.consultasDeResumo).toBe(2);
    expect(cofreC.putMany).not.toHaveBeenCalled();

    portaoDeB.abrir({ data: [produtoDoServidor("p1")], error: null });
    await rodadaB;
    expect(cofreB.putMany).toHaveBeenCalledTimes(1);
    expect(cofreA.putMany).not.toHaveBeenCalled();

    // Trava solta no fim: a próxima rodada roda.
    await engine.catchUp(cofreC as any, true);
    expect(cofreC.putMany).toHaveBeenCalledTimes(1);
  });

  it("stop() sem rodada em voo não atrapalha a próxima (reinício normal do motor)", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre();

    engine.stop();
    engine.stop();
    await engine.catchUp(cofre as any, true);

    expect(cofre.putMany).toHaveBeenCalledTimes(1);
  });
});

describe("esquecerCofreDeQuemSaiu invalida a rodada em voo (K1)", () => {
  beforeEach(() => {
    servidor.filaDeResumos = [];
    servidor.filaDeDetalhes = [];
    servidor.resumoPadrao = resumoDe(["p1"]);
    servidor.detalhePadrao = [produtoDoServidor("p1")];
    servidor.categorias = [];
    servidor.consultasDeResumo = 0;
    servidor.consultasDeDetalhe = 0;
  });

  async function rodadaEmVooAteOSair(eraLojista: boolean) {
    vi.resetModules();
    // O dublê do cofre real que o "Sair" abre para limpar: só importa que ele
    // exista e limpe. A rodada do motor usa o seu próprio dublê.
    vi.doMock("@/lib/dataVault", () => ({
      DataVault: {
        init: vi.fn(async () => ({ clear: vi.fn(async () => {}) })),
      },
    }));
    const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    const cofre = dubleDeCofre();
    const portao = criarPortao<unknown>();
    servidor.filaDeDetalhes.push(() => portao.promessa);

    const rodada = RealtimeSyncEngine.catchUp(cofre as any, true);
    await soltar();
    // O Sair NÃO chama stop(): na troca direta de conta (A -> B, os dois
    // lojistas) o motor segue de pé e só o esquecimento avisa a rodada.
    esquecerCofreDeQuemSaiu(eraLojista);
    portao.abrir({ data: [produtoDoServidor("p1")], error: null });
    await rodada;
    vi.doUnmock("@/lib/dataVault");
    return cofre;
  }

  it("quem saiu era lojista: a rodada em voo se descarta", async () => {
    const cofre = await rodadaEmVooAteOSair(true);
    expect(cofre.putMany).not.toHaveBeenCalled();
  });

  it("quem saiu era cliente comum: o catálogo público da rodada em voo ainda é gravado", async () => {
    const cofre = await rodadaEmVooAteOSair(false);
    expect(cofre.putMany).toHaveBeenCalledTimes(1);
  });
});
