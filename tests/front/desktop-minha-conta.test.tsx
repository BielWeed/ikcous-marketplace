// @vitest-environment jsdom
import { MenuDaConta } from "@/components/desktop/MenuDaConta";
import type { View } from "@/types";
import { AccountSettingsView } from "@/views/customer/AccountSettingsView";
import { AddressFormView } from "@/views/customer/AddressFormView";
import { ProfileView } from "@/views/customer/ProfileView";
import { UserProfileView } from "@/views/customer/UserProfileView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const usuario = {
  id: "cliente-fixture",
  email: "cliente@example.test",
  user_metadata: {},
};
const perfil = {
  full_name: "Cliente Exemplo",
  avatar_url: "/avatar.svg",
  cover_url: null,
  created_at: "2026-01-01",
};
let admin = false;
const vazio = async () => [];
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario,
    profile: perfil,
    isAdmin: admin,
    loading: false,
    logout: vi.fn(),
    updateProfile: vi.fn(),
    fetchProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vazio,
    deleteAddress: vazio,
    addAddress: vazio,
    updateAddress: vazio,
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: vazio }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja Exemplo", enableReviews: true },
  }),
}));
vi.mock("@/lib/cpf-da-conta", () => ({
  lerCpfDaConta: async () => ({ ok: true, cpf: "" }),
  gravarCpfDaConta: vi.fn(),
  mensagemFalhaCpf: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (nome: string) => ({
      data: nome === "get_my_complete_profile" ? [perfil] : [],
      error: null,
    }),
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: perfil, error: null }) }),
      }),
    }),
  },
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div />,
}));
vi.mock("@/components/ui/custom/AddressForm", () => ({
  AddressForm: () => <form aria-label="Endereço" />,
}));

// @ts-expect-error flag de teste interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
function computador() {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(min-width: 1024px)",
    addEventListener() {},
    removeEventListener() {},
  }));
}
beforeEach(() => {
  admin = false;
  vi.stubGlobal("matchMedia", undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function conferir(el: Element | null, celular: string, desktop: string) {
  expect(el).not.toBeNull();
  expect(classesDoCelular(el!.getAttribute("class") || "")).toBe(celular);
  expect(el!.getAttribute("class")).toContain(desktop);
}

describe("F7 — menu da conta", () => {
  async function montar(atual: View, onNavigate = vi.fn()) {
    await act(async () =>
      raiz.render(<MenuDaConta atual={atual} onNavigate={onNavigate} />),
    );
    return onNavigate;
  }
  it("mostra identidade, navega e marca apenas o destino atual", async () => {
    const navegar = await montar("profile");
    expect(
      host.querySelector('aside[aria-label="Minha conta"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain(perfil.full_name);
    expect(host.textContent).toContain(usuario.email);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      perfil.avatar_url,
    );
    const destinos = ["profile", "orders", "account-settings", "about-store"];
    const links = host.querySelectorAll("a");
    expect(links).toHaveLength(4);
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect([...links].map((link) => link.getAttribute("href"))).toEqual(
      destinos.map((view) => `/${view}`),
    );
    for (const view of destinos) {
      const link = host.querySelector<HTMLAnchorElement>(`a[href="/${view}"]`);
      act(() => link!.click());
      expect(navegar).toHaveBeenLastCalledWith(view);
    }
    expect(host.textContent).not.toContain("Sair");
    expect(host.textContent).not.toContain("Painel da loja");
  });
  it("oferece painel apenas para admin", async () => {
    admin = true;
    const navegar = await montar("account-settings");
    const link = [...host.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Painel da loja"),
    );
    expect(link).toBeDefined();
    act(() => link!.click());
    expect(navegar).toHaveBeenLastCalledWith("admin");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain(
      "Configurações",
    );
  });
});

describe("F7 — telas reais preservam classes do celular", () => {
  it("Perfil ganha grade e capa, com menu só no computador", async () => {
    const montar = async () =>
      act(async () => raiz.render(<ProfileView onNavigate={vi.fn()} />));
    await montar();
    expect(host.querySelector("aside")).toBeNull();
    conferir(
      host.firstElementChild,
      "pb-customer min-h-full bg-gradient-to-b from-white to-zinc-50/50",
      "lg:grid-cols-[280px_minmax(0,1fr)]",
    );
    conferir(
      host.querySelector(".h-48"),
      "group relative h-48 w-full overflow-hidden bg-zinc-100 shadow-inner",
      "lg:h-56",
    );
    conferir(
      host.querySelector(".max-w-md"),
      "mx-auto max-w-md space-y-6 px-4",
      "lg:max-w-none",
    );
    const menu = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Segurança e Conta"),
    )?.parentElement;
    conferir(
      menu!,
      "overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white shadow-sm",
      "lg:hidden",
    );
    computador();
    await montar();
    expect(
      host.querySelector('aside[aria-label="Minha conta"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("Encerrar Sessão");
  });
  it("Configurações ganha menu e campos em duas colunas sem mudar o celular", async () => {
    await act(async () => raiz.render(<AccountSettingsView />));
    expect(host.querySelector("aside")).toBeNull();
    conferir(
      host.querySelector(".max-w-md"),
      "mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8",
      "lg:max-w-3xl",
    );
    conferir(
      host.querySelector("#full_name")?.closest(".space-y-3\\.5") || null,
      "space-y-3.5",
      "lg:grid-cols-2",
    );
    computador();
    await act(async () => raiz.render(<AccountSettingsView />));
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain(
      "Configurações",
    );
  });
  it("Endereço ganha cartão largo e menu só no computador", async () => {
    const montar = async () =>
      act(async () => raiz.render(<AddressFormView onBack={vi.fn()} />));
    await montar();
    expect(host.querySelector("aside")).toBeNull();
    conferir(
      host.querySelector(".max-w-md"),
      "mx-auto max-w-md px-4 py-8",
      "lg:max-w-2xl",
    );
    computador();
    await montar();
    expect(
      host.querySelector('aside[aria-label="Minha conta"]'),
    ).not.toBeNull();
    expect(host.querySelector('form[aria-label="Endereço"]')).not.toBeNull();
  });
  it("Perfil público mantém as classes e a ordem da identidade e atividades", async () => {
    await act(async () =>
      raiz.render(
        <UserProfileView userId="cliente-fixture" onNavigate={vi.fn()} />,
      ),
    );
    conferir(
      host.firstElementChild,
      "pb-customer min-h-full bg-gradient-to-b from-white to-zinc-50/50",
      "lg:max-w-5xl",
    );
    conferir(
      host.querySelector(".max-w-md"),
      "mx-auto max-w-md space-y-6 px-4",
      "lg:grid-cols-[280px_minmax(0,1fr)]",
    );
    expect(host.querySelector("h1")?.textContent).toBe(perfil.full_name);
    expect(host.querySelector("aside")).toBeNull();
  });
});
