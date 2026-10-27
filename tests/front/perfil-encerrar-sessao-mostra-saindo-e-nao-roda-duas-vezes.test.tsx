// @vitest-environment jsdom
//
// "Encerrar sessão" esperava a limpeza do aviso (push) da conta, de até 3 s,
// sem nenhuma reação na tela: a pessoa tocava de novo, achando que não pegou, e
// a saída rodava duas vezes. Agora o botão mostra "Saindo…", fica desligado
// enquanto a saída roda, e um segundo toque não chama a saída outra vez.
//
// RENDER DE VERDADE da ProfileView; só os hooks de dados são dublês.
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn<() => Promise<void>>();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "maria.teste@exemplo.test",
      user_metadata: {},
      created_at: "2026-10-15T12:00:00Z",
    },
    profile: {
      full_name: "Maria Teste Silva",
      avatar_url: null,
      cover_url: null,
      whatsapp: "34988887777",
    },
    logout,
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

describe("ProfileView — Encerrar sessão mostra que está saindo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();
  let terminarLogout: () => void;

  beforeEach(() => {
    onNavigate.mockClear();
    logout.mockReset();
    // A saída fica "pendente" até o teste terminar de propósito (rede lenta).
    logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminarLogout = resolve;
        }),
    );
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
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const botaoDeSair = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes("Encerrar sessão") ||
        b.textContent?.includes("Saindo"),
    ) as HTMLButtonElement | undefined;

  const tocar = async (el: HTMLElement | undefined) => {
    expect(el).toBeDefined();
    await act(async () => {
      el?.click();
    });
  };

  // Lote 221: "Encerrar sessão" agora pergunta antes; a saída roda no "Sim, sair".
  const confirmarSaida = async () => {
    await tocar(botaoDeSair());
    await tocar(
      [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Sim, sair"),
      ) as HTMLElement | undefined,
    );
  };

  it("antes de tocar: botão normal, habilitado, 'Encerrar sessão'", async () => {
    await renderizar();
    const sair = botaoDeSair();
    expect(sair?.disabled).toBe(false);
    expect(sair?.textContent).toContain("Encerrar sessão");
    expect(sair?.textContent).not.toContain("Saindo");
  });

  it("com a saída pendente: mostra 'Saindo…' e o botão fica desligado", async () => {
    await renderizar();
    await confirmarSaida();

    expect(logout).toHaveBeenCalledTimes(1);
    const sair = botaoDeSair();
    expect(sair?.disabled).toBe(true);
    expect(sair?.textContent).toContain("Saindo…");
    expect(sair?.textContent).not.toContain("Encerrar sessão");
  });

  it("segundo toque durante a saída NÃO chama a saída outra vez", async () => {
    await renderizar();
    await confirmarSaida();
    await tocar(botaoDeSair());
    await tocar(botaoDeSair());

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("limite: se a saída termina e a tela continua montada, o botão volta ao normal", async () => {
    await renderizar();
    await confirmarSaida();
    expect(botaoDeSair()?.disabled).toBe(true);

    await act(async () => {
      terminarLogout();
      await Promise.resolve();
    });

    expect(botaoDeSair()?.disabled).toBe(false);
    expect(botaoDeSair()?.textContent).toContain("Encerrar sessão");
  });

  it("limite: se a saída FALHA (lança), o botão volta ao normal e dá para tentar de novo", async () => {
    logout.mockReset();
    logout.mockRejectedValueOnce(new Error("rede caiu"));
    logout.mockImplementation(() => new Promise<void>(() => {}));
    await renderizar();

    await confirmarSaida();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(botaoDeSair()?.disabled).toBe(false);

    await confirmarSaida();
    expect(logout).toHaveBeenCalledTimes(2);
  });
});
