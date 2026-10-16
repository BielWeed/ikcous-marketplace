// @vitest-environment jsdom
//
// Balcão — a resposta de uma leitura de código que demora não pode colocar a
// peça da venda cancelada dentro da venda NOVA (a baixa de estoque sairia da
// peça errada). Molde de montagem: balcao-cancelar-venda-limpa-o-cupom.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } },
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
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({ codigo: codigoBipadoRef.atual, formato: "ean_13" })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

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

describe("Balcão — leitura atrasada de uma venda cancelada", () => {
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
    invokeMock.mockReset();
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

  async function clicar(texto: string): Promise<void> {
    const alvo = botao(hospedeiro, texto);
    expect(alvo, `botão "${texto}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  it("a peça lida antes do cancelamento não entra no cupom novo", async () => {
    let responderLenta!: (v: unknown) => void;
    const respostas: Array<Promise<unknown> | unknown> = [
      produto("111", "Camiseta Lisa"),
      new Promise((resolve) => {
        responderLenta = resolve;
      }),
      produto("333", "Boné Azul"),
    ];
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome !== "buscar_por_codigo_barras") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return { data: await respostas.shift(), error: null };
    });

    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();

    // Venda 1: uma peça entra e depois a leitura de uma segunda fica pendurada.
    codigoBipadoRef.atual = "111";
    await clicar("bipar");
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    codigoBipadoRef.atual = "222";
    await clicar("bipar");

    // A venda é cancelada com a leitura ainda no ar.
    await clicar("Cancelar venda");
    await clicar("Sim, cancelar venda");
    await avancar(400);
    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");

    // A resposta antiga chega já na venda nova: não pode entrar.
    await act(async () => {
      responderLenta(produto("222", "Meia Listrada"));
    });
    await avancar(400);
    expect(hospedeiro.textContent).not.toContain("Meia Listrada");
    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");

    // E a venda nova continua aceitando leitura normalmente.
    codigoBipadoRef.atual = "333";
    await clicar("bipar");
    expect(hospedeiro.textContent).toContain("Boné Azul");
  });
});
