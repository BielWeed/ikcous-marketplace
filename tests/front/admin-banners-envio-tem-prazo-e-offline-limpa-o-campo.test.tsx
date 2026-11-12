// @vitest-environment jsdom
//
// Envio da imagem do banner (painel):
//  1. Sem prazo, em rede ruim o aviso "Enviando..." girava para sempre e o
//     campo ficava preso. Agora o envio (e o recorte) têm 90 s, como na tela de
//     produtos; passado o prazo a lojista lê "Demorou demais, tente de novo" e,
//     se o arquivo chegar ao armazenamento depois, ele é apagado.
//  2. Uma imagem que o aparelho não abre vinha como "enviada com sucesso".
//     Agora o envio recusa com a frase "Não conseguimos abrir a foto".
//  3. Sem internet, o campo de arquivo guardava a escolha: ao voltar a conexão,
//     escolher a MESMA foto não disparava nada. O campo é esvaziado antes de
//     qualquer retorno antecipado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  offline: false,
  escolherImagem: null as ((file: File) => void) | null,
}));
vi.mock(
  "@/components/admin/banners/CriarBannerComIa",
  async (importarOriginal) => {
    const original =
      await importarOriginal<
        typeof import("@/components/admin/banners/CriarBannerComIa")
      >();
    return {
      CriarBannerComIa: (
        props: Parameters<typeof original.CriarBannerComIa>[0],
      ) => {
        estado.escolherImagem = props.aoEscolherImagem;
        return <original.CriarBannerComIa {...props} />;
      },
    };
  },
);
const uploadBannerImage = vi.fn<(file: File) => Promise<string>>();
const deleteStorageFile = vi.fn<(url: string) => Promise<void>>();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const banner = {
  id: "banner-a",
  title: "",
  imageUrl: "https://loja.test/publicada.webp",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [banner],
    isLoaded: true,
    uploadBannerImage,
    deleteStorageFile,
    updateBanner: vi.fn(),
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    dismiss: vi.fn(),
    loading: vi.fn(() => "toast-upload"),
  },
}));
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: (props: {
    onConfirm: (blob: Blob) => Promise<void>;
    isSubmitting: boolean;
  }) => (
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
  ),
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });

const PRAZO_MS = 90_000;

describe("AdminBannersView — envio da imagem: prazo, foto ilegível e campo limpo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.offline = false;
    uploadBannerImage.mockReset();
    deleteStorageFile.mockReset().mockResolvedValue(undefined);
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
    vi.useRealTimers();
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView active={true} onNavigate={vi.fn()} />);
    });
    const editar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    if (!editar) throw new Error("Botão Editar ausente");
    await act(async () => editar.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  // A conexão cai ou volta: a tela é redesenhada com o novo estado.
  async function refazerATela(offline: boolean) {
    estado.offline = offline;
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView active={true} onNavigate={vi.fn()} />);
    });
  }

  function input() {
    const campo =
      hospedeiro.querySelector<HTMLInputElement>('input[type="file"]');
    if (!campo) throw new Error("Upload ausente");
    return campo;
  }

  const arquivo = new File(["imagem"], "banner.webp", { type: "image/webp" });

  function selecionar(campo = input()) {
    Object.defineProperty(campo, "files", {
      value: [arquivo],
      configurable: true,
    });
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function imagem() {
    return hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"], img[alt="Banner Preview"]',
    )?.src;
  }

  /** Só `setTimeout`/`clearTimeout` falsos: o resto (microtarefas) segue. */
  const relogioFalso = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("a imagem pronta da IA avisa quando a internet cai, sem enviar em silêncio", async () => {
    const { abrirNovoBannerPelaBarra } = await import(
      "./helpers/editor-de-banner"
    );
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      raiz.render(<AdminBannersView active={true} onNavigate={vi.fn()} />),
    );
    await abrirNovoBannerPelaBarra();
    const criar = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Criar com IA"),
    );
    expect(criar).toBeTruthy();
    await act(async () => criar!.click());
    await refazerATela(true);
    const campo = document.querySelector<HTMLInputElement>(
      'input[aria-label="Escolher imagem pronta"]',
    )!;
    expect(campo).toBeTruthy();
    await act(async () => selecionar(campo));
    expect(uploadBannerImage).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Sem conexão com a internet",
      expect.anything(),
    );
  });

  it("a segunda escolha pela IA durante um envio avisa para esperar, sem duplicar", async () => {
    const { abrirNovoBannerPelaBarra } = await import(
      "./helpers/editor-de-banner"
    );
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      raiz.render(<AdminBannersView active={true} onNavigate={vi.fn()} />),
    );
    await abrirNovoBannerPelaBarra();
    const criar = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Criar com IA"),
    )!;
    await act(async () => criar.click());
    const escolher = estado.escolherImagem!;
    let terminar!: (url: string) => void;
    uploadBannerImage.mockReturnValueOnce(
      new Promise((resolve) => {
        terminar = resolve;
      }),
    );
    await act(async () => {
      escolher(arquivo);
      escolher(arquivo);
    });
    expect(uploadBannerImage).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Aguarde o envio ou salvamento atual terminar e escolha a imagem de novo.",
    );
    await act(async () => terminar("https://loja.test/nova.webp"));
  });

  it("sem internet: o campo é esvaziado e, de volta online, a MESMA foto dispara o envio", async () => {
    await abrir();
    const campo = input();
    // jsdom não tem seletor de arquivos. O dublê guarda o caminho e, como o
    // navegador, não emite `change` ao repetir uma escolha que não foi limpa.
    Object.defineProperty(campo, "value", {
      value: "",
      writable: true,
      configurable: true,
    });
    const caminho = "C:\\fakepath\\banner.webp";
    const escolherMesmoArquivo = () => {
      if (campo.value === caminho) return;
      campo.value = caminho;
      selecionar(campo);
    };

    await refazerATela(true);
    await act(async () => escolherMesmoArquivo());
    expect(uploadBannerImage).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/Sem conexão/);
    expect(campo.value).toBe("");

    // A conexão volta (a tela é redesenhada) e a lojista escolhe a mesma foto.
    await refazerATela(false);
    uploadBannerImage.mockResolvedValueOnce("https://loja.test/novo.webp");
    await act(async () => escolherMesmoArquivo());

    expect(uploadBannerImage).toHaveBeenCalledTimes(1);
    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);
  });

  it("o envio que nunca responde estoura em 90 s: avisa 'Demorou demais', libera o campo e apaga o arquivo que chegar depois", async () => {
    await abrir();
    let chegar!: (url: string) => void;
    uploadBannerImage.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        chegar = resolve;
      }),
    );
    relogioFalso();

    await act(async () => selecionar());
    expect(uploadBannerImage).toHaveBeenCalledTimes(1);
    expect(input().disabled).toBe(true);

    await avancar(PRAZO_MS + 1);
    expect(toastError).toHaveBeenCalledWith(
      "Demorou demais, tente de novo",
      expect.objectContaining({ id: "toast-upload" }),
    );
    expect(input().disabled).toBe(false);
    expect(imagem()).toBe(banner.imageUrl);
    expect(deleteStorageFile).not.toHaveBeenCalled();

    // O envio que ninguém cancelou chega depois: o arquivo é apagado.
    await act(async () => {
      chegar("https://loja.test/atrasado.webp");
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(deleteStorageFile).toHaveBeenCalledWith(
      "https://loja.test/atrasado.webp",
    );
    expect(imagem()).toBe(banner.imageUrl);
  });

  it("o recorte que nunca responde também estoura em 90 s e apaga o que chegar depois", async () => {
    await abrir();
    const ajustar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Ajustar",
    );
    if (!ajustar) throw new Error("Botão Ajustar ausente");
    await act(async () => ajustar.click());
    let chegar!: (url: string) => void;
    uploadBannerImage.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        chegar = resolve;
      }),
    );
    relogioFalso();

    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[data-testid="confirmar-recorte"]')
        ?.click();
    });
    await avancar(PRAZO_MS + 1);
    expect(toastError).toHaveBeenCalledWith(
      "Demorou demais, tente de novo",
      expect.objectContaining({ id: "toast-upload" }),
    );

    await act(async () => {
      chegar("https://loja.test/recorte-atrasado.webp");
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(deleteStorageFile).toHaveBeenCalledWith(
      "https://loja.test/recorte-atrasado.webp",
    );
    expect(imagem()).toBe(banner.imageUrl);
  });

  it("imagem que o aparelho não abre: frase clara, sem 'enviada com sucesso' e a imagem do banner não muda", async () => {
    await abrir();
    uploadBannerImage.mockRejectedValueOnce(
      Object.assign(new Error("foto ilegível"), { name: "FotoIlegivel" }),
    );

    await act(async () => selecionar());

    expect(toastError).toHaveBeenCalledWith(
      "Não conseguimos abrir a foto. Salve como JPG ou PNG e tente de novo.",
      { id: "toast-upload" },
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(imagem()).toBe(banner.imageUrl);
  });

  it("controle: envio dentro do prazo continua dando o aviso de sucesso e troca a imagem", async () => {
    await abrir();
    uploadBannerImage.mockResolvedValueOnce("https://loja.test/novo.webp");

    await act(async () => selecionar());

    expect(toastSuccess).toHaveBeenCalledWith("Imagem enviada com sucesso", {
      id: "toast-upload",
    });
    expect(imagem()).toBe("https://loja.test/novo.webp");
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
});
