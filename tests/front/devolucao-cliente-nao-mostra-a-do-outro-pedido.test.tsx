// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoCliente } from "@/hooks/useDevolucaoCliente";
import type { Order } from "@/types";

const { rpc, fetchUserOrders, updateOrderStatus } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchUserOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: pedidos, fetchUserOrders, updateOrderStatus }),
}));
const usuario = { id: "u-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja"],
  metodos_nacionais: ["envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: null,
};
const ELEGIBILIDADE = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-10-15T10:00:00Z",
  dias_desde_entrega: 1,
  modalidade: "local",
  metodos: ["entrega_na_loja"],
  prazos: {
    arrependimento_ate: "2026-10-22",
    troca_ate: "2026-11-14",
    vicio_ate: "2027-01-13",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [],
  politica: POLITICA,
};
const DETALHE_A = {
  id: "dev-a",
  protocolo: "DV-A",
  order_id: "pedido-a",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "aprovada",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  me_reverse_id: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: "Traga o produto A.",
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: POLITICA,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  postada_em: null,
  recebida_em: null,
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};
const pedidoA: Order = {
  id: "pedido-a",
  customer: { name: "Cliente", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
};
const pedidos = [pedidoA, { ...pedidoA, id: "pedido-b" }];

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: ReturnType<typeof useDevolucaoCliente>;
// Pedido a que pertencia a devolução exposta em CADA render (inclusive o primeiro
// depois da troca de pedido, antes de qualquer efeito de limpeza).
let donosVistos: Array<string | null> = [];

function Sonda({ id, habilitado }: { id: string; habilitado: boolean }) {
  const lida = useDevolucaoCliente(id, habilitado);
  useEffect(() => {
    leitura = lida;
    donosVistos.push(lida.atual?.order_id ?? null);
  });
  return null;
}

async function renderizarHook(id: string, habilitado = true) {
  await act(async () => raiz.render(<Sonda id={id} habilitado={habilitado} />));
}

async function renderizarPedido(id: string) {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView orderId={id} onBack={() => {}} onNavigate={() => {}} />,
    );
  });
}

beforeEach(() => {
  donosVistos = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  fetchUserOrders.mockResolvedValue(pedidos);
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({
      data:
        nome === "devolucao_elegibilidade"
          ? ELEGIBILIDADE
          : nome === "devolucoes_do_pedido"
            ? [DETALHE_A]
            : DETALHE_A,
      error: null,
    }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("cliente troca o pedido sem levar a devolução anterior", () => {
  it("nenhum render do pedido B expõe a devolução de A, nem o primeiro", async () => {
    await renderizarHook("pedido-a");
    expect(donosVistos.at(-1)).toBe("pedido-a");
    const b = pendente();
    rpc.mockImplementation(() => b.promessa);
    const antes = donosVistos.length;
    await renderizarHook("pedido-b");
    expect(donosVistos.length).toBeGreaterThan(antes);
    expect(donosVistos.slice(antes)).not.toContain("pedido-a");
  });

  it("uma releitura que falha ou demora mantém a devolução do MESMO pedido na tela", async () => {
    await renderizarHook("pedido-a");
    const segunda = pendente();
    rpc.mockImplementation(() => segunda.promessa);
    await act(async () => {
      void leitura.recarregar();
    });
    expect(leitura.carregando).toBe(true);
    expect(leitura.atual?.order_id).toBe("pedido-a");
    await act(async () =>
      segunda.resolver({ data: null, error: { message: "rede" } }),
    );
    expect(leitura.erro).toBe(true);
    expect(leitura.atual?.order_id).toBe("pedido-a");
    expect(leitura.elegibilidade?.pode).toBe(true);
  });

  it("limpa os dados antes da leitura de B e não recupera A se B falhar", async () => {
    await renderizarHook("pedido-a");
    expect(leitura.atual?.order_id).toBe("pedido-a");
    expect(leitura.elegibilidade?.pode).toBe(true);

    const b = pendente();
    rpc.mockImplementation(() => b.promessa);
    await renderizarHook("pedido-b");
    expect(leitura.atual).toBeNull();
    expect(leitura.elegibilidade).toBeNull();
    expect(leitura.devolucoes).toEqual([]);
    expect(leitura.erro).toBe(false);
    expect(leitura.carregando).toBe(true);

    await act(async () => {
      b.resolver({ data: null, error: { message: "rede" } });
    });
    expect(leitura.atual).toBeNull();
    expect(leitura.elegibilidade).toBeNull();
    expect(leitura.erro).toBe(true);
    expect(leitura.carregando).toBe(false);

    const c = pendente();
    rpc.mockImplementation(() => c.promessa);
    await renderizarHook("pedido-c");
    expect(leitura.erro).toBe(false);
  });

  it("descarta o detalhe atrasado de A depois de ler B", async () => {
    const a = pendente();
    rpc.mockImplementation((nome: string, args: { p_order_id?: string }) => {
      if (nome === "devolucao_detalhe") return a.promessa;
      return Promise.resolve({
        data:
          nome === "devolucao_elegibilidade"
            ? ELEGIBILIDADE
            : args.p_order_id === "pedido-a"
              ? [DETALHE_A]
              : [],
        error: null,
      });
    });
    await renderizarHook("pedido-a");
    expect(leitura.carregando).toBe(true);
    await renderizarHook("pedido-b");
    expect(leitura.carregando).toBe(false);

    await act(async () => a.resolver({ data: DETALHE_A, error: null }));
    expect(leitura.atual).toBeNull();
    expect(leitura.devolucoes).toEqual([]);
    expect(leitura.erro).toBe(false);
    expect(leitura.carregando).toBe(false);
  });

  it("invalida a leitura mesmo ao desligar o hook sem iniciar outra", async () => {
    const a = pendente();
    rpc.mockImplementation(() => a.promessa);
    await renderizarHook("pedido-a");
    await renderizarHook("pedido-b", false);
    await act(async () =>
      a.resolver({ data: null, error: { message: "rede" } }),
    );
    expect(leitura.atual).toBeNull();
    expect(leitura.erro).toBe(false);
    expect(leitura.carregando).toBe(false);
  });

  it("B não oferece cancelar A durante a leitura ou após erro", async () => {
    await renderizarPedido("pedido-a");
    expect(
      hospedeiro.querySelector('[data-testid="cartao-devolucao"]')?.textContent,
    ).toContain("Cancelar devolução");

    const b = pendente();
    rpc.mockImplementation(() => b.promessa);
    await renderizarPedido("pedido-b");
    expect(
      hospedeiro.querySelector('[data-testid="cartao-devolucao"]'),
    ).toBeNull();
    await act(async () =>
      b.resolver({ data: null, error: { message: "rede" } }),
    );
    expect(
      hospedeiro.querySelector('[data-testid="cartao-devolucao"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Traga o produto A.");
    expect(rpc.mock.calls.some(([nome]) => nome === "cancelar_devolucao")).toBe(
      false,
    );
  });

  it("a tela recusa detalhe de outro pedido após leitura boa", async () => {
    await renderizarPedido("pedido-b");
    expect(hospedeiro.textContent).toContain("Chegou!");
    expect(
      hospedeiro.querySelector('[data-testid="cartao-devolucao"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain("DV-A");
  });
});
