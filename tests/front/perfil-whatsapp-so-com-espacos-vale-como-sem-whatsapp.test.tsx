// @vitest-environment jsdom
//
// Prova de mutação (24/11/2026): tirar o `.trim()` de
// `String(profile?.whatsapp ?? "").trim()` na ProfileView não derrubava
// nenhum teste. Sem ele, um WhatsApp guardado só com espaços (cadastro antigo,
// colagem) é "verdadeiro": o Perfil mostrava uma linha WhatsApp VAZIA, sem o
// convite "Adicionar WhatsApp", e a cliente não tinha por onde cadastrar.
// RENDER DE VERDADE da ProfileView; hooks de dados são dublês. Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = {
  profile: null as Record<string, unknown> | null,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "maria.conta@exemplo.test",
      user_metadata: {},
      created_at: "2026-10-15T12:00:00Z",
    },
    profile: estado.profile,
    fetchProfile: vi.fn().mockResolvedValue(true),
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
    erroAoCarregar: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: async () => [] }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja Teste", whatsappNumber: "34999999999" },
  }),
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

async function abrir() {
  const { ProfileView } = await import("@/views/customer/ProfileView");
  await act(async () => {
    raiz.render(<ProfileView onNavigate={vi.fn()} isActive />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** O texto que aparece embaixo do rótulo "WhatsApp" do cartão da conta. */
function linhaDoWhatsapp() {
  const rotulo = [...hospedeiro.querySelectorAll("p, span")].find(
    (el) => el.textContent === "WhatsApp",
  );
  return (rotulo?.parentElement?.textContent ?? "").replace("WhatsApp", "");
}

it("WhatsApp guardado só com espaços vale como sem WhatsApp: mostra o convite, não uma linha vazia", async () => {
  estado.profile = {
    full_name: "Maria",
    avatar_url: null,
    cover_url: null,
    whatsapp: "   ",
  };
  await abrir();

  expect(linhaDoWhatsapp()).toBe("Adicionar WhatsApp");
});

it("limite: WhatsApp com espaços nas pontas aparece formatado, sem espaço sobrando", async () => {
  estado.profile = {
    full_name: "Maria",
    avatar_url: null,
    cover_url: null,
    whatsapp: "  34987654321 ",
  };
  await abrir();

  expect(linhaDoWhatsapp()).toBe("(34) 98765-4321");
});
