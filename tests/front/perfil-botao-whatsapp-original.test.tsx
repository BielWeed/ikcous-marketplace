// @vitest-environment jsdom
//
// Pedido do dono (26/10/2026, print do Perfil): o botão "WhatsApp" do cartão de
// "Pedidos em andamento" era um botão branco com contorno e só o texto. Tem de
// ser o ORIGINAL do WhatsApp: verde oficial, glifo oficial à esquerda, rótulo,
// alvo de toque de 48 px e foco visível — e continuar abrindo exatamente o mesmo
// link (mesmo número, mesma mensagem, mesmo isolamento da aba nova).
//
// RENDER DE VERDADE da tela; só os hooks de dados e a lista de endereços são
// dublês (mesmo molde de perfil-pedidos-em-andamento-falam-a-verdade).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { numeroDoPedido } from "@/lib/numero-do-pedido";

const config: { whatsappNumber: string | null } = {
  whatsappNumber: "34999999999",
};
let pedidosAtuais: Order[] = [];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "cliente@ikcous.com", user_metadata: {} },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidosAtuais,
    fetchUserOrders: async () => pedidosAtuais,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "IKCOUS - imports", ...config },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="address-list-stub" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

const pedido: Order = {
  id: "pedido-do-perfil-0001",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    { productId: "p1", name: "Blusa", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

const CAMINHO_OFICIAL = (() => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  act(() => {
    r.render(<IconeWhatsapp />);
  });
  const d = host.querySelector("path")?.getAttribute("d") ?? "";
  act(() => {
    r.unmount();
  });
  host.remove();
  return d;
})();

describe("Perfil — o botão de WhatsApp do pedido é o original do WhatsApp", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config.whatsappNumber = "34999999999";
    pedidosAtuais = [pedido];
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
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

  async function renderizar() {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function botaoWhatsapp(): HTMLButtonElement | undefined {
    // o do cartão do pedido: irmão de "Ver detalhes" (a linha "Adicionar
    // WhatsApp" do perfil é um campo de dado, não um botão de contato)
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.trim() === "WhatsApp" &&
        [...(b.parentElement?.querySelectorAll("button") ?? [])].some((i) =>
          i.textContent?.includes("Ver detalhes"),
        ),
    );
  }

  it("o glifo oficial exato, verde oficial, rótulo, alvo de 48 px e foco visível", async () => {
    expect(CAMINHO_OFICIAL.length).toBeGreaterThan(100);
    await renderizar();
    const botao = botaoWhatsapp();
    expect(botao).toBeDefined();

    // glifo oficial, o MESMO traço do componente IconeWhatsapp (nunca desenho próprio)
    const caminhos = [...(botao?.querySelectorAll("svg path") ?? [])].map((p) =>
      p.getAttribute("d"),
    );
    expect(caminhos).toEqual([CAMINHO_OFICIAL]);

    // verde oficial #25D366 de fundo, texto escuro (contraste), sem o contorno branco antigo
    const classes = botao?.className ?? "";
    expect(classes).toContain("bg-[#25D366]");
    expect(classes).toMatch(/text-\[#0B141A\]/i);
    expect(classes).not.toContain("bg-background");
    expect(classes).not.toContain("border-border");

    // rótulo visível
    expect(botao?.textContent?.trim()).toBe("WhatsApp");

    // alvo de toque 48 px (h-12, como o irmão "Ver detalhes") e cantos da loja
    expect(classes).toMatch(/(^|\s)h-12(\s|$)/);
    expect(classes).toContain("rounded-2xl");

    // foco visível com anel
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-ring");
  });

  it("o nome do botão cita o pedido (vários cartões não repetem só 'WhatsApp') e contém o rótulo visível", async () => {
    await renderizar();
    const nome = botaoWhatsapp()?.getAttribute("aria-label") ?? "";
    expect(nome).toContain("WhatsApp");
    expect(nome).toContain("#");
  });

  it("clicar abre o MESMO link: DDI 55, mensagem do pedido, aba isolada", async () => {
    await renderizar();
    await act(async () => {
      botaoWhatsapp()?.click();
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(url.startsWith("https://wa.me/5534999999999?text=")).toBe(true);
    // O texto TEM de levar o número do pedido deste cartão (6 últimos
    // caracteres do id, em maiúsculas). Antes o padrão /#.+\./ aceitava
    // qualquer id: trocar order.id por 'x' não derrubava o teste.
    expect(numeroDoPedido(pedido.id)).toBe("L-0001");
    expect(decodeURIComponent(url.split("?text=")[1] ?? "")).toBe(
      `Olá! Tenho uma dúvida sobre meu pedido #${numeroDoPedido(pedido.id)}.`,
    );
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
  });

  it("loja sem WhatsApp cadastrado: o botão continua sumindo", async () => {
    config.whatsappNumber = null;
    await renderizar();
    expect(botaoWhatsapp()).toBeUndefined();
  });
});
