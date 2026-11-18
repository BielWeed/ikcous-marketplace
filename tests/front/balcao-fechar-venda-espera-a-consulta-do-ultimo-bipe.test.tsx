// @vitest-environment jsdom
//
// Balcão — fechar a venda (ou ir para o cliente) com o ÚLTIMO bipe ainda sendo
// consultado. Antes: "Fechar venda" só exigia cupom não vazio; se a lojista
// tocava nele enquanto a resposta do último bipe não tinha chegado, a tela
// mudava de etapa e a resposta, ao chegar, era descartada ("só a etapa cupom
// aceita bipe"): a peça já tinha apitado no leitor mas não entrava na cobrança
// nem na baixa de estoque. O botão "Cliente" levava ao mesmo descarte. Agora os
// dois ficam desligados enquanto houver consulta de código no ar ("Fechar
// venda" passa a dizer "Consultando…") e voltam quando a última termina
// (resposta, recusa ou prazo estourado).
//
// Molde de montagem: balcao-bipar-com-rede-lenta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: {
      codigo: string;
      formato: string;
      deTeclado?: boolean;
    }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({
            codigo: codigoBipadoRef.atual,
            formato: "ean_13",
            deTeclado: true,
          })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { toast } from "sonner";

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const PRAZO_ESTOURADO_MS = 12_000;

function produto(codigo: string, nome: string) {
  return {
    encontrado: true,
    origem: "produto" as const,
    codigo,
    produto: {
      id: `id-${codigo}`,
      nome,
      ativo: true,
      preco_venda: 39.9,
      estoque: 10,
      imagem: null,
      codigo_barras: codigo,
      tem_variantes: false,
    },
    variante: null,
    preco: 39.9,
    estoque: 10,
    variacoes: [],
  };
}

function botao(raizDom: ParentNode, texto: string) {
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

describe("Balcão — Fechar venda espera a consulta do último bipe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.useFakeTimers();
    rpcMock.mockReset();
    vi.mocked(toast.error).mockReset();
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
    vi.unstubAllGlobals();
  });

  async function clicar(texto: string): Promise<void> {
    const alvo = botao(hospedeiro, texto);
    expect(alvo, `botão "${texto}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
  }

  function etapa(): string | null {
    return (
      hospedeiro.querySelector("[data-etapa]")?.getAttribute("data-etapa") ??
      null
    );
  }

  /** O botão verde do rodapé do cupom: "Fechar venda" ou, com consulta no ar,
   * "Consultando…". Achado pela classe de ação, não pelo texto. */
  function botaoDeFechar(): HTMLButtonElement {
    const alvo = hospedeiro.querySelector<HTMLButtonElement>(
      "button.pdv-sale-action",
    );
    expect(alvo, "botão de fechar a venda ausente").toBeTruthy();
    return alvo as HTMLButtonElement;
  }

  function botaoDeCliente(): HTMLButtonElement {
    const alvo = hospedeiro.querySelector<HTMLButtonElement>(
      "button.pdv-client-chip",
    );
    expect(alvo, "botão de cliente ausente").toBeTruthy();
    return alvo as HTMLButtonElement;
  }

  /** Cada consulta ao servidor fica pendurada até a gente resolver. */
  function consultasPendentes(): Array<(v: unknown) => void> {
    const respostas: Array<(v: unknown) => void> = [];
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          respostas.push(resolve);
        }),
    );
    return respostas;
  }

  /** 1º bipe resolvido: a camiseta (código 111) já está no cupom. */
  async function comUmaPecaNoCupom(
    respostas: Array<(v: unknown) => void>,
  ): Promise<void> {
    await montar();
    codigoBipadoRef.atual = "111";
    await clicar("bipar");
    await act(async () => {
      respostas[0]({ data: produto("111", "Camiseta Lisa"), error: null });
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
  }

  it("com uma peça no cupom e o 2º bipe sendo consultado, 'Fechar venda' fica desligado e a peça entra quando a resposta chega", async () => {
    const respostas = consultasPendentes();
    await comUmaPecaNoCupom(respostas);
    expect(botaoDeFechar().disabled).toBe(false);
    expect(botaoDeFechar().textContent).toContain("Fechar venda");

    // 2º bipe do MESMO item: consulta no ar.
    await clicar("bipar");
    expect(respostas).toHaveLength(2);

    // A lojista toca em "Fechar venda" antes da resposta: o botão está
    // desligado, diz "Consultando…" e a tela NÃO sai do cupom.
    expect(botaoDeFechar().disabled).toBe(true);
    expect(botaoDeFechar().textContent).toContain("Consultando…");
    expect(botaoDeFechar().textContent).not.toContain("Fechar venda");
    await act(async () => {
      botaoDeFechar().click();
    });
    await avancar();
    expect(etapa()).toBe("cupom");

    // A resposta chega: a 2ª unidade entra (R$ 79,80) e o botão volta.
    await act(async () => {
      respostas[1]({ data: produto("111", "Camiseta Lisa"), error: null });
    });
    await avancar();
    expect(botaoDeFechar().disabled).toBe(false);
    expect(botaoDeFechar().textContent).toContain("Fechar venda");
    expect(hospedeiro.textContent).toContain("79,80");
    expect(toast.error).not.toHaveBeenCalled();

    // E agora fechar leva ao fechamento COM as duas unidades.
    await clicar("Fechar venda");
    expect(etapa()).toBe("fechamento");
  });

  it("com consulta no ar o botão 'Cliente' também fica desligado, e volta com a resposta", async () => {
    const respostas = consultasPendentes();
    await comUmaPecaNoCupom(respostas);
    expect(botaoDeCliente().disabled).toBe(false);

    await clicar("bipar");
    expect(botaoDeCliente().disabled).toBe(true);
    await act(async () => {
      botaoDeCliente().click();
    });
    await avancar();
    expect(etapa()).toBe("cupom");

    await act(async () => {
      respostas[1]({ data: produto("111", "Camiseta Lisa"), error: null });
    });
    await avancar();
    expect(botaoDeCliente().disabled).toBe(false);
    await act(async () => {
      botaoDeCliente().click();
    });
    await avancar();
    expect(etapa()).toBe("cliente");
  });

  it("duas consultas no ar: o botão só volta quando a ÚLTIMA termina", async () => {
    const respostas = consultasPendentes();
    await comUmaPecaNoCupom(respostas);

    codigoBipadoRef.atual = "222";
    await clicar("bipar");
    await clicar("bipar");
    expect(respostas).toHaveLength(3);
    expect(botaoDeFechar().disabled).toBe(true);

    await act(async () => {
      respostas[1]({ data: produto("222", "Calça Jeans"), error: null });
    });
    await avancar();
    // Uma terminou, a outra continua: segue desligado.
    expect(botaoDeFechar().disabled).toBe(true);

    await act(async () => {
      respostas[2]({ data: produto("222", "Calça Jeans"), error: null });
    });
    await avancar();
    expect(botaoDeFechar().disabled).toBe(false);
  });

  it("consulta que não responde: depois do prazo o botão volta e o aviso de rede lenta aparece (o caixa não fica preso)", async () => {
    const respostas = consultasPendentes();
    await comUmaPecaNoCupom(respostas);

    await clicar("bipar");
    expect(botaoDeFechar().disabled).toBe(true);

    await avancar(PRAZO_ESTOURADO_MS);
    expect(toast.error).toHaveBeenCalledWith(
      "A conexão está lenta, bipe de novo.",
    );
    expect(botaoDeFechar().disabled).toBe(false);
    expect(botaoDeFechar().textContent).toContain("Fechar venda");
    await clicar("Fechar venda");
    expect(etapa()).toBe("fechamento");
  });

  it("consulta recusada pelo servidor: o botão volta (e o aviso de código inválido continua)", async () => {
    const respostas = consultasPendentes();
    await comUmaPecaNoCupom(respostas);

    await clicar("bipar");
    expect(botaoDeFechar().disabled).toBe(true);
    await act(async () => {
      respostas[1]({
        data: null,
        error: { code: "22023", message: "Código de barras inválido" },
      });
    });
    await avancar();
    expect(toast.error).toHaveBeenCalledWith(
      "Esse código não parece válido. Confira a etiqueta.",
    );
    expect(botaoDeFechar().disabled).toBe(false);
  });

  it("cupom vazio com consulta no ar: segue indisponível pelo motivo de sempre (sem item), não vira 'Consultando…'", async () => {
    consultasPendentes();
    await montar();
    codigoBipadoRef.atual = "111";
    await clicar("bipar");

    expect(botaoDeFechar().disabled).toBe(true);
    expect(botaoDeFechar().textContent).toContain("Fechar venda");
    expect(hospedeiro.textContent).toContain(
      "Indisponível: adicione pelo menos um item.",
    );
    // O "Cliente" não depende de haver peça: ir para ele com a consulta no ar
    // também descartaria a peça que está chegando.
    expect(botaoDeCliente().disabled).toBe(true);
  });
});
