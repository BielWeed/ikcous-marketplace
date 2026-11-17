// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirNovoBannerPelaBarra,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";
const h = vi.hoisted(() => ({
  upload: vi.fn(),
  update: vi.fn(),
  apagar: vi.fn(),
  recorte: null as any,
}));
const celular = "https://example.com/celular.webp";
const computador = "https://example.com/computador.webp";
const banner = {
  id: "b1",
  imageUrl: celular,
  desktopImageUrl: computador,
  title: "Campanha",
  position: "home_top",
  active: true,
  order: 1,
  showTextOverlay: false,
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "teste" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [banner],
    isLoaded: true,
    uploadBannerImage: h.upload,
    updateBanner: h.update,
    addBanner: vi.fn(),
    deleteStorageFile: h.apagar,
    deleteBanner: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: (props: any) => {
    h.recorte = props;
    return (
      <button
        onClick={() =>
          props.onConfirm(new Blob(["corte"], { type: "image/webp" }))
        }
      >
        Confirmar recorte de teste
      </button>
    );
  },
}));
// @ts-expect-error flag de testes do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let root: Root;
let host: HTMLDivElement;
function botao(texto: string) {
  const b = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().includes(texto),
  );
  expect(b, texto).toBeTruthy();
  return b!;
}
async function clicar(texto: string) {
  await act(async () => botao(texto).click());
}
async function enviar(url: string) {
  h.upload.mockResolvedValueOnce(url);
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>("#banner-upload")!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["foto"], "arte.webp", { type: "image/webp" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  banner.desktopImageUrl = computador;
  banner.active = true;
  localStorage.clear();
  h.upload.mockReset();
  h.update.mockResolvedValue(undefined);
  h.apagar.mockResolvedValue(undefined);
  h.recorte = null;
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
  await act(async () =>
    root.render(<AdminBannersView active onNavigate={vi.fn()} />),
  );
  const editar =
    document.querySelector<HTMLButtonElement>(
      'button[title="Editar Banner"]',
    ) ?? document.querySelector<HTMLButtonElement>('button[title="Editar"]');
  expect(editar).toBeTruthy();
  await act(async () => editar!.click());
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("configurar uma versão sem substituir a outra", () => {
  async function mostrarListaSemComputador(ativo = true) {
    await clicar("Cancelar");
    banner.desktopImageUrl = "";
    banner.active = ativo;
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      root.render(<AdminBannersView active onNavigate={vi.fn()} />),
    );
  }
  it("computador sem imagem não mostra foto do celular em nenhuma prévia", async () => {
    await mostrarListaSemComputador();
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar Banner"], button[title="Editar"]',
    )!;
    await act(async () => editar.click());
    expect(
      document.querySelector('img[alt="Banner Preview"]')?.getAttribute("src"),
    ).toBe(celular);
    await clicar("Computador (4:1)");
    const editor = document.body;
    expect(editor.querySelector('img[alt="Banner Preview"]')).toBeNull();
    expect(editor.querySelector('img[alt="Imagem do computador"]')).toBeNull();
    expect(editor.textContent).toContain(
      "Este banner não aparece no computador",
    );
    await clicar("Celular (2:1)");
    expect(
      document.querySelector('img[alt="Banner Preview"]')?.getAttribute("src"),
    ).toBe(celular);
  });
  it("lista avisa quando banner ativo não tem imagem para computador", async () => {
    await mostrarListaSemComputador();
    expect(host.textContent).toContain("Sem imagem para o computador");
  });
  it("lista não avisa quando banner está pausado ou tem imagem de computador", async () => {
    await clicar("Cancelar");
    expect(host.textContent).not.toContain("Sem imagem para o computador");
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar Banner"], button[title="Editar"]',
    )!;
    await act(async () => editar.click());
    await mostrarListaSemComputador(false);
    expect(host.textContent).not.toContain("Sem imagem para o computador");
  });
  it("novo banner só com computador informa que falta a imagem do celular", async () => {
    await clicar("Cancelar");
    await abrirNovoBannerPelaBarra();
    await escolherImagemPropria();
    await clicar("Computador (4:1)");
    await enviar("https://example.com/nova-desktop.webp");
    await clicar("Salvar Banner");
    expect(toast.error).toHaveBeenCalledWith("Falta a imagem do celular");
    expect(h.update).not.toHaveBeenCalled();
  });
  it("enviar computador salva somente desktopImageUrl", async () => {
    await clicar("Computador (4:1)");
    await enviar("https://example.com/nova-desktop.webp");
    await clicar("Salvar Banner");
    expect(h.update).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        desktopImageUrl: "https://example.com/nova-desktop.webp",
      }),
    );
    expect(h.update.mock.calls[0][1]).not.toHaveProperty("imageUrl");
  });
  it("enviar celular preserva computador", async () => {
    await enviar("https://example.com/nova-celular.webp");
    await clicar("Salvar Banner");
    expect(h.update).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        imageUrl: "https://example.com/nova-celular.webp",
      }),
    );
    expect(h.update.mock.calls[0][1]).not.toHaveProperty("desktopImageUrl");
  });
  it("recortar computador abre só proporção 4:1 e grava no computador", async () => {
    await clicar("Computador (4:1)");
    await clicar("Ajustar");
    expect(h.recorte.imageUrl).toBe(computador);
    expect(h.recorte.allowedPresets).toEqual(["4:1"]);
    expect(h.recorte.defaultPreset).toBe("4:1");
    h.upload.mockResolvedValueOnce("https://example.com/recorte-desktop.webp");
    await clicar("Confirmar recorte de teste");
    await clicar("Salvar Banner");
    expect(h.update.mock.calls[0][1]).toMatchObject({
      desktopImageUrl: "https://example.com/recorte-desktop.webp",
    });
    expect(h.update.mock.calls[0][1]).not.toHaveProperty("imageUrl");
  });
  it("callback do recorte fechado não pode gravar na versão aberta depois", async () => {
    await clicar("Computador (4:1)");
    await clicar("Ajustar");
    const antigo = h.recorte;
    await act(async () => antigo.onClose());
    await clicar("Celular (2:1)");
    await clicar("Ajustar");
    h.upload.mockResolvedValueOnce("https://example.com/recorte-antigo.webp");
    await act(async () =>
      antigo.onConfirm(new Blob(["corte"], { type: "image/webp" })),
    );
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.recorte.imageUrl).toBe(celular);
  });
  it("callback anterior ao blob não atravessa abertura de outro editor", async () => {
    await clicar("Computador (4:1)");
    await clicar("Ajustar");
    const antigo = h.recorte;
    await act(async () => antigo.onClose());
    await clicar("Cancelar");
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar Banner"], button[title="Editar"]',
    )!;
    await act(async () => editar.click());
    h.upload.mockResolvedValueOnce(
      "https://example.com/recorte-outro-editor.webp",
    );
    await act(async () =>
      antigo.onConfirm(new Blob(["corte"], { type: "image/webp" })),
    );
    expect(h.upload).not.toHaveBeenCalled();
    expect(
      document.querySelector('img[alt="Banner Preview"]')?.getAttribute("src"),
    ).toBe(celular);
  });
  it("cancelar apaga os dois uploads novos, nunca os arquivos publicados", async () => {
    await enviar("https://example.com/nova-celular.webp");
    await clicar("Computador (4:1)");
    await enviar("https://example.com/nova-desktop.webp");
    await clicar("Cancelar");
    expect(h.apagar).toHaveBeenCalledWith(
      "https://example.com/nova-celular.webp",
    );
    expect(h.apagar).toHaveBeenCalledWith(
      "https://example.com/nova-desktop.webp",
    );
    expect(h.apagar).not.toHaveBeenCalledWith(celular);
    expect(h.apagar).not.toHaveBeenCalledWith(computador);
  });
  it("cancelar durante envio de computador descarta o resultado tardio sem alterar nova edição", async () => {
    await clicar("Computador (4:1)");
    let liberar!: (url: string) => void;
    h.upload.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        liberar = resolve;
      }),
    );
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>("#banner-upload")!;
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["foto"], "arte.webp", { type: "image/webp" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(botao("Celular (2:1)").disabled).toBe(true);
    await clicar("Cancelar");
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar Banner"], button[title="Editar"]',
    )!;
    await act(async () => editar.click());
    await act(async () => liberar("https://example.com/tardia-desktop.webp"));
    expect(h.apagar).toHaveBeenCalledWith(
      "https://example.com/tardia-desktop.webp",
    );
    expect(
      document.querySelector('img[alt="Banner Preview"]')?.getAttribute("src"),
    ).toBe(celular);
    await clicar("Computador (4:1)");
    expect(
      document.querySelector('img[alt="Banner Preview"]')?.getAttribute("src"),
    ).toBe(computador);
  });
  it("salvamento sem resposta não apaga nenhum dos dois uploads ao cancelar", async () => {
    await enviar("https://example.com/nova-celular.webp");
    await clicar("Computador (4:1)");
    await enviar("https://example.com/nova-desktop.webp");
    h.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await clicar("Salvar Banner");
    await clicar("Cancelar");
    expect(h.apagar).not.toHaveBeenCalled();
  });
  it("recuperar após salvar sem resposta não transforma imagem possivelmente publicada em órfã", async () => {
    await clicar("Computador (4:1)");
    await enviar("https://example.com/desktop-incerto.webp");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    h.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await clicar("Salvar Banner");
    await clicar("Cancelar");
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar Banner"], button[title="Editar"]',
    )!;
    await act(async () => editar.click());
    await clicar("Recuperar");
    await clicar("Cancelar");
    expect(h.apagar).not.toHaveBeenCalledWith(
      "https://example.com/desktop-incerto.webp",
    );
  });
  it("só editar computador gera rascunho com a propriedade do arquivo de computador", async () => {
    await clicar("Computador (4:1)");
    await enviar("https://example.com/desktop-rascunho.webp");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    const raw = localStorage.getItem("admin_banner_form_draft:teste");
    expect(raw).toBeTruthy();
    const draft = JSON.parse(raw!);
    expect(draft.formData).toMatchObject({
      imageUrl: celular,
      desktopImageUrl: "https://example.com/desktop-rascunho.webp",
    });
    expect(draft.imagemDesktopEnviadaNaoSalva).toBe(
      "https://example.com/desktop-rascunho.webp",
    );
  });
  it("remover versão de computador avisa que ficará oculto no PC e preserva celular", async () => {
    await clicar("Computador (4:1)");
    await clicar("Remover versão de computador");
    expect(document.body.textContent).toContain(
      "Este banner não aparece no computador",
    );
    await clicar("Salvar Banner");
    expect(h.update.mock.calls[0][1]).toMatchObject({ desktopImageUrl: null });
    expect(h.update.mock.calls[0][1]).not.toHaveProperty("imageUrl");
    expect(h.apagar).not.toHaveBeenCalledWith(computador);
  });
});
