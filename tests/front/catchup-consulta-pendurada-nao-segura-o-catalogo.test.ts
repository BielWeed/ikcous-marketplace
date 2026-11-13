// @vitest-environment jsdom
//
// "VOLTOU A INTERNET E O PREÇO CONTINUA VELHO": UMA CONSULTA PENDURADA NÃO
// SEGURA A RODADA DE SINCRONIZAÇÃO (13/11/2026).
//
// O DEFEITO: o `catchUp` pede quatro consultas em paralelo (configuração,
// categorias, banners e o resumo dos produtos) e espera as quatro SEM PRAZO. Rede
// "pendurada" conecta e não responde: enquanto UMA delas ficava sem resposta, a
// rodada inteira ficava parada e a trava `_isCatchingUp` seguia ligada. Toda
// retomada seguinte (voltar à aba, `online`) caía na trava e saía na hora: o
// preço antigo permanecia na vitrine mesmo com a conexão já boa, até a resposta
// velha chegar (se chegasse).
//
// O CONSERTO: prazo POR CONSULTA (`aguardarComPrazo`, 20 s). Estourou = aquela
// consulta vira `{ data: null, error }` (a mesma forma da falha comum, que o
// método já sabe pular), as OUTRAS seguem, a trava solta no `finally` e a
// próxima rodada tenta de novo. A resposta tardia da consulta abandonada é
// descartada: nada a aplica depois que outra rodada já gravou dado mais novo.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. banners pendurados: o preço novo chega ao cofre ao fim do prazo, e a
//      rodada seguinte já roda (trava solta) e grava os banners;
//   2. antes do prazo a trava segura (a rodada não é aberta em duplicata);
//   3. a resposta tardia dos banners abandonados não sobrescreve os novos;
//   4. resumo pendurado: NADA é apagado do cofre (resumo ausente nunca autoriza
//      exclusão), mas categorias e banners seguem;
//   5. configuração pendurada: categorias, banners e produtos seguem;
//   6. detalhe do produto pendurado: a trava solta e a rodada seguinte regrava;
//   7. controle: rodada rápida não deixa temporizador vivo;
//   8. falha que NÃO é prazo (a rede lança) segue o caminho de sempre: a rodada
//      acaba, sem gravar, e a trava solta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRAZO_MS = 20_000;
const ANTIGO = "2026-01-01T00:00:00.000Z";
const NOVO = "2026-11-13T10:00:00.000Z";

type Resposta = { data: unknown; error: unknown };

const nunca = (): Promise<Resposta> => new Promise<Resposta>(() => {});

// Cada tabela tem uma fila de atendimentos (um por consulta); fila vazia =
// resposta do `padrao` da tabela.
const servidor = vi.hoisted(() => ({
  filas: new Map<string, Array<() => Promise<unknown>>>(),
  padrao: new Map<string, unknown>(),
  consultas: new Map<string, number>(),
}));

function responder(tabela: string): Promise<Resposta> {
  servidor.consultas.set(tabela, (servidor.consultas.get(tabela) ?? 0) + 1);
  const proximo = servidor.filas.get(tabela)?.shift();
  if (proximo) return proximo() as Promise<Resposta>;
  return Promise.resolve({
    data: servidor.padrao.get(tabela) ?? null,
    error: null,
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      let ehDetalhe = false;
      const nome = () => (ehDetalhe ? `${tabela}#detalhe` : tabela);
      const consulta: any = {};
      consulta.select = vi.fn(() => consulta);
      consulta.is = vi.fn(() => consulta);
      consulta.gt = vi.fn(() => consulta);
      consulta.order = vi.fn(() => consulta);
      consulta.limit = vi.fn(() => consulta);
      consulta.in = vi.fn(() => {
        ehDetalhe = true;
        return consulta;
      });
      consulta.single = vi.fn(() => responder(nome()));
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
      consulta.then = (
        onOk: (v: Resposta) => unknown,
        onErro: (e: unknown) => unknown,
      ) => responder(nome()).then(onOk, onErro);
      return consulta;
    }),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })) })),
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

function dubleDeCofre(locais: unknown[] = []) {
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async (_gaveta?: string) => locais),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async (_gaveta?: string, _itens?: unknown[]) => {}),
    deleteById: vi.fn(async (_gaveta?: string, _id?: string) => {}),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(async (_gaveta?: string, _itens?: unknown[]) => {}),
    getByIndex: vi.fn(async () => [] as unknown[]),
  };
}

const produtoLocal = (id: string, preco: number) => ({
  id,
  name: `Produto ${id}`,
  price: preco,
  updatedAt: ANTIGO,
  createdAt: ANTIGO,
});

const produtoDoServidor = (id: string, preco: number) => ({
  id,
  nome: `Produto ${id}`,
  preco_venda: preco,
  estoque: 1,
  ativo: true,
  product_variants: [],
});

const banner = (id: string) => ({
  id,
  image_url: `https://img.test/${id}.jpg`,
  title: id,
  order: 1,
});

async function motor() {
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
  return RealtimeSyncEngine;
}

/**
 * Abre uma rodada e anota quando ela TERMINA: assim o teste confere "acabou"
 * antes de esperá-la (sem isto, a rodada presa deixaria o teste pendurado em
 * vez de reprovar com a frase certa).
 */
function abrirRodada(
  engine: Awaited<ReturnType<typeof motor>>,
  cofre: ReturnType<typeof dubleDeCofre>,
) {
  const estado = { terminou: false };
  const fim = engine.catchUp(cofre as any, true).then(() => {
    estado.terminou = true;
  });
  return { estado, fim };
}

/** Deixa as promessas já resolvidas correrem (sem mexer no relógio falso). */
const soltar = () => vi.advanceTimersByTimeAsync(0);

/** Preço que a rodada mandou gravar para o produto `id`, ou undefined. */
function precoGravado(
  cofre: ReturnType<typeof dubleDeCofre>,
  id: string,
): number | undefined {
  for (const [gaveta, itens] of cofre.putMany.mock.calls) {
    if (gaveta !== "products") continue;
    for (const item of (itens ?? []) as Array<{ id: string; price: number }>) {
      if (item.id === id) return item.price;
    }
  }
  return undefined;
}

const gavetasSubstituidas = (cofre: ReturnType<typeof dubleDeCofre>) =>
  cofre.replaceAll.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  servidor.filas.clear();
  servidor.consultas.clear();
  servidor.padrao.clear();
  servidor.padrao.set("produtos", [{ id: "p1", ultima_atualizacao: NOVO }]);
  servidor.padrao.set("vw_produtos_admin#detalhe", [
    produtoDoServidor("p1", 25),
  ]);
  servidor.padrao.set("categorias", []);
  servidor.padrao.set("banners", [banner("b-novo")]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("catchUp: consulta pendurada não segura a rodada", () => {
  it("banners pendurados: o preço novo chega ao cofre ao fim do prazo e a rodada seguinte já roda", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);
    servidor.filas.set("banners", [nunca]);

    const rodada1 = abrirRodada(engine, cofre);
    await soltar();
    expect(precoGravado(cofre, "p1")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(PRAZO_MS);

    // O preço novo está no cofre sem esperar os banners que nunca chegam.
    expect(precoGravado(cofre, "p1")).toBe(25);
    expect(gavetasSubstituidas(cofre)).not.toContain("banners");
    expect(rodada1.estado.terminou).toBe(true);
    await rodada1.fim;

    // A trava soltou: a segunda rodada roda e grava os banners.
    const rodada2 = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(0);
    expect(rodada2.estado.terminou).toBe(true);
    await rodada2.fim;
    expect(servidor.consultas.get("banners")).toBe(2);
    expect(gavetasSubstituidas(cofre)).toContain("banners");
  });

  it("antes do prazo a trava segura: a retomada não abre rodada em duplicata", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);
    servidor.filas.set("banners", [nunca]);

    const rodada1 = abrirRodada(engine, cofre);
    await soltar();
    await vi.advanceTimersByTimeAsync(PRAZO_MS - 1);

    await engine.catchUp(cofre as any, true); // cai na trava e sai na hora
    expect(servidor.consultas.get("produtos")).toBe(1);
    expect(servidor.consultas.get("banners")).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(rodada1.estado.terminou).toBe(true);
    await rodada1.fim;
  });

  it("a resposta tardia dos banners abandonados não sobrescreve os que a rodada seguinte gravou", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);
    let entregarTarde!: (r: Resposta) => void;
    servidor.filas.set("banners", [
      () => new Promise<Resposta>((resolve) => (entregarTarde = resolve)),
    ]);

    const rodada1 = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(PRAZO_MS);
    expect(rodada1.estado.terminou).toBe(true);
    await rodada1.fim;

    const rodada2 = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(0);
    expect(rodada2.estado.terminou).toBe(true);
    await rodada2.fim;
    const bannersAntes = cofre.replaceAll.mock.calls.filter(
      (c) => c[0] === "banners",
    );
    expect(bannersAntes).toHaveLength(1);

    // A resposta velha chega agora, com a vitrine antiga.
    entregarTarde({ data: [banner("b-velho")], error: null });
    await vi.advanceTimersByTimeAsync(0);

    const bannersDepois = cofre.replaceAll.mock.calls.filter(
      (c) => c[0] === "banners",
    );
    expect(bannersDepois).toHaveLength(1);
    expect(JSON.stringify(bannersDepois[0]?.[1])).toContain("b-novo");
    expect(JSON.stringify(bannersDepois[0]?.[1])).not.toContain("b-velho");
  });

  it("resumo dos produtos pendurado: nada é apagado do cofre, mas categorias e banners seguem", async () => {
    const engine = await motor();
    // O cofre tem um produto que o servidor "não lista" porque o resumo não veio.
    const cofre = dubleDeCofre([produtoLocal("fantasma", 10)]);
    servidor.filas.set("produtos", [nunca]);
    servidor.padrao.set("categorias", [{ id: "c1", nome: "Cabos" }]);

    const rodada = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(PRAZO_MS);
    expect(rodada.estado.terminou).toBe(true);
    await rodada.fim;

    expect(cofre.deleteById).not.toHaveBeenCalled();
    expect(cofre.putMany).not.toHaveBeenCalled();
    expect(gavetasSubstituidas(cofre)).toEqual(
      expect.arrayContaining(["categories", "banners"]),
    );

    // E a trava soltou: a rodada seguinte reconcilia de verdade.
    const rodada2 = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(0);
    expect(rodada2.estado.terminou).toBe(true);
    await rodada2.fim;
    expect(precoGravado(cofre, "p1")).toBe(25);
  });

  it("configuração pendurada: categorias, banners e produtos seguem", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);
    servidor.filas.set("store_config", [nunca]);
    servidor.padrao.set("categorias", [{ id: "c1", nome: "Cabos" }]);

    const rodada = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(PRAZO_MS);
    expect(rodada.estado.terminou).toBe(true);
    await rodada.fim;

    expect(precoGravado(cofre, "p1")).toBe(25);
    expect(gavetasSubstituidas(cofre)).toEqual(
      expect.arrayContaining(["categories", "banners"]),
    );
  });

  it("detalhe do produto pendurado: a trava solta e a rodada seguinte regrava o preço", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);
    servidor.filas.set("vw_produtos_admin#detalhe", [nunca]);

    const rodada1 = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(PRAZO_MS);
    expect(rodada1.estado.terminou).toBe(true);
    await rodada1.fim;
    expect(precoGravado(cofre, "p1")).toBeUndefined();

    const rodada2 = abrirRodada(engine, cofre);
    await vi.advanceTimersByTimeAsync(0);
    expect(rodada2.estado.terminou).toBe(true);
    await rodada2.fim;
    expect(precoGravado(cofre, "p1")).toBe(25);
  });

  it("controle: rodada rápida grava tudo e não deixa temporizador vivo", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);

    await engine.catchUp(cofre as any, true);

    expect(precoGravado(cofre, "p1")).toBe(25);
    expect(gavetasSubstituidas(cofre)).toContain("banners");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falha que não é prazo (a rede lança): a rodada acaba sem gravar e a trava solta", async () => {
    const engine = await motor();
    const cofre = dubleDeCofre([produtoLocal("p1", 10)]);
    servidor.filas.set("banners", [
      () => Promise.reject(new Error("rede caiu")),
    ]);

    await engine.catchUp(cofre as any, true);
    expect(cofre.putMany).not.toHaveBeenCalled();

    // Trava solta: a rodada seguinte grava normalmente.
    await engine.catchUp(cofre as any, true);
    expect(precoGravado(cofre, "p1")).toBe(25);
  });
});
