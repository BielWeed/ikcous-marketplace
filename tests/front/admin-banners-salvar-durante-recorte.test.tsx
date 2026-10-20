// @vitest-environment jsdom
import type { Banner } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadBannerImage = vi.fn<(file: File) => Promise<string>>();
const deleteStorageFile = vi.fn<(url: string) => Promise<void>>();
const updateBanner =
  vi.fn<(id: string, banner: Partial<Banner>) => Promise<void>>();
const imagemNova = "https://loja.test/upload-x.webp";
const imagemAjustada = "https://loja.test/recorte-a.webp";
const banner: Banner = {
  id: "banner-a",
  title: "",
  imageUrl: "https://loja.test/original-o.jpg",
  link: "",
  position: "home_top",
  active: true,
  order: 1,
};
let confirmarRecorte: (blob: Blob) => Promise<void>;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [banner],
    isLoaded: true,
    uploadBannerImage,
    deleteStorageFile,
    updateBanner,
    addBanner: vi.fn(),
    deleteBanner: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(() => "toast-recorte"),
  },
}));
// A exportação do bitmap é a fronteira simulada; os handlers são da view real.
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: (props: {
    onConfirm: (blob: Blob) => Promise<void>;
    isSubmitting: boolean;
  }) => {
    confirmarRecorte = props.onConfirm;
    return (
      <button
        type="button"
        data-testid="confirmar-recorte"
        disabled={props.isSubmitting}
        onClick={() =>
          void props.onConfirm(new Blob(["recorte"], { type: "image/webp" }))
        }
      >
        Confirmar recorte
      </button>
    );
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function pendente<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

describe("salvar banner e recortar não disputam a imagem publicada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadBannerImage.mockReset().mockResolvedValue(imagemNova);
    deleteStorageFile.mockReset().mockResolvedValue(undefined);
    updateBanner.mockReset().mockResolvedValue(undefined);
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
    const armazem = new Map<string, string>();
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function botao(texto: string) {
    const encontrado = [...hospedeiro.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === texto,
    );
    if (!encontrado) throw new Error(`Botão ${texto} ausente`);
    return encontrado;
  }

  async function clicar(texto: string) {
    await act(async () => botao(texto).click());
    await act(async () => {
      if (["Completo", "3Destino", "✓Conteúdo"].includes(texto)) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else await esperar();
    });
  }

  async function abrir(modo: "Simples" | "Completo") {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView active={true} onNavigate={vi.fn()} />);
    });
    const editar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    if (!editar) throw new Error("Botão Editar ausente");
    await act(async () => editar.click());
    await act(async () => esperar());
    if (modo === "Completo") await clicar("Completo");
    const input =
      hospedeiro.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Upload ausente");
    const arquivo = new File(["nova"], "x.webp", { type: "image/webp" });
    Object.defineProperty(input, "files", { value: [arquivo] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
    });
    expect(imagem()).toBe(imagemNova);
  }

  function imagem() {
    return hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"], img[alt="Banner Preview"]',
    )?.src;
  }

  async function destino(modo: "Simples" | "Completo") {
    if (modo === "Completo") await clicar("3Destino");
    const enviando = [...hospedeiro.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Enviando Imagem...",
    );
    return (
      enviando ||
      botao(modo === "Completo" ? "Salvar Alterações" : "Salvar Banner")
    );
  }

  async function pressionarEscape() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
  }

  it.each(["Simples", "Completo"] as const)(
    "%s: Escape durante recorte bloqueia salvar e depois publica só a imagem ajustada",
    async (modo) => {
      await abrir(modo);
      await clicar("Ajustar");
      const recorte = pendente<string>();
      uploadBannerImage.mockReturnValueOnce(recorte.promessa);
      await clicar("Confirmar recorte");
      await pressionarEscape();
      const salvar = await destino(modo);
      // Sem a guarda U2, a view publica X e o retorno do recorte pode excluir X.
      expect(salvar.disabled).toBe(true);
      await act(async () => salvar.click());
      expect(updateBanner).not.toHaveBeenCalled();
      await act(async () => recorte.resolver(imagemAjustada));
      expect(imagem()).toBe(imagemAjustada);
      const liberado = await destino(modo);
      expect(liberado.disabled).toBe(false);
      await act(async () => liberado.click());
      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemAjustada }),
      );
      expect(hospedeiro.querySelector('input[type="file"]')).toBeNull();
      expect(deleteStorageFile.mock.calls).toEqual([[imagemNova]]);
      expect(
        localStorage.getItem("admin_banner_form_draft:lojista-1"),
      ).toBeNull();
    },
  );

  it("recorte iniciado e salvar no mesmo lote usa guarda síncrona", async () => {
    await abrir("Simples");
    await clicar("Ajustar");
    const recorte = pendente<string>();
    uploadBannerImage.mockReturnValueOnce(recorte.promessa);
    const salvar = botao("Salvar Banner");
    await act(async () => {
      void confirmarRecorte(new Blob(["recorte"], { type: "image/webp" }));
      salvar.click();
    });
    expect(updateBanner).not.toHaveBeenCalled();
    await act(async () => recorte.resolver(imagemAjustada));
    expect(imagem()).toBe(imagemAjustada);
  });

  it.each(["Simples", "Completo"] as const)(
    "%s: salvar pendente recusa até callback antigo de recorte sem upload ou limpeza",
    async (modo) => {
      await abrir(modo);
      await clicar("Ajustar");
      const callbackAntigo = confirmarRecorte;
      await pressionarEscape();
      const salvar = await destino(modo);
      const envio = pendente<void>();
      updateBanner.mockReturnValueOnce(envio.promessa);
      await act(async () => salvar.click());
      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemNova }),
      );
      const uploadsAntes = uploadBannerImage.mock.calls.length;
      await act(async () => {
        await callbackAntigo(new Blob(["recorte"], { type: "image/webp" }));
      });
      expect(uploadBannerImage).toHaveBeenCalledTimes(uploadsAntes);
      expect(deleteStorageFile).not.toHaveBeenCalled();
      await act(async () => envio.resolver());
      expect(deleteStorageFile).not.toHaveBeenCalled();
      expect(hospedeiro.querySelector('input[type="file"]')).toBeNull();
    },
  );

  it.each(["Simples", "Completo"] as const)(
    "%s: falha de salvar preserva imagem e rascunho e permite recortar depois",
    async (modo) => {
      await abrir(modo);
      const salvar = await destino(modo);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      });
      const rascunho = localStorage.getItem(
        "admin_banner_form_draft:lojista-1",
      );
      expect(rascunho).toContain(imagemNova);
      const envio = pendente<void>();
      updateBanner.mockReturnValueOnce(envio.promessa);
      await act(async () => salvar.click());
      await act(async () => envio.rejeitar(new Error("Falha de rede")));
      expect(deleteStorageFile).not.toHaveBeenCalled();
      expect(localStorage.getItem("admin_banner_form_draft:lojista-1")).toBe(
        rascunho,
      );
      if (modo === "Completo") await clicar("✓Conteúdo");
      expect(imagem()).toBe(imagemNova);
      await clicar("Ajustar");
      uploadBannerImage.mockResolvedValueOnce(imagemAjustada);
      await clicar("Confirmar recorte");
      expect(imagem()).toBe(imagemAjustada);
      const tentarNovamente = await destino(modo);
      expect(tentarNovamente.disabled).toBe(false);
      await act(async () => tentarNovamente.click());
      expect(updateBanner).toHaveBeenLastCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemAjustada }),
      );
      expect(deleteStorageFile.mock.calls).toEqual([[imagemNova]]);
    },
  );

  it.each(["Simples", "Completo"] as const)(
    "%s: sucesso sem recorte não exclui imagem publicada",
    async (modo) => {
      await abrir(modo);
      const salvar = await destino(modo);
      await act(async () => salvar.click());
      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemNova }),
      );
      expect(deleteStorageFile).not.toHaveBeenCalled();
      expect(hospedeiro.querySelector('input[type="file"]')).toBeNull();
    },
  );
});
