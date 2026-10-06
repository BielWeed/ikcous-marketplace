// @vitest-environment jsdom
//
// Ressalva da revisão do lote do número do pedido (04/10/2026), item 2: o
// cliente vê o pedido como "#3884BE" (6 últimos caracteres do id, em
// maiúsculas — `numeroDoPedido`), mas duas telas do painel ainda mostravam
// os 8 PRIMEIROS ("#c35ce4dd" / "#C35CE4DD"):
//   - a ficha da devolução (botão "Pedido #…", DetalheDaDevolucao.tsx);
//   - o extrato de pedidos da ficha do cliente (AdminUserDetailView.tsx).
// Quando o cliente liga dizendo "meu pedido 3884BE", a lojista não achava
// esse número nessas duas telas.
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
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

const ID_DO_PEDIDO = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

// Mesmo dublê de admin-user-detail-status-pending-traduzido.test.tsx: a RPC
// da ficha devolve um cliente com UM pedido.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [
            {
              id: ID_DO_PEDIDO,
              status: "delivered",
              total: 120,
              created_at: "2026-08-18T00:00:00Z",
              items: [],
            },
          ],
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// A ficha da devolução lê tudo por `useDevolucaoAdmin`; o dublê devolve a
// devolução já PASSADA pelo leitor real (`lerDevolucaoDetalhe`), para o teste
// não depender de um formato inventado.
vi.mock("@/hooks/useDevolucoesAdmin", async () => {
  const { lerDevolucaoDetalhe } =
    await vi.importActual<typeof import("@/lib/devolucao")>("@/lib/devolucao");
  const detalhe = lerDevolucaoDetalhe({
    id: "dev-1",
    protocolo: "DEV-2026-0001",
    order_id: "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be",
    tipo: "arrependimento",
    motivo: "desisti",
    resolucao_desejada: "reembolso",
    modalidade: "local",
    metodo_retorno: "entrega_na_loja",
    status: "concluida",
    itens: [],
    eventos: [],
    created_at: "2026-09-01T12:00:00Z",
    prazo_ate: "2026-09-08T12:00:00Z",
  });
  if (!detalhe) throw new Error("devolução de teste inválida");
  const nada = async () => true;
  return {
    useDevolucaoAdmin: () => ({
      detalhe,
      fotos: new Map(),
      carregando: false,
      erro: false,
      emVoo: null,
      recarregar: async () => {},
      aprovar: nada,
      recusar: nada,
      marcarEmTransito: nada,
      marcarRecebida: nada,
      gerarEtiquetaReversa: nada,
      liberarVinculoReverso: nada,
      concluir: nada,
      reprovar: nada,
      cancelar: nada,
    }),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

describe("Painel — o número do pedido é o mesmo que o cliente vê", () => {
  it("ficha da devolução: o botão do pedido diz 'Pedido #3884BE', nunca '#c35ce4dd'", async () => {
    const { DetalheDaDevolucao } = await import(
      "@/components/admin/devolucoes/DetalheDaDevolucao"
    );
    const onAbrirPedido = vi.fn();
    await act(async () => {
      raiz.render(
        <DetalheDaDevolucao
          id="dev-1"
          agora={new Date("2026-09-02T12:00:00Z")}
          onFechar={vi.fn()}
          onMudou={vi.fn()}
          onSujoMudou={vi.fn()}
          onAbrirPedido={onAbrirPedido}
        />,
      );
    });

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Pedido #"),
    );
    expect(botao?.textContent).toBe("Pedido #3884BE");
    expect(texto()).not.toMatch(/c35ce4dd/i);

    // O que se exibe muda; o que se ABRE continua sendo o id inteiro.
    await act(async () => {
      botao?.click();
    });
    expect(onAbrirPedido).toHaveBeenCalledWith(ID_DO_PEDIDO);
  });

  describe("ficha do cliente (extrato de pedidos)", () => {
    let TelaFicha: typeof TipoTelaFicha;

    beforeAll(async () => {
      ({ AdminUserDetailView: TelaFicha } = await import(
        "@/views/admin/AdminUserDetailView"
      ));
    });

    it("a linha do pedido mostra '#3884BE', nunca '#C35CE4DD'", async () => {
      const AdminUserDetailView = TelaFicha;
      const onNavigate = vi.fn();
      await act(async () => {
        raiz.render(
          <AdminUserDetailView
            userId="cliente-1"
            onBack={vi.fn()}
            onNavigate={onNavigate}
          />,
        );
      });
      await act(async () => {
        await esperar(50);
      });

      expect(texto()).toContain("#3884BE");
      expect(texto()).not.toMatch(/c35ce4dd/i);
    });
  });
});
