// @vitest-environment jsdom
//
// Duas travas do "Desfazer recebimento" que nenhum teste vigiava (caça por
// mutação, 24/11/2026):
//
//  1. Quando a conferência das devoluções FALHA, a ação continua disponível
//     (a RPC ainda aplica a regra). Uma leitura antiga que sobrou na memória
//     não pode esconder o botão como se a devolução tivesse sido confirmada.
//  2. Se o pedido passa a "ocupado" com a pergunta já aberta (outro registro
//     em andamento), o botão de confirmar some: um segundo toque não pode
//     disparar a RPC duas vezes.
import { DesfazerRecebimento } from "@/components/admin/orders/DesfazerRecebimento";
import type { Order } from "@/types";
import type { ResumoDevolucao } from "@/types/devolucao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const MOTIVO =
  "Este pedido tem devolução; o recebimento não pode ser desfeito.";

const pedido: Order = {
  id: "pedido-desfazer-1",
  customer: {
    name: "Cliente Teste",
    whatsapp: "",
    address: "",
    number: "",
    neighborhood: "",
    city: "",
    state: "",
  },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  paymentStatus: "recebido_na_entrega",
  createdAt: "2026-10-08T14:00:00Z",
  updatedAt: "2026-10-08T14:00:00Z",
  cancelledAfterShipping: false,
  pagamentoRecebidoEm: "2026-10-08T14:00:00Z",
  canal: "online",
};

const devolucaoConcluida: ResumoDevolucao = {
  id: "dev-1",
  protocolo: "DV260926-ABCDE",
  status: "concluida",
  tipo: "arrependimento",
  resolucao_desejada: "reembolso",
  metodo_retorno: "envio_proprio",
  valor_itens: 50,
  created_at: "2026-10-09T12:00:00Z",
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

function botao(texto: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

function ficha(
  leitura: {
    devolucoes: ResumoDevolucao[];
    carregando: boolean;
    erro: boolean;
  },
  aoDesfazer: () => void,
  disabled = false,
) {
  return (
    <DesfazerRecebimento
      order={pedido}
      leituraDeDevolucoes={{ ...leitura, recarregar: vi.fn() }}
      aoDesfazer={aoDesfazer}
      disabled={disabled}
      className="h-11"
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("Desfazer recebimento: leitura das devoluções com falha", () => {
  it("leitura que falhou não esconde o botão, mesmo com devolução antiga na memória", async () => {
    const aoDesfazer = vi.fn();
    await act(async () => {
      raiz.render(
        ficha(
          { devolucoes: [devolucaoConcluida], carregando: false, erro: true },
          aoDesfazer,
        ),
      );
    });

    expect(hospedeiro.textContent).not.toContain(MOTIVO);
    const desfazer = botao("Desfazer");
    expect(desfazer?.disabled).toBe(false);

    await act(async () => desfazer?.click());
    await act(async () => botao("Desfazer recebimento")?.click());
    expect(aoDesfazer).toHaveBeenCalledTimes(1);
  });

  it("sem falha, a mesma devolução concluída bloqueia e explica (controle do teste acima)", async () => {
    await act(async () => {
      raiz.render(
        ficha(
          { devolucoes: [devolucaoConcluida], carregando: false, erro: false },
          vi.fn(),
        ),
      );
    });

    expect(hospedeiro.textContent).toContain(MOTIVO);
    expect(botao("Desfazer")).toBeUndefined();
  });
});

describe("Desfazer recebimento: pedido ocupado com a pergunta aberta", () => {
  it("o botão de confirmar some quando o pedido fica ocupado e volta quando libera", async () => {
    const aoDesfazer = vi.fn();
    const leitura = { devolucoes: [], carregando: false, erro: false };
    await act(async () => {
      raiz.render(ficha(leitura, aoDesfazer, false));
    });
    await act(async () => botao("Desfazer")?.click());
    expect(botao("Desfazer recebimento")).toBeDefined();

    await act(async () => {
      raiz.render(ficha(leitura, aoDesfazer, true));
    });
    expect(botao("Desfazer recebimento")).toBeUndefined();
    // "Voltar" continua à mão: a pergunta não prende a lojista.
    expect(botao("Voltar")).toBeDefined();
    expect(aoDesfazer).not.toHaveBeenCalled();

    await act(async () => {
      raiz.render(ficha(leitura, aoDesfazer, false));
    });
    await act(async () => botao("Desfazer recebimento")?.click());
    expect(aoDesfazer).toHaveBeenCalledTimes(1);
  });
});
