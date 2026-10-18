// @vitest-environment jsdom
//
// Balcão — a busca de produto por nome não pode esconder produto nem calar
// quando falha. Na loja real a maior parte do catálogo tem variação e nenhuma
// peça tem código de barras: buscar por nome é o caminho principal do caixa.
// Antes, a busca pedia 8 produtos, jogava fora o total que o banco devolve e
// não dizia nada quando voltava vazia ou quando a rede falhava: a lojista
// achava que "vestido" tinha 8 produtos quando tinha 22.
//
// A RPC (`get_admin_products_paged`) não muda: este teste só confere o que a
// tela faz com a página e com o `total_count` que ela já devolve.
//
// Molde de montagem: admin-pdv-cupom-e-cliente.test.tsx (AdminPdvView com o
// Supabase dublado e o leitor de câmera trocado por um botão).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: () => null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const POR_PAGINA = 8;

/** Um produto "Vestido N" simples, sem variação, no formato da RPC. */
function produto(numero: number) {
  return {
    id: `produto-${numero}`,
    nome: `Vestido ${numero}`,
    preco_venda: 100 + numero,
    estoque: 5,
    imagem_url: null,
    imagem_urls: null,
    product_variants: [],
  };
}

/** O banco com `total` vestidos: devolve a página pedida e o total inteiro. */
function bancoComVestidos(total: number) {
  return async (nome: string, params: Record<string, unknown>) => {
    if (nome !== "get_admin_products_paged") {
      throw new Error(`RPC não mockada neste teste: ${nome}`);
    }
    const pagina = Number(params.p_page);
    const tamanho = Number(params.p_page_size);
    const todos = Array.from({ length: total }, (_, i) => produto(i + 1));
    return {
      data: {
        data: todos.slice(pagina * tamanho, pagina * tamanho + tamanho),
        total_count: total,
      },
      error: null,
    };
  };
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("Balcão — a busca de produto por nome mostra tudo o que existe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.useFakeTimers();
    rpcMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montarEBuscar(termo: string): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Buscar produto")!.click();
    });
    await act(async () => {
      digitarInput("busca-manual-de-produto", termo);
    });
    await avancar(400);
  }

  function nomesNaLista(): string[] {
    return [...hospedeiro.querySelectorAll("li")]
      .map((li) => li.textContent ?? "")
      .filter((t) => t.startsWith("Vestido"));
  }

  it.each(["", "vestido"])(
    "com mais produtos do que cabem na página, o termo '%s' diz quantos são e deixa ver o resto",
    async (termo) => {
      rpcMock.mockImplementation(bancoComVestidos(22));
      await montarEBuscar(termo);

      expect(nomesNaLista()).toHaveLength(POR_PAGINA);
      expect(hospedeiro.textContent).toContain("Mostrando 8 de 22");

      const maisUma = botaoPorTexto(hospedeiro, "Mostrar mais");
      expect(maisUma, "botão Mostrar mais ausente").toBeTruthy();
      await act(async () => {
        maisUma!.click();
      });
      await avancar();

      expect(nomesNaLista()).toHaveLength(16);
      expect(hospedeiro.textContent).toContain("Mostrando 16 de 22");
      // A segunda página foi pedida ao banco com o MESMO termo.
      const ultima = rpcMock.mock.calls.at(-1)!;
      expect(ultima[0]).toBe("get_admin_products_paged");
      expect(ultima[1]).toMatchObject({ p_search: termo, p_page: 1 });

      await act(async () => {
        botaoPorTexto(hospedeiro, "Mostrar mais")!.click();
      });
      await avancar();

      // Terceira página (6 produtos): todos os 22 à vista, e nada mais a mostrar.
      expect(nomesNaLista()).toHaveLength(22);
      expect(new Set(nomesNaLista()).size).toBe(22);
      expect(botaoPorTexto(hospedeiro, "Mostrar mais")).toBeUndefined();
      expect(hospedeiro.textContent).not.toContain("Mostrando");
    },
  );

  it("quando tudo cabe na página, não aparece aviso nem botão de mostrar mais", async () => {
    rpcMock.mockImplementation(bancoComVestidos(5));
    await montarEBuscar("vestido");

    expect(nomesNaLista()).toHaveLength(5);
    expect(hospedeiro.textContent).not.toContain("Mostrando");
    expect(botaoPorTexto(hospedeiro, "Mostrar mais")).toBeUndefined();
  });

  it("busca que não acha nada diz que não achou", async () => {
    rpcMock.mockImplementation(bancoComVestidos(0));
    await montarEBuscar("xyzxyz");

    expect(hospedeiro.textContent).toContain("Nenhum produto encontrado");
    expect(nomesNaLista()).toHaveLength(0);
  });

  it("uma letra mantém a lista base sem buscar esse termo e usa o estado vazio de produtos ativos", async () => {
    rpcMock.mockImplementation(bancoComVestidos(0));
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
    expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");
    expect(rpcMock).not.toHaveBeenCalled();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Buscar produto")!.click();
    });

    // Uma letra só mantém a consulta base, sem pedir uma busca por 'v'.
    await act(async () => {
      digitarInput("busca-manual-de-produto", "v");
    });
    await avancar(400);
    expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");
    expect(hospedeiro.textContent).toContain("Nenhum produto ativo cadastrado");
    expect(hospedeiro.textContent).not.toContain('Sem resultado para ""');
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
      "get_admin_products_paged",
      expect.objectContaining({ p_search: "", p_page: 0, p_page_size: 8 }),
    );
  });

  it("quando a rede falha, a lojista vê o erro e consegue tentar de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const banco = bancoComVestidos(3);
    rpcMock.mockImplementationOnce(banco);
    rpcMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    rpcMock.mockImplementation(banco);
    await montarEBuscar("vestido");

    expect(hospedeiro.textContent).toContain("Não consegui buscar agora");
    // Falha NÃO é "achou zero": não pode dizer que não existe produto.
    expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");

    const tentar = botaoPorTexto(hospedeiro, "Tentar de novo");
    expect(tentar, "botão Tentar de novo ausente").toBeTruthy();
    await act(async () => {
      tentar!.click();
    });
    await avancar();

    expect(hospedeiro.textContent).not.toContain("Não consegui buscar agora");
    expect(nomesNaLista()).toHaveLength(3);
  });

  it("se a segunda página falha, a primeira continua na tela e dá para tentar de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const banco = bancoComVestidos(12);
    rpcMock.mockImplementationOnce(banco);
    rpcMock.mockImplementationOnce(banco);
    rpcMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    rpcMock.mockImplementation(banco);
    await montarEBuscar("vestido");

    await act(async () => {
      botaoPorTexto(hospedeiro, "Mostrar mais")!.click();
    });
    await avancar();

    expect(nomesNaLista()).toHaveLength(POR_PAGINA);
    expect(hospedeiro.textContent).toContain("Não consegui buscar agora");

    await act(async () => {
      botaoPorTexto(hospedeiro, "Tentar de novo")!.click();
    });
    await avancar();

    expect(nomesNaLista()).toHaveLength(12);
    expect(hospedeiro.textContent).not.toContain("Não consegui buscar agora");
  });

  it("produto cadastrado no meio do caminho não aparece duas vezes", async () => {
    // Entre a página 1 e a 2 entrou um produto novo e empurrou a fila: o
    // "Vestido 8" volta na segunda página junto com os novos.
    const banco = bancoComVestidos(12);
    rpcMock.mockImplementationOnce(banco);
    rpcMock.mockImplementationOnce(banco);
    rpcMock.mockImplementationOnce(async () => ({
      data: {
        data: [produto(8), produto(9), produto(10), produto(11), produto(12)],
        total_count: 13,
      },
      error: null,
    }));
    await montarEBuscar("vestido");
    await act(async () => {
      botaoPorTexto(hospedeiro, "Mostrar mais")!.click();
    });
    await avancar();

    expect(nomesNaLista()).toHaveLength(12);
    expect(new Set(nomesNaLista()).size).toBe(12);
  });

  it("buscar outro termo recomeça da primeira página", async () => {
    rpcMock.mockImplementation(bancoComVestidos(22));
    await montarEBuscar("vestido");
    await act(async () => {
      botaoPorTexto(hospedeiro, "Mostrar mais")!.click();
    });
    await avancar();
    expect(nomesNaLista()).toHaveLength(16);

    await act(async () => {
      digitarInput("busca-manual-de-produto", "vestido longo");
    });
    await avancar(400);

    expect(nomesNaLista()).toHaveLength(POR_PAGINA);
    const ultima = rpcMock.mock.calls.at(-1)!;
    expect(ultima[1]).toMatchObject({ p_search: "vestido longo", p_page: 0 });
  });
});
