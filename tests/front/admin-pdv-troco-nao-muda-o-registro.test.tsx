// @vitest-environment jsdom
//
// O troco na tela (Dinheiro) é SÓ conta: o que vai ao servidor ao registrar a
// venda tem de sair EXATAMENTE igual com o campo "Quanto a cliente deu?"
// preenchido, vazio ou com valor menor que o total. Aqui a view real chama a
// RPC dublada e o teste compara os argumentos das duas chamadas.
//
// Molde: tests/front/admin-pdv-recibo-rotulo-da-peca-gravada.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

import {
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const ITEM = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta",
  variacao: null,
  preco: 29.95,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

const RESPOSTA = {
  ja_existia: false,
  order: {
    id: "99999999-9999-9999-9999-999999999999",
    created_at: "2026-11-12T12:00:00.000Z",
    total: 29.95,
    subtotal: 29.95,
    discount: 0,
    payment_method: "cash" as const,
  },
  items: [
    {
      id: "item-1",
      product_id: "produto-1",
      variant_id: null,
      quantity: 1,
      price: 29.95,
      product_name: "Camiseta",
    },
  ],
};

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

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminPdvView — o troco na tela não muda o que vai ao servidor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "registrar_venda_presencial") {
        return { data: RESPOSTA, error: null };
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Venda de R$ 29,95 em Dinheiro, já no fechamento; `preencher` mexe no
   * campo do troco ANTES do clique em Registrar. Devolve os argumentos da RPC. */
  async function registrarComTroco(
    preencher: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    rpcMock.mockClear();
    localStorage.clear();
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [ITEM],
        pagamento: "cash",
      }),
    );
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await preencher();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    const chamadas = rpcMock.mock.calls.filter(
      ([nome]) => nome === "registrar_venda_presencial",
    );
    expect(chamadas).toHaveLength(1);
    const argumentos = chamadas[0][1] as Record<string, unknown>;
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    return argumentos;
  }

  it("com o campo preenchido (troco), vazio, ou com valor que não cobre: os argumentos da RPC são idênticos", async () => {
    const semCampo = await registrarComTroco(async () => {});

    const comTroco = await registrarComTroco(async () => {
      await act(async () => {
        digitarInput("dinheiro-recebido", "5000"); // R$ 50,00 -> troco 20,05
      });
      await avancar();
      expect(hospedeiro.textContent).toContain("Troco: R$ 20,05");
    });

    const comNotaSugerida = await registrarComTroco(async () => {
      await act(async () => {
        botaoPorTexto(hospedeiro, "R$ 50")!.click();
      });
      await avancar();
      expect(hospedeiro.textContent).toContain("Troco: R$ 20,05");
    });

    const comFalta = await registrarComTroco(async () => {
      await act(async () => {
        digitarInput("dinheiro-recebido", "1000"); // R$ 10,00 -> faltam 19,95
      });
      await avancar();
      expect(hospedeiro.textContent).toContain("Faltam R$ 19,95");
    });

    expect(comTroco).toEqual(semCampo);
    expect(comNotaSugerida).toEqual(semCampo);
    expect(comFalta).toEqual(semCampo);
  });

  it("os argumentos são exatamente os de hoje, sem nenhuma chave nova (nada de recebido/troco)", async () => {
    const argumentos = await registrarComTroco(async () => {
      await act(async () => {
        digitarInput("dinheiro-recebido", "5000");
      });
      await avancar();
    });

    expect(Object.keys(argumentos).sort()).toEqual([
      "p_cliente_nome",
      "p_cliente_user_id",
      "p_cliente_whatsapp",
      "p_desconto",
      "p_idempotency_key",
      "p_itens",
      "p_observacao",
      "p_pagamento",
      "p_total_esperado",
    ]);
    expect(argumentos).toEqual({
      p_itens: [{ product_id: "produto-1", variant_id: null, quantity: 1 }],
      p_pagamento: "cash",
      p_cliente_user_id: null,
      p_cliente_nome: null,
      p_cliente_whatsapp: null,
      p_desconto: 0,
      p_total_esperado: 29.95,
      p_observacao: null,
      p_idempotency_key: "chave-da-venda-teste",
    });
  });

  it("nada do campo vai para o rascunho gravado no aparelho", async () => {
    await registrarComTroco(async () => {
      await act(async () => {
        digitarInput("dinheiro-recebido", "5000");
      });
      await avancar();
    });
    const gravado = Object.keys(localStorage).map(
      (chave) => `${chave}=${localStorage.getItem(chave)}`,
    );
    expect(gravado.join("\n")).not.toMatch(/troco|recebido/i);
  });
});
