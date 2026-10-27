// @vitest-environment jsdom
//
// Lote 221, tela de Perfil:
//  1. "Encerrar sessão" saía no primeiro toque. Agora pergunta antes, com o
//     diálogo do app (não o confirm() do navegador).
//  2. A foto do perfil era um <div role="button">: agora é um botão de
//     verdade, com nome para o leitor de tela.
//  3. As janelas de foto e de capa fecham SÓ a janela com o Voltar do celular
//     (a tela de Perfil fica) e não sobra entrada de histórico.
// Render de verdade da ProfileView; só os hooks de dados são dublês.
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

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ProfileView — confirmar saída, foto em botão e Voltar do celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();
  let navegacoesDoApp: string[];
  const ouvintes: Array<() => void> = [];

  const telaDoHistorico = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

  beforeEach(() => {
    onNavigate.mockClear();
    logout.mockReset();
    logout.mockResolvedValue(undefined);
    globalThis.history.replaceState({ view: "home" }, "", "/");
    globalThis.history.pushState({ view: "profile" }, "", "/profile");
    navegacoesDoApp = [];
    let telaMostrada = telaDoHistorico();
    const ouvinte = () => {
      const alvo = telaDoHistorico();
      if (alvo === telaMostrada) return;
      telaMostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
    ouvintes.push(ouvinte);
    globalThis.addEventListener("popstate", ouvinte);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o);
    }
  });

  async function renderizar() {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await esperar(20);
    });
  }

  const botaoPorTexto = (texto: string, dentro: ParentNode = document.body) =>
    [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      (b.textContent ?? "").includes(texto),
    );
  const dialogoDeConfirmacao = () =>
    document.body.querySelector<HTMLElement>('[role="alertdialog"]');
  const janelaDeFoto = () =>
    document.body.querySelector<HTMLElement>('[role="dialog"]');
  const fotoDoPerfil = () =>
    hospedeiro.querySelector<HTMLElement>(
      '[aria-label="Trocar foto de perfil"]',
    );

  async function tocar(el: HTMLElement | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
      await esperar(120);
    });
    await act(async () => {
      await esperar(120);
    });
  }

  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await esperar(60);
    });
    await act(async () => {
      await esperar(120);
    });
  }

  describe("Encerrar sessão pede confirmação", () => {
    it("um toque só abre a pergunta: a sessão NÃO é encerrada", async () => {
      await renderizar();
      await tocar(botaoPorTexto("Encerrar sessão", hospedeiro));
      expect(dialogoDeConfirmacao()).not.toBeNull();
      expect(logout).not.toHaveBeenCalled();
    });

    it("confirmar encerra uma vez", async () => {
      await renderizar();
      await tocar(botaoPorTexto("Encerrar sessão", hospedeiro));
      await tocar(
        botaoPorTexto("Sim, sair", dialogoDeConfirmacao() as HTMLElement),
      );
      expect(logout).toHaveBeenCalledTimes(1);
      expect(dialogoDeConfirmacao()).toBeNull();
    });

    it("Continuar na conta fecha a pergunta e nada é encerrado", async () => {
      await renderizar();
      await tocar(botaoPorTexto("Encerrar sessão", hospedeiro));
      await tocar(
        botaoPorTexto(
          "Continuar na conta",
          dialogoDeConfirmacao() as HTMLElement,
        ),
      );
      expect(logout).not.toHaveBeenCalled();
      expect(dialogoDeConfirmacao()).toBeNull();
    });

    it("o Voltar do celular fecha só a pergunta: a tela de Perfil fica", async () => {
      await renderizar();
      await tocar(botaoPorTexto("Encerrar sessão", hospedeiro));
      await apertarVoltar();
      expect(dialogoDeConfirmacao()).toBeNull();
      expect(logout).not.toHaveBeenCalled();
      expect(navegacoesDoApp).toEqual([]);
      expect(globalThis.history.state).toEqual({ view: "profile" });
    });
  });

  describe("foto do perfil", () => {
    it("é um botão de verdade, com nome para o leitor de tela", async () => {
      await renderizar();
      const alvo = fotoDoPerfil();
      expect(alvo?.tagName).toBe("BUTTON");
      expect((alvo as HTMLButtonElement).type).toBe("button");
    });

    it("o Voltar do celular fecha só a janela de foto", async () => {
      await renderizar();
      await tocar(fotoDoPerfil());
      expect(janelaDeFoto()?.textContent).toContain("Escolher Avatar ou Foto");
      await apertarVoltar();
      expect(janelaDeFoto()).toBeNull();
      expect(navegacoesDoApp).toEqual([]);
      expect(globalThis.history.state).toEqual({ view: "profile" });
      await apertarVoltar();
      expect(navegacoesDoApp).toEqual(["home|/"]);
    });

    it("fechar a janela de foto pelo X consome a entrada: a tela não recua", async () => {
      await renderizar();
      await tocar(fotoDoPerfil());
      await tocar(
        [...janelaDeFoto()!.querySelectorAll<HTMLElement>("button")].find(
          (b) =>
            (b.textContent ?? "").includes("Close") ||
            b.querySelector(".sr-only"),
        ),
      );
      expect(janelaDeFoto()).toBeNull();
      expect(navegacoesDoApp).toEqual([]);
      expect(globalThis.history.state).toEqual({ view: "profile" });
    });
  });

  describe("capa do perfil", () => {
    it("o Voltar do celular fecha só a janela de capa", async () => {
      await renderizar();
      await tocar(
        hospedeiro.querySelector<HTMLElement>(
          '[aria-label="Alterar capa de fundo"]',
        ),
      );
      expect(janelaDeFoto()).not.toBeNull();
      await apertarVoltar();
      expect(janelaDeFoto()).toBeNull();
      expect(navegacoesDoApp).toEqual([]);
      expect(globalThis.history.state).toEqual({ view: "profile" });
    });
  });
});
