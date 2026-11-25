// @vitest-environment jsdom
//
// Caça por mutação no Perfil, dois buracos de estado que a cliente lê:
//   1. "Remover foto" e "Remover capa": a janela só fecha e só avisa
//      "removida" quando a loja CONFIRMOU a remoção. Se o servidor recusou
//      (`updateProfile` devolve false), a janela fica aberta e nenhum aviso de
//      sucesso aparece — senão a cliente acha que a foto saiu e ela continua.
//   2. O botão "WhatsApp" do cartão do pedido some quando a loja não tem número
//      de verdade (vazio ou menos de 10 dígitos): `wa.me/` sem destinatário é
//      link quebrado.
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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

const { updateProfile, fetchAddresses, fetchUserOrders } = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  fetchAddresses: vi.fn(),
  fetchUserOrders: vi.fn(),
}));

let perfilAtual: Record<string, unknown> = {};
let pedidosAtuais: Order[] = [];
let whatsappDaLoja = "34999999999";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "conta-a", email: "conta-a@example.com" },
    profile: perfilAtual,
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses,
    deleteAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: pedidosAtuais, fetchUserOrders }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de Teste",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: whatsappDaLoja,
    },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => null,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// A aba de upload fica disponível sem esperar a animação de saída.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function pedidoAtivo(): Order {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-000000000001",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      {
        productId: "prod-1",
        name: "Blusa Teste",
        price: 50,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 50,
    shipping: 0,
    discount: 0,
    total: 50,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "processing",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

describe("ProfileView — remover foto/capa e botão de WhatsApp do pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/ProfileView");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    perfilAtual = {
      full_name: "Cliente",
      avatar_url: "https://fotos.test/eu.png",
      cover_url: "https://fotos.test/capa.png",
    };
    pedidosAtuais = [];
    whatsappDaLoja = "34999999999";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const botaoDoDialogo = (texto: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
    ].find((b) => b.textContent?.trim() === texto);

  const casos = [
    {
      nome: "foto",
      abrir: "button[aria-label='Trocar foto de perfil']",
      aba: "Foto Própria",
      remover: "Remover Foto",
      campo: "avatar_url",
      sucesso: "Foto de perfil removida.",
    },
    {
      nome: "capa",
      abrir: "[title='Alterar capa de fundo']",
      aba: null,
      remover: "Remover",
      campo: "cover_url",
      sucesso: "Capa de perfil removida.",
    },
  ] as const;

  async function abrirORemover(caso: (typeof casos)[number]) {
    await renderizar();
    await act(async () => {
      hospedeiro.querySelector<HTMLElement>(caso.abrir)!.click();
    });
    if (caso.aba) {
      await act(async () => botaoDoDialogo(caso.aba)!.click());
    }
    const botao = botaoDoDialogo(caso.remover);
    expect(botao).toBeDefined();
    return botao!;
  }

  it.each(casos)(
    "$nome: o servidor recusou -> a janela continua aberta e não diz 'removida'",
    async (caso) => {
      updateProfile.mockResolvedValue(false);
      const botao = await abrirORemover(caso);

      await act(async () => botao.click());

      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
        [caso.campo]: "REMOVE",
      });
      expect(document.querySelector("[role=dialog]")).not.toBeNull();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      // A janela fica aberta, mas SOLTA: sem o giro de "Atualizando..." /
      // "Salvando..." a cliente pode tentar de novo.
      const textoDaJanela =
        document.querySelector("[role=dialog]")?.textContent ?? "";
      expect(textoDaJanela).not.toContain("Atualizando...");
      expect(textoDaJanela).not.toContain("Salvando...");
    },
  );

  it.each(casos)(
    "$nome: o servidor confirmou -> avisa e fecha a janela",
    async (caso) => {
      updateProfile.mockResolvedValue(true);
      const botao = await abrirORemover(caso);

      await act(async () => botao.click());

      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
        [caso.campo]: "REMOVE",
      });
      expect(vi.mocked(toast.success)).toHaveBeenCalledExactlyOnceWith(
        caso.sucesso,
      );
      expect(document.querySelector("[role=dialog]")).toBeNull();
    },
  );

  const botaoWhatsappDoPedido = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith(
        "Falar pelo WhatsApp sobre o pedido",
      ),
    );

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["9 dígitos (curto demais)", "349999999"],
  ])(
    "loja sem número de verdade (%s): o cartão do pedido não tem botão de WhatsApp",
    async (_nome, numero) => {
      whatsappDaLoja = numero;
      pedidosAtuais = [pedidoAtivo()];
      await renderizar();

      expect(hospedeiro.textContent).toContain("Ver detalhes");
      expect(botaoWhatsappDoPedido()).toBeUndefined();
    },
  );

  it("loja com número de 10 dígitos (fixo): o botão de WhatsApp aparece", async () => {
    whatsappDaLoja = "3432221111";
    pedidosAtuais = [pedidoAtivo()];
    await renderizar();

    expect(botaoWhatsappDoPedido()).toBeDefined();
  });
});
