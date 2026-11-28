// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReembolsoDaDevolucao } from "@/components/admin/devolucoes/ReembolsoDaDevolucao";
import { EstornoCard } from "@/components/admin/orders/EstornoCard";
import { lerDevolucaoDetalhe } from "@/lib/devolucao";
import type { Order } from "@/types";

const { rpc, lerEstornos, toast, recarregar } = vi.hoisted(() => ({
  rpc: vi.fn(),
  lerEstornos: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  recarregar: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => lerEstornos(),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const order: Order = {
  id: "pedido-1",
  customer: { name: "Cliente Teste", whatsapp: "11990000000" },
  items: [],
  subtotal: 300,
  shipping: 0,
  discount: 0,
  total: 300,
  paymentMethod: "online",
  status: "delivered",
  createdAt: "2026-11-20T12:00:00Z",
  updatedAt: "2026-11-20T12:00:00Z",
  cancelledAfterShipping: false,
  paymentStatus: "pago",
};
const detalhe = lerDevolucaoDetalhe({
  id: "dev-1",
  protocolo: "DV261120-ABCDE",
  order_id: order.id,
  user_id: "cliente-1",
  tipo: "arrependimento",
  motivo: "desisti",
  resolucao_desejada: "reembolso",
  resolucao_final: "reembolso",
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "concluida",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: 100,
  refund_id: null,
  reembolso_manual: true,
  prazo_ate: "2026-11-27",
  created_at: order.createdAt,
  updated_at: order.updatedAt,
  itens: [],
  eventos: [],
});
if (!detalhe) throw new Error("Fixture de devolução inválida");

const data = "2026-11-20T12:00:00Z";
const candidato = {
  id: detalhe.id,
  protocolo: detalhe.protocolo,
  valor: 100,
  registrado_em: data,
};
const avisoA = {
  refund_id: "a",
  caminho: "A",
  valor_mp: 100,
  por_fora_em: null,
  candidatos: [candidato],
};
const avisoB = {
  ...avisoA,
  refund_id: "b",
  caminho: "B",
  por_fora_em: data,
};
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

function botao(texto: string) {
  const b = [...hospedeiro.querySelectorAll("button")].find(
    (el) => el.textContent === texto,
  );
  if (!b) throw new Error(`Botão ausente: ${texto}`);
  return b;
}

const texto = () => hospedeiro.textContent?.replace(/\s+/g, " ");
const sucesso = { data: { resultado: "confirmado" }, error: null };

describe("aviso de reembolso possivelmente duplicado", () => {
  it("mostra o caminho A na ficha e confirma o vínculo explícito", async () => {
    lerEstornos.mockReturnValue({
      linhas: [],
      pago: 300,
      devolvido: 100,
      manual: 100,
      emCurso: 0,
      emDuvida: 0,
      disponivel: 100,
      reservadoPorFora: 0,
      carregando: false,
      pedidoCarregado: true,
      erro: false,
      recarregar,
      possivelDobro: [avisoA],
    });
    rpc.mockResolvedValue(sucesso);
    await act(async () => raiz.render(<EstornoCard order={order} />));

    expect(texto()).toContain(
      "O Mercado Pago avisou um reembolso depois do seu PIX",
    );
    expect(texto()).toContain(
      "Você registrou R$ 100,00 devolvido por fora (PIX ou dinheiro) em 20/11. Depois disso, o Mercado Pago avisou um reembolso de R$ 100,00 neste pedido. Foi o mesmo dinheiro?",
    );
    const mesmo = botao("Sim, foi o mesmo dinheiro");
    const dois = botao("Não, o cliente recebeu duas vezes");
    expect(mesmo.compareDocumentPosition(dois)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await act(async () => mesmo.click());
    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucao_confirmar_mesmo_dinheiro",
      {
        p_devolucao_id: "dev-1",
        p_refund_id: "a",
      },
    );
    expect(recarregar).toHaveBeenCalledOnce();
  });

  it("mostra o caminho B na devolução e orienta a lojista após confirmar dois", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve(
        nome === "pedido_reembolsos_e_saldo"
          ? {
              data: {
                total: 300,
                valor_estornado: 100,
                em_voo: 0,
                em_duvida: 0,
                manual: 100,
                disponivel: 100,
                reservado_por_fora: 0,
                linhas: [],
                possivel_dobro: [
                  avisoB,
                  {
                    ...avisoA,
                    candidatos: [{ ...candidato, id: "outra-devolucao" }],
                  },
                ],
              },
              error: null,
            }
          : sucesso,
      ),
    );
    await act(async () =>
      raiz.render(
        <ReembolsoDaDevolucao detalhe={detalhe} aoMudar={recarregar} />,
      ),
    );

    expect(texto()).not.toContain(
      "O Mercado Pago avisou um reembolso depois do seu PIX",
    );
    expect(texto()).toContain(
      "O reembolso pelo Mercado Pago foi concluído depois do seu PIX",
    );
    expect(texto()).toContain(
      "Em 20/11 você registrou R$ 100,00 devolvido por fora (PIX ou dinheiro), porque o Mercado Pago não respondia. Depois disso, o Mercado Pago concluiu o reembolso de R$ 100,00 que o app tinha pedido. O cliente provavelmente recebeu duas vezes.",
    );
    const dois = botao("O cliente recebeu duas vezes");
    const mesmo = botao(
      "Foi o mesmo dinheiro (eu devolvi pelo Mercado Pago, não por PIX)",
    );
    expect(dois.compareDocumentPosition(mesmo)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await act(async () => dois.click());
    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucao_confirmar_dois_reembolsos",
      {
        p_order_id: "pedido-1",
        p_refund_id: "b",
      },
    );
    expect(toast.info).toHaveBeenCalledWith(
      "Fale com o cliente para combinar a devolução da diferença.",
    );
    expect(recarregar).toHaveBeenCalledOnce();
  });
});
