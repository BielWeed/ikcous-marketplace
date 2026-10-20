// @vitest-environment jsdom
// O dono do recorte é o editor que iniciou o upload, não o que está aberto na resposta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadBannerImage = vi.fn<(file: File) => Promise<string>>();
const deleteStorageFile = vi.fn<(url: string) => Promise<void>>();
const updateBanner = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastDismiss = vi.fn();
const toastLoading = vi.fn(() => "toast-recorte");
const banners = ["a", "b"].map((id, indice) => ({
  id: `banner-${id}`,
  title: "",
  imageUrl: `https://loja.test/banner-${id}.jpg`,
  link: "",
  position: "home_top" as const,
  active: true,
  order: indice + 1,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners,
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
    success: toastSuccess,
    error: toastError,
    dismiss: toastDismiss,
    loading: toastLoading,
  },
}));
// Só a exportação do bitmap é dublada; estado, fechamento e callbacks são da view real.
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: (props: {
    onConfirm: (blob: Blob) => Promise<void>;
    isSubmitting: boolean;
  }) => (
    <button
      type="button"
      data-testid="confirmar-recorte"
      disabled={props.isSubmitting}
      onClick={() => void props.onConfirm(new Blob(["recorte"], { type: "image/webp" }))}
    >
      Confirmar recorte
    </button>
  ),
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function uploadPendente() {
  let resolver!: (url: string) => void;
  let rejeitar!: (erro: Error) => void;
  uploadBannerImage.mockReturnValueOnce(new Promise<string>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  }));
  return { resolver, rejeitar };
}

describe("recorte de banner não atravessa gerações do editor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadBannerImage.mockReset();
    deleteStorageFile.mockReset().mockResolvedValue(undefined);
    updateBanner.mockResolvedValue(undefined);
    toastLoading.mockImplementation(() => `toast-${toastLoading.mock.calls.length}`);
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => { armazem.set(chave, valor); },
      removeItem: (chave: string) => { armazem.delete(chave); },
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

  async function montar(active = true) {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView active={active} onNavigate={vi.fn()} />);
      await esperar();
    });
    await act(async () => esperar());
  }

  async function editar(indice: number) {
    const botao = hospedeiro.querySelectorAll<HTMLButtonElement>('button[title="Editar"]').item(indice);
    if (!botao) throw new Error("Botão Editar ausente");
    await act(async () => botao.click());
    await act(async () => esperar());
  }

  async function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === texto,
    );
    if (!botao) throw new Error(`Botão ${texto} ausente`);
    await act(async () => botao.click());
    await act(async () => esperar());
  }

  function confirmar() {
    const botao = hospedeiro.querySelector<HTMLButtonElement>('[data-testid="confirmar-recorte"]');
    if (!botao) throw new Error("Ajustador ausente");
    return botao;
  }

  async function iniciarRecorte() {
    await clicar("Ajustar");
    expect(confirmar().disabled).toBe(false);
    const upload = uploadPendente();
    await act(async () => confirmar().click());
    expect(uploadBannerImage).toHaveBeenCalledWith(expect.any(File));
    expect(confirmar().disabled).toBe(true);
    return upload;
  }

  async function trocarParaB() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(hospedeiro.querySelector('[data-testid="confirmar-recorte"]')).toBeNull();
    await clicar("Cancelar");
    await editar(1);
  }

  function imagem() {
    return hospedeiro.querySelector<HTMLImageElement>('img[alt="Preview Thumbnail"]')?.src;
  }

  it("Escape, cancelar A e abrir B impede que o sucesso tardio de A troque B", async () => {
    await montar();
    await editar(0);
    const a = await iniciarRecorte();
    await trocarParaB();
    await act(async () => a.resolver("https://loja.test/recorte-a.webp"));

    expect(imagem()).toBe(banners[1].imageUrl);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    expect(deleteStorageFile.mock.calls).toEqual([["https://loja.test/recorte-a.webp"]]);
    await clicar("Salvar Banner");
    expect(updateBanner).toHaveBeenCalledWith("banner-b", expect.objectContaining({
      imageUrl: banners[1].imageUrl, title: "",
    }));
  });

  it.each(["sucesso", "falha"] as const)("finally antigo (%s) não desliga o recorte pendente de B", async (resultado) => {
    await montar();
    await editar(0);
    const a = await iniciarRecorte();
    await trocarParaB();
    const b = await iniciarRecorte();
    await act(async () => {
      if (resultado === "sucesso") a.resolver("https://loja.test/recorte-a.webp");
      else a.rejeitar(new Error("Falha A"));
    });
    expect(confirmar().disabled).toBe(true);
    expect(imagem()).toBe(banners[1].imageUrl);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    await act(async () => b.resolver("https://loja.test/recorte-b.webp"));
    expect(imagem()).toBe("https://loja.test/recorte-b.webp");
    expect(hospedeiro.querySelector('[data-testid="confirmar-recorte"]')).toBeNull();
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("desativar a tela invalida A mesmo depois de reativar e abrir B", async () => {
    await montar();
    await editar(0);
    const a = await iniciarRecorte();
    await montar(false);
    await montar(true);
    await editar(1);
    await act(async () => a.resolver("https://loja.test/recorte-a.webp"));
    expect(imagem()).toBe(banners[1].imageUrl);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(deleteStorageFile.mock.calls).toEqual([["https://loja.test/recorte-a.webp"]]);
  });

  it("recorte atual adota a imagem e não apaga a imagem publicada", async () => {
    await montar();
    await editar(0);
    const a = await iniciarRecorte();
    await act(async () => a.resolver("https://loja.test/recorte-a.webp"));
    expect(imagem()).toBe("https://loja.test/recorte-a.webp");
    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Imagem ajustada com sucesso!", { id: "toast-1" });
  });

  it("falha atual preserva imagem e ajustador e libera nova tentativa", async () => {
    await montar();
    await editar(0);
    const a = await iniciarRecorte();
    await act(async () => a.rejeitar(new Error("Falha de rede")));
    expect(imagem()).toBe(banners[0].imageUrl);
    expect(confirmar().disabled).toBe(false);
    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Erro ao salvar imagem ajustada", { id: "toast-1" });
  });

  it("falha ao limpar órfão não altera B nem apaga outra imagem", async () => {
    await montar();
    await editar(0);
    const a = await iniciarRecorte();
    await trocarParaB();
    deleteStorageFile.mockRejectedValueOnce(new Error("Falha da limpeza"));
    await act(async () => a.resolver("https://loja.test/recorte-a.webp"));
    expect(imagem()).toBe(banners[1].imageUrl);
    expect(deleteStorageFile.mock.calls).toEqual([["https://loja.test/recorte-a.webp"]]);
    expect(toastError).not.toHaveBeenCalled();
  });
});
