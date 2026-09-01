// @vitest-environment jsdom
//
// A-11 do laudo da varredura profunda (equipe/entregas/
// laudo-varredura-profunda-molde-0109.md): `handleSubmit` gravava
// `isSavedRef.current = true` ANTES do `await addBanner/updateBanner`.
// Quando o salvar falhava (rede, RLS, qualquer erro), a bandeira já tinha
// subido: o lojista via o toast vermelho, fechava o diálogo e a limpeza de
// upload órfão em `handleOpenChange(false)` era pulada — a imagem que subiu
// ficava para sempre no bucket, sem banner nenhum apontando para ela.
//
// Duas provas, os dois caminhos que a bandeira decide:
//
// 1. Salvar que FALHA não pode marcar a sessão como salva: fechar o
//    diálogo depois tem que apagar o upload que não virou banner (órfão) —
//    e é isso que impede o vazamento de espaço.
// 2. Salvar com SUCESSO marca como salva: a imagem passa a ser referenciada
//    pelo banner gravado e NÃO pode ser apagada por caminho nenhum.
//
// Mesmo padrão de montagem de admin-banners-duplicar-removido-nao-apaga-
// imagem-alheia.test.tsx: view real, React puro (createRoot + act), sem
// @testing-library. Diferença necessária: aqui o painel precisa estar
// ONLINE (useOnlineStatus -> true), porque o handleSubmit recusa salvar
// offline antes de chegar no hook.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

const urlNova =
  "https://proj.supabase.co/storage/v1/object/public/banners/upload-orfao.jpg";

// O botão "Novo Banner" só renderiza com a lista populada
// (AdminBannersView: `isLoaded && banners.length > 0`), então a montagem
// precisa de um banner existente mesmo com os cenários sendo de CRIAR.
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
  // o hook devolve "isOffline": false = online. Offline o handleSubmit
  // recusa salvar e o botão Novo Banner nasce disabled.
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

describe("AdminBannersView — salvar que falha não deixa upload órfão no bucket", () => {
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

  /** Abre o diálogo de novo banner e sobe uma imagem (formData.imageUrl
   * passa a apontar para um upload que nenhum banner gravado referencia). */
  async function abrirDialogoESubirImagem() {
    uploadBannerImage.mockResolvedValue(urlNova);

    const botaoNovoBanner = localizarBotaoPorTexto(hospedeiro, "Novo Banner")!;
    expect(botaoNovoBanner).toBeDefined();

    await act(async () => {
      botaoNovoBanner.click();
    });

    // Diálogo aberto (botão "Salvar Banner" só existe dentro dele) e em
    // modo de criação.
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();

    const arquivo = new File(["conteudo"], "upload-orfao.jpg", {
      type: "image/jpeg",
    });
    await act(async () => {
      selecionarArquivo("banner-upload", arquivo);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);
  }

  it("salvar que FALHA não marca como salvo: fechar o diálogo apaga o upload órfão", async () => {
    await montar();
    await abrirDialogoESubirImagem();

    addBanner.mockRejectedValue(new Error("falha de rede simulada"));

    const botaoSalvar = localizarBotaoPorTexto(hospedeiro, "Salvar Banner")!;
    expect(botaoSalvar).toBeDefined();

    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    // A prova morde o caminho certo: a recusa chegou ao hook (se uma
    // regressão derrubasse o submit antes, este teste deixaria de morder).
    expect(addBanner).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalled();

    const botaoCancelar = localizarBotaoPorTexto(hospedeiro, "Cancelar")!;
    expect(botaoCancelar).toBeDefined();
    await act(async () => {
      botaoCancelar.click();
    });

    // Critério de aceite (o vazamento): a imagem subiu, o salvar falhou,
    // nenhum banner a referencia — fechar o formulário tem que apagá-la.
    expect(deleteStorageFile).toHaveBeenCalledTimes(1);
    expect(deleteStorageFile).toHaveBeenCalledWith(urlNova);
  });

  it("salvar com SUCESSO marca como salvo: a imagem gravada não é apagada", async () => {
    await montar();
    await abrirDialogoESubirImagem();

    addBanner.mockResolvedValue(undefined);

    const botaoSalvar = localizarBotaoPorTexto(hospedeiro, "Salvar Banner")!;
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    // O salvar resolveu: a URL virou a imageUrl de um banner gravado.
    // Apagá-la destruiria um banner publicado.
    expect(addBanner).toHaveBeenCalledTimes(1);
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });

  it("fechar por Escape no meio da gravação não apaga a imagem que o salvar em voo pode referenciar", async () => {
    await montar();
    await abrirDialogoESubirImagem();

    // Salvar que só resolve quando o teste mandar — a janela "em voo".
    let resolverSalvar!: () => void;
    addBanner.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverSalvar = resolve;
        }),
    );

    const botaoSalvar = localizarBotaoPorTexto(hospedeiro, "Salvar Banner")!;
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });
    expect(addBanner).toHaveBeenCalledTimes(1);

    // Escape no meio da gravação. É o caminho da closure antiga (o listener
    // de keydown capturou handleOpenChange num render anterior) — por isso
    // o bloqueio tem que viver em ref, não em estado. Se a guarda falhar,
    // o delete roda e a gravação, ao resolver, publica banner com arquivo
    // recém-apagado.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperarMicrotarefas();
    });
    expect(deleteStorageFile).not.toHaveBeenCalled();

    // A gravação resolve depois: o diálogo se fecha sozinho e a imagem
    // continua viva, agora referenciada pelo banner gravado.
    await act(async () => {
      resolverSalvar();
      await esperarMicrotarefas();
    });
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
});
