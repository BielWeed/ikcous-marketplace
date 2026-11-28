// @vitest-environment jsdom
//
// Perfil e Ajustes da conta, janela "Trocar foto": enquanto um avatar pronto
// grava, os outros avatares não aceitam segunda escolha.
//
// DEFEITO: só a camada "Atualizando..." por cima da grade segurava o dedo. Ela
// não segura o teclado nem o leitor de tela: Enter num segundo avatar disparava
// outra gravação no meio da primeira. Agora os botões dos avatares ficam
// `disabled` durante a gravação, como os de capa e o "Remover".
import { PREDEFINED_AVATARS } from "@/utils/avatars";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Objetos estáveis: um novo a cada render faria os efeitos da tela rodarem em laço.
const { rpc, updateProfile, estado } = vi.hoisted(() => ({
  rpc: vi.fn(),
  updateProfile: vi.fn(),
  estado: {
    user: { id: "conta-a", email: "conta-a@example.com" },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: estado.user,
    profile: estado.profile,
    fetchProfile: vi.fn(),
    updateProfile,
    updatePassword: vi.fn(),
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    deleteAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: vi.fn() }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => null,
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => null,
}));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Stub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const telas = [
  {
    nome: "Perfil",
    abrirFoto: "button[aria-label='Trocar foto de perfil']",
    montar: async () => {
      const { ProfileView } = await import("@/views/customer/ProfileView");
      return <ProfileView onNavigate={vi.fn()} />;
    },
  },
  {
    nome: "Ajustes da conta",
    abrirFoto: "[role=button][tabindex='0']",
    montar: async () => {
      const { AccountSettingsView } = await import(
        "@/views/customer/AccountSettingsView"
      );
      return <AccountSettingsView />;
    },
  },
] as const;

describe.each(telas)("$nome — avatar pronto não grava duas vezes", (tela) => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", Stub);
    vi.stubGlobal("IntersectionObserver", Stub);
    rpc.mockResolvedValue({
      data: [{ full_name: "Nome", whatsapp: "" }],
      error: null,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    updateProfile.mockReset();
  });

  const avatar = (rotulo: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
    ].find((b) => b.getAttribute("title") === rotulo)!;

  it("com a gravação pendente, os avatares ficam disabled e a segunda escolha não grava", async () => {
    let terminar!: (ok: boolean) => void;
    updateProfile.mockReturnValue(
      new Promise<boolean>((resolve) => {
        terminar = resolve;
      }),
    );
    const elemento = await tela.montar();
    await act(async () => {
      raiz.render(elemento);
    });
    await act(async () =>
      hospedeiro.querySelector<HTMLElement>(tela.abrirFoto)!.click(),
    );

    const [primeiro, segundo] = PREDEFINED_AVATARS;
    expect(avatar(primeiro.label).disabled).toBe(false);
    await act(async () => avatar(primeiro.label).click());
    expect(updateProfile).toHaveBeenCalledTimes(1);

    for (const a of PREDEFINED_AVATARS) {
      expect(avatar(a.label).disabled, `avatar ${a.label}`).toBe(true);
    }
    // Enter e Espaço num botão viram clique; botão desabilitado não recebe.
    await act(async () => avatar(segundo.label).click());
    expect(updateProfile).toHaveBeenCalledTimes(1);

    await act(async () => terminar(false));
    expect(avatar(segundo.label).disabled).toBe(false);
  });
});
