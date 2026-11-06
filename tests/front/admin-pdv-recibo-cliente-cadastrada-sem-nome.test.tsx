// @vitest-environment jsdom
//
// Cliente CADASTRADA cujo perfil não tem nome: o banco grava 'Venda no balcão'
// em `customer_name` (é o texto de "venda sem cliente"), e o recibo repetia
// isso como se fosse o nome dela — na tela e no papel ("CLIENTE: Venda no
// balcão"). A tela de escolher a cliente já diz "Cliente" nesse caso; o recibo
// agora diz o mesmo. Só front: o banco segue gravando como sempre.
//
// Molde: tests/front/admin-pdv-recibo-rotulo-da-peca-gravada.test.tsx (view
// real, RPC dublada, rascunho semeado no localStorage).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock, registrarImplRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
  registrarImplRef: {
    atual: null as
      | ((params: any) => Promise<{ data: unknown; error: unknown }>)
      | null,
  },
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
  preco: 40,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

const GRAVADO = {
  id: "item-1",
  product_id: "produto-1",
  variant_id: null,
  quantity: 1,
  price: 40,
  product_name: "Camiseta",
};

function pedido(extra: Record<string, unknown>) {
  return {
    id: "99999999-9999-9999-9999-999999999999",
    created_at: "2026-09-17T12:00:00.000Z",
    total: 40,
    subtotal: 40,
    discount: 0,
    payment_method: "cash" as const,
    user_id: "cliente-1",
    customer_name: "Venda no balcão",
    customer_data: { whatsapp: "34999990000" },
    ...extra,
  };
}

function localizarBotaoPorTexto(
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

describe("AdminPdvView — recibo de cliente cadastrada sem nome no perfil", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "registrar_venda_presencial") {
        return registrarImplRef.atual!(params);
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [ITEM],
        pagamento: "cash",
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
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function registrarComPedido(extra: Record<string, unknown>) {
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: false,
        order: pedido(extra),
        items: [GRAVADO],
      },
      error: null,
    });
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();
  }

  const bloco = () =>
    hospedeiro.querySelector(".pdv-heading.pdv-divider") as HTMLElement;
  const papel = () => hospedeiro.querySelector("[data-tema-fixo]")!;

  it("user_id + nome 'Venda no balcão' + WhatsApp: a tela e o papel dizem 'Cliente'", async () => {
    await registrarComPedido({});

    // O primeiro <p> é o rótulo só-leitor-de-tela; o segundo é o nome mostrado.
    expect(bloco().querySelectorAll("p")[1].textContent).toBe("Cliente");
    expect(bloco().textContent).not.toContain("Venda no balcão");
    expect(bloco().textContent).toContain("WhatsApp · 34999990000");

    expect(papel().textContent).toContain("CLIENTE:");
    expect(papel().textContent).not.toContain("Venda no balcão");
    expect(papel().textContent).toContain("34999990000");
    // O nome impresso é exatamente "Cliente" (logo depois do título).
    const paragrafos = [...papel().querySelectorAll("p")].map((p) =>
      p.textContent?.trim(),
    );
    const posicao = paragrafos.indexOf("CLIENTE:");
    expect(paragrafos[posicao + 1]).toBe("Cliente");
  });

  it("nome vazio ou só espaços também vira 'Cliente'", async () => {
    await registrarComPedido({ customer_name: "   " });

    expect(bloco().querySelectorAll("p")[1].textContent).toBe("Cliente");
    expect(papel().textContent).toContain("CLIENTE:");
    const paragrafos = [...papel().querySelectorAll("p")].map((p) =>
      p.textContent?.trim(),
    );
    expect(paragrafos[paragrafos.indexOf("CLIENTE:") + 1]).toBe("Cliente");
  });

  it("cliente com nome de verdade no perfil: o nome dela segue na tela e no papel", async () => {
    await registrarComPedido({ customer_name: "Maria da Silva" });

    expect(bloco().textContent).toContain("Maria da Silva");
    expect(papel().textContent).toContain("Maria da Silva");
    expect(papel().textContent).not.toContain("Venda no balcão");
  });

  it("venda SEM cliente (sem user_id) segue como 'Venda no balcão' na tela e sem título no papel", async () => {
    await registrarComPedido({
      user_id: null,
      customer_data: null,
    });

    expect(bloco().textContent).toContain("Venda no balcão");
    expect(papel().textContent).not.toContain("CLIENTE:");
    expect(papel().textContent).not.toContain("Venda no balcão");
  });
});
