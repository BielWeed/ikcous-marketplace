// @vitest-environment jsdom
//
// O que este teste protege na tela de Perfil (ProfileView), nos limites que os
// testes vizinhos não pisam:
//  - nome vindo do cadastro: com espaços nas pontas aparece aparado, e só com
//    espaços NÃO vira nome em branco (cai para o e-mail da conta);
//  - o nome do login social (`user_metadata.name`) vale quando não há nome de
//    perfil nem `full_name` no cadastro;
//  - "Sim, sair" tocado duas vezes NO MESMO INSTANTE (antes de a tela
//    redesenhar o botão desligado) chama a saída UMA vez só — o trinco da
//    saída, não o botão desligado, é quem segura o segundo toque;
//  - "Cliente desde" usa a data da CONTA quando a conta e o perfil trazem datas
//    diferentes.
// RENDER DE VERDADE da ProfileView; só os hooks de dados são dublês, com dados
// inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  metadata: {} as Record<string, unknown>,
  profile: null as Record<string, unknown> | null,
  contaCriadaEm: "2026-10-15T12:00:00Z" as string | undefined,
};
const logout = vi.fn<() => Promise<void>>();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "maria.conta@exemplo.test",
      user_metadata: estado.metadata,
      created_at: estado.contaCriadaEm,
    },
    profile: estado.profile,
    fetchProfile: async () => true,
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

describe("ProfileView — nome do cadastro, saída e 'Cliente desde'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.metadata = {};
    estado.profile = null;
    estado.contaCriadaEm = "2026-10-15T12:00:00Z";
    logout.mockReset();
    logout.mockImplementation(() => new Promise<void>(() => {}));
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
      await Promise.resolve();
    });
  }

  const titulo = () => hospedeiro.querySelector("h1")?.textContent;
  const textos = () => hospedeiro.textContent ?? "";

  describe("nome do cadastro", () => {
    it("com espaços nas pontas aparece aparado", async () => {
      estado.metadata = { full_name: "   Maria da Conta   " };
      await abrir();

      expect(titulo()).toBe("Maria da Conta");
    });

    it("só com espaços não vira nome em branco: cai para o e-mail da conta", async () => {
      estado.metadata = { full_name: "     " };
      await abrir();

      expect(titulo()).toBe("maria.conta");
    });

    it("o nome do login social vale quando não há full_name", async () => {
      estado.metadata = { name: "Maria do Login Social" };
      await abrir();

      expect(titulo()).toBe("Maria do Login Social");
    });

    it("full_name do cadastro vence o nome do login social", async () => {
      estado.metadata = {
        full_name: "Maria do Cadastro",
        name: "Maria do Login Social",
      };
      await abrir();

      expect(titulo()).toBe("Maria do Cadastro");
    });
  });

  describe("Sim, sair tocado duas vezes no mesmo instante", () => {
    it("chama a saída uma vez só", async () => {
      await abrir();
      const encerrar = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Encerrar sessão"),
      );
      expect(encerrar).toBeDefined();
      await act(async () => {
        encerrar?.click();
      });
      const confirmar = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.includes("Sim, sair"),
      );
      expect(confirmar).toBeDefined();

      // Dois toques antes de o React redesenhar: o botão ainda não está desligado.
      await act(async () => {
        confirmar?.click();
        confirmar?.click();
      });

      expect(logout).toHaveBeenCalledTimes(1);
    });
  });

  describe("Cliente desde", () => {
    it("usa a data da conta quando o perfil traz outra data", async () => {
      estado.contaCriadaEm = "2026-10-15T12:00:00Z";
      estado.profile = {
        full_name: "Maria",
        avatar_url: null,
        cover_url: null,
        created_at: "2025-01-20T12:00:00Z",
      };
      await abrir();

      expect(textos()).toContain("Cliente desde out/2026");
      expect(textos()).not.toContain("jan/2025");
    });

    it("sem data na conta, usa a data do perfil", async () => {
      estado.contaCriadaEm = undefined;
      estado.profile = {
        full_name: "Maria",
        avatar_url: null,
        cover_url: null,
        created_at: "2025-01-20T12:00:00Z",
      };
      await abrir();

      expect(textos()).toContain("Cliente desde jan/2025");
    });
  });
});
