// @vitest-environment jsdom
//
// Balcão — a busca de produto sob corrida e sob foco. Dois cuidados que a
// lista paginada trouxe:
//  1. resposta ANTIGA (de outro termo, ou de uma página que ficou para trás)
//     nunca pode sobrescrever a busca mais nova nem reabrir a lista de um
//     termo que a lojista já apagou;
//  2. o campo de busca refaz a busca quando PERDE O FOCO (o `LocalBufferedInput`
//     entrega o valor no blur). No celular, o toque em "Mostrar mais" tira o
//     foco do campo ANTES do clique: a busca do mesmo termo recomeçava, o
//     botão ficava desabilitado no meio do toque e o primeiro toque morria
//     (só o segundo paginava). Buscar de novo o MESMO termo que já está na
//     tela não pode acontecer.
//
// As respostas do banco aqui ficam PENDENTES até o teste resolvê-las, para
// controlar a ordem em que chegam.
//
// Molde: balcao-busca-do-produto-mostra-tudo.test.tsx (AdminPdvView real).
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

interface Pendente {
  readonly params: Record<string, unknown>;
  readonly resolver: (valor: unknown) => void;
  readonly rejeitar: (erro: unknown) => void;
}

function produto(numero: number, prefixo = "Vestido") {
  return {
    id: `${prefixo}-${numero}`,
    nome: `${prefixo} ${numero}`,
    preco_venda: 100,
    estoque: 5,
    imagem_url: null,
    imagem_urls: null,
    product_variants: [],
  };
}

function pagina(itens: readonly unknown[], total: number) {
  return { data: { data: itens, total_count: total }, error: null };
}

function lote(inicio: number, quantos: number, prefixo = "Vestido") {
  return Array.from({ length: quantos }, (_, i) =>
    produto(inicio + i, prefixo),
  );
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

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
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

describe("Balcão — busca de produto: corrida e foco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Pendente[];

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
    pendentes = [];
    rpcMock.mockReset();
    rpcMock.mockImplementation(
      (_nome: string, params: Record<string, unknown>) =>
        new Promise((resolver, rejeitar) => {
          pendentes.push({ params, resolver, rejeitar });
        }),
    );
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

  async function montar(resolverListaBase = true): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Buscar produto")!.click();
    });
    if (resolverListaBase) {
      await resolver(0, pagina([], 0));
      pendentes.shift();
    }
  }

  async function digitarBusca(termo: string): Promise<void> {
    await act(async () => {
      digitarInput("busca-manual-de-produto", termo);
    });
    await avancar(400);
  }

  async function resolver(indice: number, valor: unknown): Promise<void> {
    await act(async () => {
      pendentes.at(indice)!.resolver(valor);
    });
    await avancar();
  }

  const nomes = () =>
    [...hospedeiro.querySelectorAll("li")]
      .map((li) => li.textContent ?? "")
      .filter((t) => /^(Vestido|Calça)/.test(t));

  const chamadas = () =>
    rpcMock.mock.calls.map(([, params]) => [
      (params as Record<string, unknown>).p_search,
      (params as Record<string, unknown>).p_page,
    ]);

  it("trocar de modo preserva o termo e a página carregada sem refazer a consulta", async () => {
    await montar();
    await digitarBusca("vestido");
    await resolver(0, pagina(lote(1, 8), 20));
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>("#modo-bipar-produto")!
        .click();
    });
    expect(
      hospedeiro.querySelector("#busca-do-balcao")?.hasAttribute("hidden"),
    ).toBe(true);
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>("#modo-buscar-produto")!
        .click();
    });
    expect(
      (document.getElementById("busca-manual-de-produto") as HTMLInputElement)
        .value,
    ).toBe("vestido");
    expect(nomes()).toHaveLength(8);
    expect(chamadas()).toEqual([
      ["", 0],
      ["vestido", 0],
    ]);
  });

  it("o campo ainda focado: tirar o foco no toque de 'Mostrar mais' não recomeça a busca nem mata o primeiro toque", async () => {
    await montar();
    const campo = document.getElementById(
      "busca-manual-de-produto",
    ) as HTMLInputElement;
    await act(async () => {
      campo.focus();
    });
    await digitarBusca("vestido");
    await resolver(0, pagina(lote(1, 8), 20));
    expect(nomes()).toHaveLength(8);

    // O toque em "Mostrar mais" começa tirando o foco do campo (mousedown /
    // touchstart) e só DEPOIS vem o clique.
    await act(async () => {
      campo.blur();
    });
    await avancar();
    const maisUma = botao(hospedeiro, "Mostrar mais");
    expect(maisUma?.disabled, "botão travado no meio do toque").toBe(false);
    await act(async () => {
      maisUma!.click();
    });
    await avancar();

    // Só UMA busca da página 0; o primeiro toque pediu a página 1.
    expect(chamadas()).toEqual([
      ["", 0],
      ["vestido", 0],
      ["vestido", 1],
    ]);
    await resolver(1, pagina(lote(9, 8), 20));
    expect(nomes()).toHaveLength(16);
  });

  it("o campo perde o foco com o MESMO termo e a busca falhou: tentar de novo continua possível", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    const campo = document.getElementById(
      "busca-manual-de-produto",
    ) as HTMLInputElement;
    await act(async () => {
      campo.focus();
    });
    await digitarBusca("vestido");
    await act(async () => {
      pendentes[0].rejeitar(new Error("Failed to fetch"));
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Não consegui buscar agora");

    // Falha não é "busca respondida": sair do campo busca de novo.
    await act(async () => {
      campo.blur();
    });
    await avancar();
    expect(chamadas()).toEqual([
      ["", 0],
      ["vestido", 0],
      ["vestido", 0],
    ]);
  });

  it("a página 2 do termo antigo chega DEPOIS da busca nova e não entra na lista", async () => {
    await montar();
    await digitarBusca("vestido");
    expect(pendentes).toHaveLength(1);
    await resolver(0, pagina(lote(1, 8), 20));
    expect(nomes()).toHaveLength(8);

    await act(async () => {
      botao(hospedeiro, "Mostrar mais")!.click();
    });
    await avancar();
    expect(pendentes).toHaveLength(2);

    await digitarBusca("calça");
    expect(pendentes).toHaveLength(3);
    await resolver(2, pagina(lote(1, 3, "Calça"), 3));
    expect(nomes()).toHaveLength(3);

    // só agora chega a página 2 do termo antigo
    await resolver(1, pagina(lote(9, 8), 20));
    expect(nomes()).toHaveLength(3);
    expect(nomes().every((n) => n.startsWith("Calça"))).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Mostrando");
  });

  it("a resposta atrasada de uma busca antiga não sobrescreve a mais nova", async () => {
    await montar();
    await digitarBusca("vest");
    await digitarBusca("vestido longo");
    expect(pendentes).toHaveLength(2);

    await resolver(1, pagina([produto(1)], 1));
    await resolver(0, pagina(lote(50, 8), 99));

    expect(nomes()).toHaveLength(1);
    expect(nomes()[0]).toContain("Vestido 1");
    expect(hospedeiro.textContent).not.toContain("Mostrando");
  });

  it.each(["", "v"])(
    "reduziu o termo para '%s' com a busca no ar: recarrega a lista base e ignora a resposta antiga",
    async (termo) => {
      await montar();
      await digitarBusca("vestido");
      await digitarBusca(termo);

      expect(chamadas()).toEqual([
        ["", 0],
        ["vestido", 0],
        ["", 0],
      ]);
      await resolver(1, pagina(lote(1, 2, "Calça"), 2));

      await resolver(0, pagina(lote(1, 8), 20));

      expect(nomes()).toHaveLength(2);
      expect(nomes().every((n) => n.startsWith("Calça"))).toBe(true);
      expect(hospedeiro.textContent).not.toContain("Nenhum produto");
      expect(hospedeiro.textContent).not.toContain("Mostrando");
    },
  );

  it("a lista inicial atrasada não sobrescreve a busca digitada mais nova", async () => {
    await montar(false);
    expect(hospedeiro.textContent).toContain("Buscando…");
    await digitarBusca("calça");
    await resolver(1, pagina(lote(1, 2, "Calça"), 2));
    await resolver(0, pagina(lote(1, 8), 20));
    expect(nomes()).toHaveLength(2);
    expect(nomes().every((n) => n.startsWith("Calça"))).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Mostrando");
  });

  it("com a próxima página no ar, 'Mostrar mais' fica desabilitado (não pede a mesma página duas vezes)", async () => {
    await montar();
    await digitarBusca("vestido");
    await resolver(0, pagina(lote(1, 8), 20));

    await act(async () => {
      botao(hospedeiro, "Mostrar mais")!.click();
    });
    await avancar();

    expect(botao(hospedeiro, "Mostrar mais")?.disabled).toBe(true);
    expect(pendentes).toHaveLength(2);
  });

  it("a busca de um termo novo que falha apaga a lista antiga em vez de misturar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    await digitarBusca("vestido");
    await resolver(0, pagina(lote(1, 8), 20));

    await digitarBusca("calça");
    await act(async () => {
      pendentes[1].rejeitar(new Error("Failed to fetch"));
    });
    await avancar();

    expect(nomes()).toHaveLength(0);
    expect(hospedeiro.textContent).toContain("Não consegui buscar agora");
  });
});
