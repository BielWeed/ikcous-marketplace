// @vitest-environment jsdom
//
// Perfil: quem usa só o teclado (ou leitor de tela) precisa conseguir chegar ao
// envio da foto de perfil e da capa — o mesmo que a tela de Ajustes da conta já
// permite (conta-foto-e-capa-alcancaveis-pelo-teclado.test.tsx).
//
// DEFEITO: os quatro campos de arquivo do Perfil eram `className="hidden"`
// (display:none), que não recebe foco no Tab; o <label> em volta também não é
// focável. O teclado abria a janela e parava ali. Agora o campo é `sr-only`
// (some da vista mas continua focável) e o label mostra um anel de foco quando
// o campo recebe foco (`focus-within`).
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estado } = vi.hoisted(() => ({
  estado: {
    profile: { avatar_url: null, cover_url: null } as {
      avatar_url: string | null;
      cover_url: string | null;
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "conta-a", email: "conta-a@example.com" },
    profile: { full_name: "Cliente", ...estado.profile },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: vi.fn(),
  }),
}));
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
    config: {
      storeName: "IKCOUS - imports",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => null,
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => null,
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
class Stub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Perfil — campos de foto e de capa alcançáveis pelo teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", Stub);
    vi.stubGlobal("IntersectionObserver", Stub);
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

  async function abrirAba(seletor: string, aba: string) {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={vi.fn()} />);
    });
    await act(async () =>
      hospedeiro.querySelector<HTMLElement>(seletor)!.click(),
    );
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
        .find((b) => b.textContent?.trim() === aba)!
        .click();
    });
  }

  const FOTO = "button[aria-label='Trocar foto de perfil']";
  const CAPA = "[title='Alterar capa de fundo']";

  function esperaFocavelComAnel(id: string) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    expect(input, `#${id} existe`).not.toBeNull();
    const classes = (input as HTMLInputElement).className.split(/\s+/);
    // display:none (classe "hidden") tira o campo da ordem do Tab.
    expect(classes).not.toContain("hidden");
    expect(classes).toContain("sr-only");
    expect((input as HTMLInputElement).tabIndex).not.toBe(-1);
    const label = (input as HTMLInputElement).closest("label");
    expect(label, `#${id} está dentro de um label`).not.toBeNull();
    const classesDoLabel = (label as HTMLLabelElement).className;
    expect(classesDoLabel).toContain("focus-within:ring-2");
    // O campo escondido é posicionado em relação ao label, não à página.
    expect(classesDoLabel).toMatch(/\brelative\b|\babsolute\b/);
  }

  it("foto já enviada: o ícone da câmera e o botão 'Escolher Outra Foto' recebem foco", async () => {
    estado.profile = { avatar_url: "/avatar-a.png", cover_url: null };
    await abrirAba(FOTO, "Foto Própria");
    esperaFocavelComAnel("profile-avatar-upload-icon");
    esperaFocavelComAnel("profile-avatar-upload-button");
  });

  it("sem foto ainda: a área 'Enviar foto do dispositivo' recebe foco", async () => {
    estado.profile = { avatar_url: null, cover_url: null };
    await abrirAba(FOTO, "Foto Própria");
    esperaFocavelComAnel("avatar_file_input_profile");
  });

  it("capa: o campo de envio recebe foco", async () => {
    estado.profile = { avatar_url: null, cover_url: null };
    await abrirAba(CAPA, "Enviar Foto");
    esperaFocavelComAnel("cover_file_input_profile");
  });

  it("o fluxo de envio não mudou: os campos continuam aceitando só imagem e sendo ligados ao label", async () => {
    estado.profile = { avatar_url: "/avatar-a.png", cover_url: null };
    await abrirAba(FOTO, "Foto Própria");
    for (const id of [
      "profile-avatar-upload-icon",
      "profile-avatar-upload-button",
    ]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.type).toBe("file");
      expect(input.accept).toBe("image/*");
      expect(input.closest("label")?.getAttribute("for")).toBe(id);
    }
  });
});
