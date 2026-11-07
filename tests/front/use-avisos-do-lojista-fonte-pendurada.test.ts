// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e nao responde): uma so das oito fontes da tela de
// Avisos que nao voltasse deixava a tela inteira em "Atualizando os avisos...",
// com a lista vazia — sem os pedidos, perguntas e devolucoes que as outras
// fontes ja tinham trazido, e sem a frase "nao consegui conferir X", que so
// aparecia quando a fonte FALHAVA, nunca quando ela demorava para sempre.
//
// O que este arquivo prende:
// 1. fonte pendurada vira "fonte sem atualizacao" (`fontesComFalha`) passado o
//    prazo, e as outras aparecem normalmente;
// 2. o estoque, que le varias paginas, tambem tem prazo (pagina pendurada);
// 3. a resposta ATRASADA de uma rodada velha nao escreve por cima da rodada nova;
// 4. controle negativo: fonte lenta dentro do prazo NAO vira falha.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Fonte =
  | "pedidos"
  | "perguntas"
  | "devolucoes"
  | "privacidade"
  | "recebimentos"
  | "estoque";

// Portao por fonte, consumido na primeira consulta: a promessa dele decide
// quando (ou se) a resposta chega. A rodada seguinte ja encontra o caminho livre.
const PORTOES = new Map<Fonte, Promise<void>>();
let PEDIDOS_DA_VEZ: unknown[] = [];

const { loadProductsFalso } = vi.hoisted(() => ({
  loadProductsFalso: vi.fn(),
}));

function esperar<T>(fonte: Fonte, resposta: T): Promise<T> {
  const portao = PORTOES.get(fonte);
  if (!portao) return Promise.resolve(resposta);
  PORTOES.delete(fonte);
  return portao.then(() => resposta);
}

function criarBuilder(tabela: string) {
  const builder: Record<string, unknown> = {};
  let ehRecebimento = false;
  for (const nome of [
    "select",
    "in",
    "or",
    "is",
    "not",
    "gte",
    "order",
    "limit",
  ]) {
    Reflect.set(
      builder,
      nome,
      vi.fn(() => builder),
    );
  }
  builder.eq = vi.fn((coluna: string, valor: string) => {
    if (coluna === "status" && valor === "delivered") ehRecebimento = true;
    return builder;
  });
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  // biome-ignore lint/suspicious/noThenProperty: duble do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) => {
    let resposta: Promise<unknown>;
    if (tabela === "pedidos_de_privacidade") {
      resposta = esperar("privacidade", { data: null, count: 0, error: null });
    } else if (tabela === "marketplace_orders" && ehRecebimento) {
      resposta = esperar("recebimentos", { data: [], error: null });
    } else if (tabela === "marketplace_orders") {
      resposta = esperar("pedidos", { data: PEDIDOS_DA_VEZ, error: null });
    } else {
      resposta = Promise.resolve({ data: [], error: null });
    }
    return resposta.then(resolve as never, reject as never);
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => criarBuilder(tabela)),
    rpc: vi.fn((nome: string) =>
      nome === "admin_devolucoes_listar"
        ? esperar("devolucoes", {
            data: { total: 0, contagem: { solicitada: 0 }, itens: [] },
            error: null,
          })
        : esperar("perguntas", { data: { total_count: 3 }, error: null }),
    ),
  },
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: loadProductsFalso }),
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface LeituraDoHook {
  avisos: Array<{ tipo: string; titulo: string }>;
  carregando: boolean;
  fontesComFalha: string[];
  recarregar: () => void;
}

const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda() {
  const { useAvisosDoLojista } = await import("@/hooks/useAvisosDoLojista");
  const leituras: LeituraDoHook[] = [];
  function Sonda() {
    leituras.push(useAvisosDoLojista() as unknown as LeituraDoHook);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  return () => leituras[leituras.length - 1];
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const PARA_SEMPRE = new Promise<void>(() => {});

function pedido(nome: string) {
  return {
    id: `ped-${nome}`,
    customer_name: nome,
    total: 90,
    created_at: "2026-08-24T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  PORTOES.clear();
  PEDIDOS_DA_VEZ = [pedido("Maria")];
  loadProductsFalso.mockImplementation(() =>
    esperar("estoque", { products: [], total: 0 }),
  );
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => {
      raiz.unmount();
    });
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useAvisosDoLojista — fonte que nunca responde", () => {
  it("passado o prazo, a fonte pendurada vira falha e as outras aparecem", async () => {
    PORTOES.set("pedidos", PARA_SEMPRE);
    const atual = await montarSonda();

    // Dentro do prazo ainda esta atualizando, sem inventar falha.
    await passar(5_000);
    expect(atual().carregando).toBe(true);
    expect(atual().fontesComFalha).toEqual([]);

    await passar(20_000);

    expect(atual().carregando).toBe(false);
    expect(atual().fontesComFalha).toEqual(["pedido"]);
    // As outras fontes responderam e nao ficam escondidas pela que travou.
    expect(atual().avisos.map((a) => a.tipo)).toContain("pergunta");
    expect(atual().avisos.map((a) => a.tipo)).not.toContain("pedido");
  });

  it("uma pagina de estoque pendurada tambem vira falha do estoque, sem esconder o resto", async () => {
    PORTOES.set("estoque", PARA_SEMPRE);
    const atual = await montarSonda();

    await passar(20_000);

    expect(atual().carregando).toBe(false);
    expect(atual().fontesComFalha).toEqual(["estoque"]);
    expect(atual().avisos.map((a) => a.tipo)).toContain("pedido");
  });

  it("varias fontes penduradas ao mesmo tempo: todas entram na lista de falhas", async () => {
    PORTOES.set("pedidos", PARA_SEMPRE);
    PORTOES.set("devolucoes", PARA_SEMPRE);
    PORTOES.set("privacidade", PARA_SEMPRE);
    PORTOES.set("recebimentos", PARA_SEMPRE);
    const atual = await montarSonda();

    await passar(20_000);

    expect(atual().carregando).toBe(false);
    expect([...atual().fontesComFalha].sort()).toEqual([
      "devolucao",
      "pedido",
      "privacidade",
      "recebimento",
    ]);
    expect(atual().avisos.map((a) => a.tipo)).toContain("pergunta");
  });

  it("a resposta atrasada da rodada velha nao escreve por cima da rodada nova", async () => {
    let soltarAtrasada!: () => void;
    PORTOES.set(
      "pedidos",
      new Promise<void>((resolve) => {
        soltarAtrasada = resolve;
      }),
    );
    const atual = await montarSonda();
    await passar(20_000);
    expect(atual().fontesComFalha).toEqual(["pedido"]);

    // Tentar de novo: a rodada nova acha a rede livre e traz a Maria.
    await act(async () => {
      atual().recarregar();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(atual().fontesComFalha).toEqual([]);
    expect(
      atual()
        .avisos.map((a) => a.titulo)
        .join(" "),
    ).toContain("Maria");

    // A consulta velha acorda tarde, com OUTRO retrato do banco.
    PEDIDOS_DA_VEZ = [pedido("Joana")];
    await act(async () => {
      soltarAtrasada();
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(atual().fontesComFalha).toEqual([]);
    const titulos = atual()
      .avisos.map((a) => a.titulo)
      .join(" ");
    expect(titulos).toContain("Maria");
    expect(titulos).not.toContain("Joana");
  });

  it("controle: fonte lenta dentro do prazo NAO vira falha", async () => {
    let soltar!: () => void;
    PORTOES.set(
      "pedidos",
      new Promise<void>((resolve) => {
        soltar = resolve;
      }),
    );
    const atual = await montarSonda();

    await passar(10_000);
    expect(atual().carregando).toBe(true);

    await act(async () => {
      soltar();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(atual().carregando).toBe(false);
    expect(atual().fontesComFalha).toEqual([]);
    expect(atual().avisos.map((a) => a.tipo)).toContain("pedido");
  });
});
