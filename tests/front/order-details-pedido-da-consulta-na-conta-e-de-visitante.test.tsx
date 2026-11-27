// @vitest-environment jsdom
//
// 27/11/2026 — dentro da conta, "Meus pedidos" ganhou a consulta de pedido
// feito em outra conta (ConsultaSemContaNaConta). O que ela acha é gravado no
// RETRATO do rastreio (sessionStorage) e o detalhe do pedido abre por ele.
//
// Antes, a ficha só perguntava "tem alguém na conta?": com a conta aberta, o
// pedido CONSULTADO (que não é desta conta) mostrava Cancelar, Retomar
// pagamento, Reenviar comprovante, Devolução e Avaliar — ações que o servidor
// recusa, porque a dona do pedido é outra — e escondia o "fale com a loja".
// Agora: pedido que veio da consulta é tratado como o do visitante.
//
// RENDER DE VERDADE da tela; só os hooks de dados, a sessão e o banco são
// dublês (molde de order-details-convidado-nao-ve-cancelar-pedido).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Order } from "@/types";

const { fetchUserOrders, ligadosDaDevolucao, estado } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  ligadosDaDevolucao: [] as boolean[],
  estado: {
    user: null as { id: string } | null,
    orders: [] as unknown[],
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
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
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: estado.orders,
    ordersLoadError: null,
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: false }),
}));
vi.mock("@/hooks/useDevolucaoCliente", () => ({
  useDevolucaoCliente: (_id: string, ligado: boolean) => {
    ligadosDaDevolucao.push(ligado);
    return {
      atual: null,
      devolucoes: [],
      elegibilidade: ligado ? { pode: true, motivo_bloqueio: null } : null,
      erro: null,
      carregando: false,
      aguardandoAviso: false,
      recarregar: vi.fn(),
      solicitar: vi.fn(),
      cancelar: vi.fn(),
      informarEnvio: vi.fn(),
      enviarFoto: vi.fn(),
      descartarFotos: vi.fn(),
    };
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      storeAddress: "Rua Inventada, 10",
      whatsappNumber: "11900000000",
    },
  }),
}));

const ID = "pedido-achado-na-consulta";
const pedido = (parcial: Partial<Order>): Order => ({
  id: ID,
  customer: { name: "Cliente Inventada", whatsapp: "11900000001" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "processing",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
  ...parcial,
});

// Os três estágios em que cada ação do dono existe.
const CENARIOS = [
  {
    nome: "aguardando pagamento",
    pedido: pedido({ status: "pending", paymentStatus: "aguardando" }),
    acoesDaDona: ["Cancelar Pedido", "Retomar pagamento"],
    orientacao: "Para cancelar, fale com a loja informando o número do pedido.",
  },
  {
    nome: "pago e em preparo",
    pedido: pedido({ status: "processing", paymentStatus: "pago" }),
    acoesDaDona: ["Cancelar Pedido", "Reenviar comprovante"],
    orientacao: "Para cancelar, fale com a loja informando o número do pedido.",
  },
  {
    nome: "entregue",
    pedido: pedido({ status: "delivered", paymentStatus: "pago" }),
    acoesDaDona: [
      "Reenviar comprovante",
      "Solicitar devolução ou troca",
      "O que achou da compra?",
    ],
    orientacao:
      "Para devolução ou troca, fale com a loja informando o número do pedido.",
  },
] as const;

function armazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => {
      dados.set(c, String(v));
    },
    removeItem: (c: string) => {
      dados.delete(c);
    },
    clear: () => dados.clear(),
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

function gravarRetrato(p: Order) {
  sessionStorage.setItem(
    "guest_tracked_orders",
    JSON.stringify({ consultadoEm: Date.now(), pedidos: [p] }),
  );
}

async function abrir() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={ID}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
        onRetomarPagamento={vi.fn()}
      />,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";

beforeAll(async () => {
  await import("@/views/customer/OrderDetailsView");
}, 60_000);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", armazem());
  vi.stubGlobal("localStorage", armazem());
  vi.clearAllMocks();
  ligadosDaDevolucao.length = 0;
  estado.user = { id: "conta-que-consultou" };
  estado.orders = [];
  fetchUserOrders.mockResolvedValue([]);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("ficha do pedido achado pela consulta dentro da conta", () => {
  it.each(CENARIOS)(
    "$nome: com a conta aberta, o pedido CONSULTADO não oferece ação da dona e manda falar com a loja",
    async ({ pedido: p, acoesDaDona, orientacao }) => {
      // A conta aberta não tem este pedido; ele só existe no retrato.
      gravarRetrato(p);

      await abrir();

      // A ficha abriu mesmo (com o aviso de retrato): sem isso a ausência das
      // ações não provaria nada.
      expect(texto()).toContain("Meu pedido");
      expect(texto()).toContain("pode ter mudado");
      for (const acao of acoesDaDona) expect(texto()).not.toContain(acao);
      expect(texto()).toContain(orientacao);
      // A devolução nem chega a perguntar ao servidor.
      expect(ligadosDaDevolucao).not.toContain(true);
    },
  );

  it.each(CENARIOS)(
    "controle $nome: o MESMO pedido vindo da lista da conta mostra as ações da dona e não o 'fale com a loja'",
    async ({ pedido: p, acoesDaDona, orientacao }) => {
      fetchUserOrders.mockResolvedValue([p]);

      await abrir();

      expect(texto()).toContain("Meu pedido");
      for (const acao of acoesDaDona) expect(texto()).toContain(acao);
      expect(texto()).not.toContain(orientacao);
    },
  );

  // A cliente logada consultou o PRÓPRIO pedido pela consulta e depois o abre
  // com a lista da conta vazia (ou falhando): o retrato diz que o pedido é
  // desta conta (`user_id`), então as ações dela não somem.
  it.each(CENARIOS)(
    "$nome: o pedido do retrato cujo user_id é o da conta aberta mostra as ações da dona",
    async ({ pedido: p, acoesDaDona, orientacao }) => {
      gravarRetrato({ ...p, userId: "conta-que-consultou" });

      await abrir();

      expect(texto()).toContain("Meu pedido");
      // Continua dizendo de quando é o status: o retrato não atualiza sozinho.
      expect(texto()).toContain("pode ter mudado");
      for (const acao of acoesDaDona) expect(texto()).toContain(acao);
      expect(texto()).not.toContain(orientacao);
    },
  );

  it("controle: o pedido do retrato com user_id de OUTRA conta segue sem as ações da dona", async () => {
    const { pedido: p, acoesDaDona } = CENARIOS[1];
    gravarRetrato({ ...p, userId: "outra-conta" });

    await abrir();

    expect(texto()).toContain("pode ter mudado");
    for (const acao of acoesDaDona) expect(texto()).not.toContain(acao);
  });

  it("LIMITE: o pedido consultado que também é da conta passa a ser da dona quando a lista da conta o traz", async () => {
    const p = CENARIOS[1].pedido;
    gravarRetrato(p);

    await abrir();
    expect(texto()).not.toContain("Cancelar Pedido");

    // A lista viva da conta traz o mesmo pedido: ele é desta conta.
    estado.orders = [p];
    await abrir();

    expect(texto()).toContain("Cancelar Pedido");
    expect(texto()).not.toContain("pode ter mudado");
    expect(texto()).not.toContain(CENARIOS[1].orientacao);
  });
});
