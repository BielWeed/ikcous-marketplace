// @vitest-environment jsdom
// Regressão: recuperar um rascunho ANTIGO de banner desfazia o que a lojista
// mudou depois (reativava o banner pausado, voltava a foto e a ordem velhas).
// O rascunho passa a guardar como o banner estava (`base`) e só devolve o que
// a lojista de fato editou; e vence em 7 dias, como o de produto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onSetDirty = vi.fn();

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
  // também os valores de preenchimento, e o teste não isolaria o título.
  overlayOpacity: 40,
  showTextOverlay: true,
  templateType: "default",
};

// O que a lista devolve AGORA: o teste troca entre a abertura e a reabertura.
let bannersAgora: Array<typeof bannerDeAbertura> = [bannerDeAbertura];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: bannersAgora,
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
    error: vi.fn(),
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

describe(
  "AdminBannersView — rascunho antigo não desfaz o banner",
  { timeout: 30000 },
  () => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let armazem: Map<string, string>;
    let rodada = 0;

    beforeEach(() => {
      vi.clearAllMocks();
      bannersAgora = [bannerDeAbertura];
      updateBanner.mockResolvedValue(undefined);
      deleteStorageFile.mockResolvedValue(undefined);
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
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    /** Renderiza a tela. Cada chamada passa um `onNavigate` novo para o `memo`
     * da tela não pular a renderização quando a lista mudou por fora. */
    async function renderizar() {
      const { AdminBannersView } = await import(
        "@/views/admin/AdminBannersView"
      );
      rodada += 1;
      await act(async () => {
        raiz.render(
          <AdminBannersView
            onNavigate={() => rodada}
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

    const titulo = () =>
      (document.getElementById("banner-title") as HTMLInputElement).value;

    /** Edita o título, espera o salvamento automático e fecha sem salvar. */
    async function deixarRascunhoComTituloEditado() {
      await editarPrimeiroBanner();
      await digitarTitulo("Título do rascunho");
      // O salvamento automático espera 1 s parado.
      await act(async () => esperar(1100));
      expect(armazem.get(CHAVE)).toBeDefined();
      await clicar("Cancelar");
      expect(document.getElementById("banner-title")).toBeNull();
    }

    it("banner pausado e com outra foto/ordem depois do rascunho: recuperar traz só o título", async () => {
      await renderizar();
      await deixarRascunhoComTituloEditado();

      // Depois do rascunho a lojista pausou o banner (e, em outro aparelho,
      // trocou a foto e a ordem).
      bannersAgora = [
        {
          ...bannerDeAbertura,
          active: false,
          imageUrl:
            "https://proj.supabase.co/storage/v1/object/public/banners/b.jpg",
          order: 5,
        },
      ];
      await renderizar();

      await editarPrimeiroBanner();
      expect(document.body.textContent).toContain("Rascunho salvo");
      expect(document.body.textContent).toContain(
        "Este banner foi alterado depois deste rascunho",
      );
      await clicar("Recuperar");
      expect(titulo()).toBe("Título do rascunho");

      await abrirMaisOpcoes();
      await clicar("Salvar Alterações");

      expect(updateBanner).toHaveBeenCalledTimes(1);
      const [id, enviado] = updateBanner.mock.calls[0];
      expect(id).toBe("banner-1");
      // Só o título viaja: o banner continua pausado, com a foto e a ordem novas.
      expect(enviado).toEqual({ title: "Título do rascunho" });
    });

    it("banner que não mudou depois: recupera igual e não mostra o aviso de 'alterado depois'", async () => {
      await renderizar();
      await deixarRascunhoComTituloEditado();
      await renderizar();

      await editarPrimeiroBanner();
      expect(document.body.textContent).toContain("Rascunho salvo");
      expect(document.body.textContent).not.toContain("alterado depois");
      await clicar("Recuperar");
      expect(titulo()).toBe("Título do rascunho");
    });

    it("rascunho com mais de 7 dias não é oferecido e sai do aparelho", async () => {
      await renderizar();
      const base = { ...bannerDeAbertura };
      armazem.set(
        CHAVE,
        JSON.stringify({
          formData: { ...base, title: "Rascunho velho" },
          base,
          editingBannerId: "banner-1",
          savedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );
      await editarPrimeiroBanner();

      expect(botao("Recuperar")).toBeUndefined();
      expect(armazem.has(CHAVE)).toBe(false);
    });

    it("rascunho de edição gravado antes desta regra (sem 'base') não é oferecido", async () => {
      await renderizar();
      armazem.set(
        CHAVE,
        JSON.stringify({
          formData: { ...bannerDeAbertura, title: "Rascunho sem base" },
          editingBannerId: "banner-1",
          savedAt: new Date().toISOString(),
        }),
      );
      await editarPrimeiroBanner();

      expect(botao("Recuperar")).toBeUndefined();
      expect(armazem.has(CHAVE)).toBe(false);
    });

    it("rascunho de OUTRO banner continua guardado e não é oferecido", async () => {
      await renderizar();
      const doutro = JSON.stringify({
        formData: { ...bannerDeAbertura, title: "Do outro" },
        base: { ...bannerDeAbertura },
        editingBannerId: "banner-99",
        savedAt: new Date().toISOString(),
      });
      armazem.set(CHAVE, doutro);
      await editarPrimeiroBanner();

      expect(botao("Recuperar")).toBeUndefined();
      expect(armazem.get(CHAVE)).toBe(doutro);
    });
  },
);
