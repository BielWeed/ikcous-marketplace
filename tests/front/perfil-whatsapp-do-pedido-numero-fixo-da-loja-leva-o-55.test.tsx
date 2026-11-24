// @vitest-environment jsdom
//
// Prova de mutação (24/11/2026): trocar `phone.length === 11 || phone.length === 10`
// por `phone.length === 11` em `handleWhatsAppSupport` (ProfileView) não derrubava
// nenhum teste — só o celular de 11 dígitos era conferido. A loja com telefone
// FIXO no WhatsApp (DDD + 8 dígitos = 10) abria `wa.me/3433334444`, sem o 55 do
// país: conversa com número que não existe. E o número já guardado com o 55
// (12 ou 13 dígitos) nunca pode ganhar um segundo 55.
//
// RENDER DE VERDADE da tela; hooks de dados são dublês (molde de
// perfil-botao-whatsapp-original). Dados inventados.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const config: { whatsappNumber: string | null } = { whatsappNumber: null };

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

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: async () => [pedido],
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja Teste", ...config },
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

let raiz: Root;
let hospedeiro: HTMLDivElement;
let abrir: ReturnType<typeof vi.fn>;

beforeEach(() => {
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

/** Abre o Perfil, toca no WhatsApp do pedido e devolve o endereço aberto. */
async function linkAbertoParaALoja(numeroDaLoja: string): Promise<string> {
  config.whatsappNumber = numeroDaLoja;
  const { ProfileView } = await import("@/views/customer/ProfileView");
  await act(async () => {
    raiz.render(<ProfileView onNavigate={() => {}} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const botao = [...hospedeiro.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === "WhatsApp" &&
      [...(b.parentElement?.querySelectorAll("button") ?? [])].some((i) =>
        i.textContent?.includes("Ver detalhes"),
      ),
  );
  expect(botao).toBeDefined();
  await act(async () => {
    botao?.click();
  });
  expect(abrir).toHaveBeenCalledTimes(1);
  const [url] = abrir.mock.calls[0] as [string];
  return url.split("?")[0];
}

it.each([
  [
    "telefone fixo (DDD + 8 dígitos) ganha o 55",
    "(34) 3333-4444",
    "553433334444",
  ],
  ["celular (DDD + 9 + 8 dígitos) ganha o 55", "34999998888", "5534999998888"],
  ["celular já com 55 não ganha um segundo", "5534999998888", "5534999998888"],
  ["fixo já com 55 não ganha um segundo", "553433334444", "553433334444"],
  [
    "+55 digitado com máscara vira um só 55",
    "+55 (34) 99999-8888",
    "5534999998888",
  ],
])("o link do pedido: %s", async (_caso, numeroDaLoja, esperado) => {
  expect(await linkAbertoParaALoja(numeroDaLoja)).toBe(
    `https://wa.me/${esperado}`,
  );
});
