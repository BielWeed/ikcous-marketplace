// @vitest-environment jsdom
//
// Lote 567: o "Está certo" da Loja pronta no Início (20261652000000). O cartão
// (`LojaProntaEEstoqueBaixo`) já tem teste próprio de que o toque devolve a
// chave do passo ("entrega" ou "recebe"); faltava o Início inteiro, que traduz
// essa chave no campo gravado pelo `updateConfig`. Trocar a tradução gravava
// "pagamento confirmado" quando a lojista confirmava a ENTREGA: o passo da
// entrega nunca virava feito e o do pagamento sumia sem ela ter olhado.
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  updateConfig: vi.fn<(parcial: Record<string, unknown>) => Promise<boolean>>(),
  config: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => undefined,
  },
}));
vi.mock("@/hooks/useRecomendadosDaLoja", () => ({
  useRecomendadosDaLoja: () => ({
    email: "configurado",
    nomesLigados: ["Melhor Envio"],
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "adm-1" } },
    profile: { full_name: "Dona da Loja" },
    isAdmin: true,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: h.config,
    isLoaded: true,
    products: [{ isActive: true, stock: 5 }],
    loadingProducts: false,
    catalogoErro: false,
    configIndisponivel: false,
    refresh: vi.fn(),
    fetchProducts: vi.fn(),
    updateConfig: h.updateConfig,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "38500000",
  rua: "Rua Rui Barbosa",
  numero: "10",
  complemento: "",
  bairro: "Centro",
  cidade: "Monte Carmelo",
  uf: "MG",
});

let hospedeiro: HTMLDivElement | undefined;
let raiz: Root | undefined;

afterEach(() => {
  if (raiz) act(() => raiz?.unmount());
  hospedeiro?.remove();
  raiz = undefined;
  hospedeiro = undefined;
  h.updateConfig.mockReset();
});

describe("Início: 'Está certo' da Loja pronta grava o passo certo", () => {
  it("no passo da ENTREGA, grava entregaConfirmada — nunca pagamentoConfirmado", async () => {
    // Tudo pronto; só a entrega que veio de fábrica falta confirmar.
    h.config = {
      storeName: "Ateliê da Serra",
      logoUrl: "https://exemplo.test/logo.png",
      originCep: ENDERECO_PRONTO.originCep,
      storeAddress: ENDERECO_PRONTO.storeAddress,
      whatsappNumber: "(34) 99999-9999",
      localDeliveryFee: 10,
      localDeliveryDays: 1,
      entregaConfirmada: false,
      pagamentoConfirmado: true,
    };
    h.updateConfig.mockResolvedValue(true);

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz?.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
    });

    expect(hospedeiro.textContent).toContain(
      "Entrega na sua cidade: R$ 10,00, em 1 dia.",
    );
    const estaCerto = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((b) => (b.textContent ?? "").trim() === "Está certo");
    // Só o passo da entrega está a confirmar: um único "Está certo".
    expect(estaCerto).toHaveLength(1);

    await act(async () => {
      estaCerto[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.updateConfig).toHaveBeenCalledExactlyOnceWith({
      entregaConfirmada: true,
    });
    expect(h.updateConfig).not.toHaveBeenCalledWith(
      expect.objectContaining({ pagamentoConfirmado: true }),
    );
  });
});
