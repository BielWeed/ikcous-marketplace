// @vitest-environment jsdom
//
// Achado AdminBannersView-1120: o listener global de Escape
// (handleKeyDown, useEffect ~1120-1135) testava `isDialogOpen` ANTES de
// `isAdjusterOpen` num if/else-if. `openAdjuster` é chamado de DENTRO do
// próprio diálogo de banner (botão "Ajustar" sobre a imagem recém-
// enviada) — então quando o recorte está aberto, os dois estados
// (`isDialogOpen` e `isAdjusterOpen`) são `true` ao mesmo tempo. Como o
// ramo de `isDialogOpen` vinha primeiro, o Esc rodava `handleOpenChange
// (false)`: para um banner NOVO (`editingBanner` indefinido),
// `formData.imageUrl` sempre difere de `editingBanner?.imageUrl`, então a
// função apaga a imagem recém-enviada do Storage (`deleteStorageFile`),
// zera o rascunho e fecha o diálogo no ESTADO — mas nunca reseta
// `isAdjusterOpen`, então o `ImageAdjuster` (que não tem handler de
// Escape próprio: é um `createPortal` cru, sem Dialog/Escape do Radix)
// continuava visível por cima de um formulário que, no componente, já
// tinha sido fechado e teve o upload apagado.
//
// Correção: inverter a prioridade do if/else-if (isAdjusterOpen antes de
// isDialogOpen) — o Esc fecha só o overlay mais no topo visualmente.
//
// Este arquivo prova, no nível do componente (mesmo padrão de montagem
// de admin-banners-salvo-falho-nao-deixa-upload-orfao.test.tsx: view
// real, React puro via createRoot + act, sem @testing-library):
//
// 1. Com o ImageAdjuster aberto sobre o diálogo, um Escape fecha só o
//    recorte — o diálogo continua aberto ("Salvar Banner" ainda existe).
// 2. Esse mesmo Escape NÃO apaga a imagem recém-enviada do Storage (a
//    perda de dado que o achado descreve) nem limpa o campo de imagem do
//    formulário.
// 3. Um SEGUNDO Escape, agora só com o diálogo aberto (adjuster já
//    fechado), continua fechando o diálogo normalmente — a correção não
//    quebra o comportamento existente do Escape no diálogo puro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

const urlImagemEnviada =
  "https://proj.supabase.co/storage/v1/object/public/banners/imagem-em-ajuste.jpg";

// O botão "Novo Banner" só renderiza com a lista populada
// (AdminBannersView: `isLoaded && banners.length > 0`).
const bannerPublicado = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/banner-publicado-na-home.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [bannerPublicado],
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

const toastError = vi.fn();
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function selecionarArquivo(id: string, arquivo: File) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.defineProperty(el, "files", {
    value: [arquivo],
    configurable: true,
  });
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function apertarEscape() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

// Cabeçalho fixo do ImageAdjuster (src/components/ui/custom/
// ImageAdjuster.tsx) — só existe no DOM enquanto `isOpen` é true, mesmo
// sem a imagem ter terminado de carregar (bandeira `loading` interna não
// afeta esse header).
function adjusterEstaAberto(): boolean {
  return [...document.body.querySelectorAll("h3")].some((h3) =>
    h3.textContent?.includes("Ajustar Imagem"),
  );
}

describe("AdminBannersView — Escape com o ImageAdjuster aberto fecha só o recorte", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");

    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  /** Abre "Novo Banner", sobe uma imagem e clica em "Ajustar" — reproduz
   * exatamente o cenário do achado: recorte aberto POR CIMA do diálogo,
   * os dois com estado `true` ao mesmo tempo. */
  async function abrirDialogoESubirImagemEAjustar() {
    uploadBannerImage.mockResolvedValue(urlImagemEnviada);

    const botaoNovoBanner = localizarBotaoPorTexto(hospedeiro, "Novo Banner")!;
    expect(botaoNovoBanner).toBeDefined();
    await act(async () => {
      botaoNovoBanner.click();
    });
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();

    const arquivo = new File(["conteudo"], "imagem-em-ajuste.jpg", {
      type: "image/jpeg",
    });
    await act(async () => {
      selecionarArquivo("banner-upload", arquivo);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);

    const botaoAjustar = localizarBotaoPorTexto(hospedeiro, "Ajustar")!;
    expect(
      botaoAjustar,
      "botão Ajustar só existe com imageUrl setado",
    ).toBeDefined();
    await act(async () => {
      botaoAjustar.click();
    });

    expect(adjusterEstaAberto()).toBe(true);
  }

  it("Escape com o cropper aberto fecha só o cropper — o diálogo de banner continua aberto", async () => {
    await montar();
    await abrirDialogoESubirImagemEAjustar();

    await act(async () => {
      apertarEscape();
    });

    // O cropper fechou...
    expect(adjusterEstaAberto()).toBe(false);
    // ...mas o diálogo de banner, por trás, continua aberto — é o defeito
    // que este achado descreve: antes da correção, esse mesmo Escape
    // rodava handleOpenChange(false) e o botão "Salvar Banner" sumia.
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();
  });

  it("Escape com o cropper aberto NÃO apaga a imagem recém-enviada nem limpa o formulário", async () => {
    await montar();
    await abrirDialogoESubirImagemEAjustar();

    await act(async () => {
      apertarEscape();
    });

    // A perda de dado do achado: handleOpenChange(false) apagaria a
    // imagem nova do Storage (formData.imageUrl difere de
    // editingBanner?.imageUrl para banner novo) e o rascunho de auto-save
    // teria o campo de imagem zerado.
    expect(deleteStorageFile).not.toHaveBeenCalled();

    // formData.imageUrl sobreviveu: a miniatura da imagem enviada e o
    // botão "Ajustar" (só renderizam com formData.imageUrl preenchido)
    // continuam no DOM — se handleOpenChange(false) tivesse rodado, o
    // campo de imagem do formulário teria sido limpo junto com o Storage.
    expect(localizarBotaoPorTexto(hospedeiro, "Ajustar")).toBeDefined();
    const miniatura = hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"]',
    );
    expect(miniatura?.src).toBe(urlImagemEnviada);
  });

  it("um SEGUNDO Escape, agora só com o diálogo aberto, continua fechando o diálogo normalmente", async () => {
    await montar();
    await abrirDialogoESubirImagemEAjustar();

    await act(async () => {
      apertarEscape();
    });
    expect(adjusterEstaAberto()).toBe(false);
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();

    await act(async () => {
      apertarEscape();
    });

    // Agora sim o diálogo fecha — a correção não quebrou o Escape "puro"
    // (só o diálogo aberto, sem cropper por cima).
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeUndefined();
  });
});
