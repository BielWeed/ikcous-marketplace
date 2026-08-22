// @vitest-environment jsdom
//
// Achado #22-vizinho (tarefa da remoção de "Duplicar" banner): o botão
// "Duplicar" era a ÚNICA porta para um defeito que apagava do Storage a
// imagem de um banner JÁ PUBLICADO na Home.
//
// `handleDuplicateBanner` copiava `banner.imageUrl` (de um banner que já
// existe) para `formData.imageUrl`, mas fazia `setEditingBanner(null)` —
// como se a imagem tivesse acabado de ser enviada por um upload novo. Ao
// fechar o modal sem salvar, `handleOpenChange(false)` compara
// `formData.imageUrl !== editingBanner?.imageUrl`: com `editingBanner` nulo
// a comparação vira `URL !== undefined` → sempre `true` → apaga do Storage a
// imagem do banner ORIGINAL, que continua no ar.
//
// A correção remove o botão inteiro (o Gabriel decidiu que a funcionalidade
// também é inútil). Este arquivo prova os DOIS caminhos que continuam
// existindo depois da remoção — Criar e Editar — porque são eles que
// legitimamente decidem se `deleteStorageFile` roda ao cancelar:
//
// 1. Criar banner novo, subir imagem, cancelar → a imagem RECÉM-ENVIADA é
//    órfã (não pertence a nenhum banner salvo) → deleteStorageFile DEVE
//    rodar.
// 2. Editar banner existente sem trocar a foto, cancelar → a imagem
//    continua sendo a do banner publicado → deleteStorageFile NÃO PODE
//    rodar.
//
// Monta `AdminBannersView` de verdade (sem @testing-library, não instalado
// neste projeto): createRoot + act do React puro, mesmo padrão de
// admin-product-form-draft-e-duplo-clique.test.tsx e
// admin-products-kpi-apos-mexer-no-catalogo.test.tsx (que já resolveram os
// mesmos obstáculos de montar uma view de admin: IntersectionObserver e
// ResizeObserver que o jsdom não implementa, usados por LazyImage e por
// AdminKpiCarousel/embla-carousel-react).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const reorderBanners = vi.fn();
const refreshBanners = vi.fn();
const onNavigate = vi.fn();

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
    deleteBanner,
    deleteStorageFile,
    reorderBanners,
    refreshBanners,
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

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(() => "toast-id"),
  },
}));

// jsdom não implementa IntersectionObserver -- LazyImage (usado pela
// miniatura de cada banner na lista) cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom não implementa ResizeObserver -- embla-carousel-react (usado por
// AdminKpiCarousel, que a view renderiza no topo) cria um a cada montagem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
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

function localizarBotaoPorTitulo(
  raizDom: ParentNode,
  titulo: string,
): HTMLButtonElement | undefined {
  return raizDom.querySelector(
    `button[title="${titulo}"]`,
  ) as HTMLButtonElement | undefined;
}

/** Simula selecionar um arquivo no `<input type="file">` — não dá para usar
 * o setter nativo de `.value` (bloqueado pelo navegador/jsdom para inputs de
 * arquivo), então a `FileList` é sobrescrita diretamente via
 * `Object.defineProperty`, como o próprio React lê `e.target.files`. */
function selecionarArquivo(id: string, arquivo: File) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.defineProperty(el, "files", {
    value: [arquivo],
    configurable: true,
  });
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AdminBannersView — remoção de Duplicar preserva Criar e Editar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // `deleteStorageFile` real (useBanners.ts:98) é assíncrona e o código de
    // produção encadeia `.catch()` no retorno — sem isto o mock devolve
    // `undefined` e `.catch()` de `undefined` derruba o teste com uma
    // exceção não tratada, mascarando o que o teste realmente verifica.
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
    // Mesmo padrão de admin-product-form-draft-e-duplo-clique.test.tsx: um
    // Map de verdade, não o `localStorage` real do jsdom.
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
    const { AdminBannersView } = await import(
      "@/views/admin/AdminBannersView"
    );

    await act(async () => {
      raiz.render(
        <AdminBannersView onNavigate={onNavigate} active={true} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("o botão Duplicar não existe mais no painel", async () => {
    await montar();

    expect(localizarBotaoPorTitulo(hospedeiro, "Duplicar")).toBeNull();
    expect(
      localizarBotaoPorTitulo(hospedeiro, "Duplicar Banner"),
    ).toBeNull();
    expect(localizarBotaoPorTexto(hospedeiro, "Duplicar")).toBeUndefined();
  });

  it("criar banner novo, subir imagem e cancelar apaga a imagem recém-enviada (órfã)", async () => {
    await montar();

    const urlNova =
      "https://proj.supabase.co/storage/v1/object/public/banners/imagem-recem-enviada.jpg";
    uploadBannerImage.mockResolvedValue(urlNova);

    const botaoNovoBanner = localizarBotaoPorTexto(hospedeiro, "Novo Banner")!;
    expect(botaoNovoBanner).toBeDefined();

    await act(async () => {
      botaoNovoBanner.click();
    });

    // Dialog aberto para CRIAR: editingBanner é null, formData.imageUrl
    // começa vazio.
    expect(
      hospedeiro.textContent?.includes("Novo Banner"),
    ).toBe(true);

    const arquivo = new File(["conteudo"], "imagem-recem-enviada.jpg", {
      type: "image/jpeg",
    });

    await act(async () => {
      selecionarArquivo("banner-upload", arquivo);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);

    const botaoCancelar = localizarBotaoPorTexto(hospedeiro, "Cancelar")!;
    expect(botaoCancelar).toBeDefined();

    await act(async () => {
      botaoCancelar.click();
    });

    // Critério de aceite: a imagem que acabou de subir (ainda não pertence
    // a nenhum banner salvo) é órfã depois do cancelamento — apagar é
    // correto.
    expect(deleteStorageFile).toHaveBeenCalledTimes(1);
    expect(deleteStorageFile).toHaveBeenCalledWith(urlNova);
  });

  it("editar banner existente sem trocar a foto e cancelar NÃO apaga a imagem publicada", async () => {
    await montar();

    const botaoEditar = localizarBotaoPorTitulo(hospedeiro, "Editar")!;
    expect(botaoEditar).toBeDefined();

    await act(async () => {
      botaoEditar.click();
    });

    // Dialog aberto para EDITAR: editingBanner === bannerPublicado,
    // formData.imageUrl começa igual à URL do banner.
    expect(hospedeiro.textContent?.includes("Editar Banner")).toBe(true);

    const botaoCancelar = localizarBotaoPorTexto(hospedeiro, "Cancelar")!;
    expect(botaoCancelar).toBeDefined();

    await act(async () => {
      botaoCancelar.click();
    });

    // Critério de aceite (o defeito original): a foto do banner PUBLICADO
    // na Home nunca deveria ser apagada só por abrir e fechar o formulário
    // de edição sem trocar nada.
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
});
