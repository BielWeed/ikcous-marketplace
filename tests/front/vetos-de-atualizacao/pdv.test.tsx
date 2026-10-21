// @vitest-environment jsdom
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const rede = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  despachar: vi.fn(),
  registrar: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rede.rpc, functions: { invoke: rede.invoke } },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("@/hooks/useAnularVendaDoBalcao", () => ({
  useAnularVendaDoBalcao: () => ({ anular: vi.fn() }),
}));
vi.mock("@/hooks/useVendaPresencial", async (original) => {
  const modulo = await original<typeof import("@/hooks/useVendaPresencial")>();
  return {
    ...modulo,
    useVendaPresencial: () => ({
      estado: {
        ...modulo.estadoInicialDaVenda(() => "chave-fixa"),
        etapa: "fechamento",
        pagamento: "cash",
        itens: [
          {
            chave: "produto-1::",
            productId: "produto-1",
            variantId: null,
            quantidade: 1,
            preco: 10,
            nome: "Produto",
            estoque: 2,
            imagem: "",
            variacao: null,
          },
        ],
      },
      subtotal: 10,
      despachar: rede.despachar,
      limparCupom: vi.fn(),
    }),
  };
});
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: () => null,
}));
vi.mock("@/components/admin/pdv/CupomDaVenda", () => ({
  CupomDaVenda: () => null,
}));
vi.mock("@/components/admin/pdv/FechamentoDaVenda", () => ({
  FechamentoDaVenda: ({
    aoRegistrarVenda,
  }: { aoRegistrarVenda: () => Promise<void> }) => {
    // A view e sua rotina são reais; só capturamos a ação entregue à seção.
    rede.registrar = aoRegistrarVenda;
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("gravação da venda do PDV veta a atualização", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    rede.invoke.mockResolvedValue({ error: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    window.history.replaceState({}, "");
  });

  it.each(["sucesso", "erro", "rejeicao"])(
    "veta enquanto pendente e libera após %s",
    async (desfecho) => {
      const envio = adiar<{ data: unknown; error: unknown }>();
      rede.rpc.mockReturnValue(envio.promessa);
      let resultado!: Promise<unknown>;
      await act(async () => {
        resultado = rede.registrar!().catch((e: unknown) => e);
      });
      try {
        expect(rede.rpc).toHaveBeenCalledWith("registrar_venda_presencial", {
          p_itens: [{ product_id: "produto-1", variant_id: null, quantity: 1 }],
          p_pagamento: "cash",
          p_cliente_user_id: null,
          p_cliente_nome: null,
          p_cliente_whatsapp: null,
          p_desconto: 0,
          p_total_esperado: 10,
          p_observacao: null,
          p_idempotency_key: "chave-fixa",
        });
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "registro-de-venda-do-pdv",
        ]);
        expect(rede.despachar).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          if (desfecho === "rejeicao") {
            envio.rejeitar(new Error("falha simulada"));
          } else {
            envio.resolver({
              error:
                desfecho === "erro"
                  ? { code: "22023", message: "falha simulada" }
                  : null,
              data: {
                ja_existia: false,
                order: {
                  id: "pedido-1",
                  created_at: "2026-10-16",
                  total: 10,
                  subtotal: 10,
                  discount: 0,
                  payment_method: "cash",
                  status: "delivered",
                  user_id: null,
                  customer_name: "Venda no balcão",
                  customer_data: null,
                },
                items: [
                  {
                    product_id: "produto-1",
                    variant_id: null,
                    quantity: 1,
                    price: 10,
                    product_name: "Produto",
                  },
                ],
              },
            });
          }
          await resultado;
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
      const chamadasEsperadas = desfecho === "sucesso" ? 1 : 0;
      expect(rede.despachar).toHaveBeenCalledTimes(chamadasEsperadas);
      expect(rede.invoke).toHaveBeenCalledTimes(chamadasEsperadas);
    },
  );
});
