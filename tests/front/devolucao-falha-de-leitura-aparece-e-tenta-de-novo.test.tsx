// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as devolucaoCliente from "@/hooks/useDevolucaoCliente";
import type { Order } from "@/types";

const { rpc, fetchUserOrders, updateOrderStatus, respostas, falhas } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    fetchUserOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    respostas: new Map<string, unknown>(),
    falhas: new Set<string>(),
  }));

const pedidoEntregue: Order = {
  id: "pedido-devolucao-teste",
  customer: { name: "Cliente de teste", whatsapp: "34999999999" },
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
let pedidoAtual = pedidoEntregue;
const usuario = { id: "usuario-teste" };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua de Teste, 10" },
  }),
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
const DEVOLUCAO = {
  id: "devolucao-teste",
  protocolo: "DV-TESTE",
  order_id: pedidoEntregue.id,
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
  mensagem_loja: "Traga o produto para a troca.",
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: POLITICA,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  itens: [],
  eventos: [],
  pedido: null,
};
const AVISO =
  "Não conseguimos carregar as informações de devolução deste pedido.";

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

// O hook e o cartão são reais. O spy só permite observar a chamada de
// recarregar e provocar uma recarga sem sair da ficha já montada.
function ultimaLeitura() {
  const ultima = vi
    .mocked(devolucaoCliente.useDevolucaoCliente)
    .mock.results.at(-1);
  if (ultima?.type !== "return") {
    throw new Error("O hook de devolução ainda não retornou.");
  }
  return ultima.value;
}

async function renderizar() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={pedidoEntregue.id}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
}

const aviso = () => hospedeiro.querySelector('[role="alert"]');
const solicitar = () =>
  hospedeiro.querySelector('[data-testid="acao-solicitar-devolucao"]');
const cartao = () =>
  hospedeiro.querySelector('[data-testid="cartao-devolucao"]');

function tentarDeNovo() {
  const botao = [...hospedeiro.querySelectorAll("button")].find(
    (elemento) => elemento.textContent === "Tentar de novo",
  );
  expect(botao).toBeDefined();
  botao?.click();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(devolucaoCliente, "useDevolucaoCliente");
  pedidoAtual = pedidoEntregue;
  fetchUserOrders.mockReset();
  fetchUserOrders.mockImplementation(async () => [pedidoAtual]);
  updateOrderStatus.mockReset();
  rpc.mockReset();
  falhas.clear();
  respostas.clear();
  respostas.set("devolucao_elegibilidade", ELEGIBILIDADE);
  respostas.set("devolucoes_do_pedido", []);
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(
      falhas.has(nome)
        ? { data: null, error: { message: "Falha simulada de rede" } }
        : { data: respostas.get(nome) ?? null, error: null },
    ),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("falha ao ler a devolução na ficha do pedido", () => {
  it.each(["devolucao_elegibilidade", "devolucoes_do_pedido"])(
    "falha em %s mostra aviso e permite tentar de novo com sucesso",
    async (consulta) => {
      falhas.add(consulta);
      await renderizar();

      expect(aviso()?.textContent).toContain(AVISO);
      expect(aviso()?.textContent).toContain("Tentar de novo");
      expect(solicitar()).toBeNull();
      const recarregar = vi.spyOn(ultimaLeitura(), "recarregar");
      falhas.clear();

      await act(async () => tentarDeNovo());

      expect(recarregar).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("devolucao_elegibilidade", {
        p_order_id: pedidoEntregue.id,
      });
      expect(aviso()).toBeNull();
      expect(solicitar()?.textContent).toContain(
        "Solicitar devolução ou troca",
      );
    },
  );

  it("esconde o erro anterior enquanto a nova tentativa está carregando", async () => {
    falhas.add("devolucao_elegibilidade");
    await renderizar();
    expect(aviso()?.textContent).toContain(AVISO);
    const novaLeitura = pendente();
    rpc.mockImplementation((nome: string) =>
      nome === "devolucao_elegibilidade"
        ? novaLeitura.promessa
        : Promise.resolve({ data: [], error: null }),
    );

    await act(async () => tentarDeNovo());

    expect(ultimaLeitura().carregando).toBe(true);
    expect(ultimaLeitura().erro).toBe(true);
    expect(aviso()).toBeNull();
    await act(async () =>
      novaLeitura.resolver({ data: ELEGIBILIDADE, error: null }),
    );
    expect(aviso()).toBeNull();
    expect(solicitar()).not.toBeNull();
  });

  it("leitura bem-sucedida oferece a solicitação sem aviso", async () => {
    await renderizar();

    expect(solicitar()).not.toBeNull();
    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).not.toContain(AVISO);
  });

  it("preserva a devolução carregada durante a recarga e depois da falha", async () => {
    respostas.set("devolucao_elegibilidade", {
      ...ELEGIBILIDADE,
      pode: false,
      motivo_bloqueio: "Já existe uma devolução em andamento para este pedido.",
    });
    respostas.set("devolucoes_do_pedido", [DEVOLUCAO]);
    respostas.set("devolucao_detalhe", DEVOLUCAO);
    await renderizar();
    expect(cartao()?.textContent).toContain("DV-TESTE");
    const novaLeitura = pendente();
    rpc.mockImplementation(() => novaLeitura.promessa);

    await act(async () => {
      void ultimaLeitura().recarregar();
    });

    expect(ultimaLeitura().carregando).toBe(true);
    expect(cartao()?.textContent).toContain("DV-TESTE");
    expect(aviso()).toBeNull();
    await act(async () =>
      novaLeitura.resolver({
        data: null,
        error: { message: "Falha simulada" },
      }),
    );
    expect(ultimaLeitura().erro).toBe(true);
    expect(cartao()?.textContent).toContain("DV-TESTE");
    expect(cartao()?.textContent).toContain("Traga o produto para a troca.");
    expect(aviso()?.textContent).toContain(AVISO);
    expect(aviso()?.textContent).toContain("Tentar de novo");
  });

  it("pedido não entregue não consulta devolução nem mostra aviso", async () => {
    pedidoAtual = { ...pedidoEntregue, status: "shipping" };
    falhas.add("devolucao_elegibilidade");
    falhas.add("devolucoes_do_pedido");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Chegando até você");
    expect(rpc).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
    expect(solicitar()).toBeNull();
  });
});
