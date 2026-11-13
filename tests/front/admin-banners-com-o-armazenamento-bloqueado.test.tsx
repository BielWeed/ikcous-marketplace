// @vitest-environment jsdom
//
// O EDITOR DE BANNER ABRE E SALVA COM O ARMAZENAMENTO BLOQUEADO (caça, r438-a).
//
// Chrome com "Bloquear todos os cookies e dados de sites" e política de
// empresa fazem o próprio ACESSO a `localStorage` lançar SecurityError. O
// editor lia o rascunho ao abrir (efeito sem try), gravava o rascunho num
// temporizador de 1 s (exceção solta) e apagava o rascunho DEPOIS de o banner
// já estar salvo (lançava, caía no `catch` do salvar e a tela dizia "Erro ao
// salvar" com o banner já gravado; a lojista salvava de novo).
//
// Regra: rascunho indisponível = "sem rascunho"; guardar ou apagar rascunho
// nunca vira erro de quem usa. Harness copiado de
// admin-banners-rascunho-antigo-nao-desfaz-o-banner.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onSetDirty = vi.fn();
const toastError = vi.fn();

const CHAVE = "admin_banner_form_draft:lojista-1";

const bannerDeAbertura = {
  id: "banner-1",
  imageUrl: "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
  // Os campos que o editor sempre preenche: sem eles o salvar mandaria
  // também os valores de preenchimento.
  overlayOpacity: 40,
  showTextOverlay: true,
  templateType: "default",
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [bannerDeAbertura],
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile,
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({}),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError,
    loading: vi.fn(() => "toast-id"),
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/** O bloqueio de verdade: o ACESSO à propriedade lança, como no navegador. */
function bloquearOAcesso(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

describe(
  "AdminBannersView — o editor abre e salva com o armazenamento bloqueado",
  { timeout: 30000 },
  () => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let armazem: Map<string, string>;
    let desbloquear: (() => void) | null;
    let errosSoltos: unknown[];
    const aoErroSolto = (erro: unknown) => {
      errosSoltos.push(erro);
    };
    const aoErroDaJanela = (evento: ErrorEvent) => {
      evento.preventDefault();
      errosSoltos.push(evento.error);
    };

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      updateBanner.mockResolvedValue(undefined);
      deleteStorageFile.mockResolvedValue(undefined);
      errosSoltos = [];
      process.on("uncaughtException", aoErroSolto);
      window.addEventListener("error", aoErroDaJanela);
      vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
      vi.stubGlobal("ResizeObserver", ResizeObserverStub);
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      armazem = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (chave: string) => armazem.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
          armazem.set(chave, valor);
        },
        removeItem: (chave: string) => {
          armazem.delete(chave);
        },
      });
      desbloquear = null;
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      process.off("uncaughtException", aoErroSolto);
      window.removeEventListener("error", aoErroDaJanela);
      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
      desbloquear?.();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    async function renderizar() {
      const { AdminBannersView } = await import(
        "@/views/admin/AdminBannersView"
      );
      await act(async () => {
        raiz.render(
          <AdminBannersView
            onNavigate={() => 0}
            active={true}
            onSetDirty={onSetDirty}
          />,
        );
      });
      await act(async () => esperar());
    }

    const botao = (texto: string) =>
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(texto),
      ) as HTMLButtonElement | undefined;

    async function clicar(texto: string) {
      const b = botao(texto);
      if (!b) throw new Error(`Botão ${texto} ausente`);
      await act(async () => b.click());
      await act(async () => esperar());
    }

    async function editarPrimeiroBanner() {
      const editar = hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Editar"]',
      );
      if (!editar) throw new Error("Botão Editar ausente");
      await act(async () => editar.click());
      await act(async () => esperar());
    }

    async function digitarTitulo(valor: string) {
      const campo = document.getElementById("banner-title") as HTMLInputElement;
      await act(async () => {
        campo.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
    }

    async function abrirMaisOpcoes() {
      const resumo = [...document.querySelectorAll("summary")].find(
        (s) => s.textContent?.trim() === "Mais opções",
      );
      if (!resumo) throw new Error("Mais opções ausente");
      if (!resumo.parentElement?.hasAttribute("open")) {
        await act(async () => resumo.click());
      }
    }

    it("abrir o editor com o armazenamento bloqueado: a tela abre, sem rascunho e sem erro", async () => {
      await renderizar();
      desbloquear = bloquearOAcesso();

      await editarPrimeiroBanner();

      expect(document.getElementById("banner-title")).not.toBeNull();
      expect(botao("Recuperar")).toBeUndefined();
      expect(errosSoltos).toEqual([]);
    });

    it("digitar com o armazenamento bloqueado: o salvamento automático não solta erro", async () => {
      await renderizar();
      desbloquear = bloquearOAcesso();
      await editarPrimeiroBanner();

      await digitarTitulo("Título novo");
      // O salvamento automático espera 1 s parado.
      await act(async () => esperar(1200));

      expect(errosSoltos).toEqual([]);
      expect(
        (document.getElementById("banner-title") as HTMLInputElement).value,
      ).toBe("Título novo");
    });

    it("salvar com o armazenamento bloqueado: o banner salvo fecha o editor, sem 'Erro ao salvar'", async () => {
      await renderizar();
      desbloquear = bloquearOAcesso();
      await editarPrimeiroBanner();
      await digitarTitulo("Título novo");
      await abrirMaisOpcoes();

      await clicar("Salvar Alterações");

      expect(updateBanner).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
      expect(document.getElementById("banner-title")).toBeNull();
      expect(errosSoltos).toEqual([]);
    });

    it("controle: com armazenamento normal o rascunho é guardado e apagado ao salvar", async () => {
      await renderizar();
      await editarPrimeiroBanner();
      await digitarTitulo("Título novo");
      await act(async () => esperar(1200));
      expect(armazem.has(CHAVE)).toBe(true);
      await abrirMaisOpcoes();

      await clicar("Salvar Alterações");

      expect(updateBanner).toHaveBeenCalledTimes(1);
      expect(armazem.has(CHAVE)).toBe(false);
      expect(document.getElementById("banner-title")).toBeNull();
    });
  },
);
