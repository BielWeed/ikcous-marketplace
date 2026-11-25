// @vitest-environment jsdom
//
// Prova do salvar de um banner JÁ EXISTENTE com o fim no passado: a pergunta
// "Este banner já terminou... Salvar mesmo assim?" só sai quando a lojista
// MEXEU na data do fim (`fimMudou`). O teste vizinho só prova o lado "não mexeu,
// não pergunta de novo"; sem os casos abaixo, trocar o `fimMudou` por `false`
// deixava a lojista gravar, sem pergunta nenhuma, um banner que nunca vai
// aparecer (a edição de datas era o único caminho sem a trava).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { abrirMaisOpcoes, configurarTextos } from "./helpers/editor-de-banner";

const h = vi.hoisted(() => ({
  banners: [] as Record<string, unknown>[],
  toastError: vi.fn(),
  updateBanner: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner: h.updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile: vi.fn(),
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
    error: h.toastError,
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const dia = 24 * 60 * 60 * 1000;
const PERGUNTA =
  "Este banner já terminou e não vai aparecer. Salvar mesmo assim?";

function botaoComTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function emCampoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const textoDaTela = () => document.body.textContent ?? "";

describe("AdminBannersView: editar um banner existente, a pergunta do fim vencido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let agora = 0;

  // A primeira importação da tela é pesada: faz-se uma vez, fora do prazo de
  // cada teste, para a carga da máquina não derrubar o primeiro.
  beforeAll(async () => {
    await import("@/views/admin/AdminBannersView");
  }, 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
    h.updateBanner.mockResolvedValue(undefined);
    agora = Date.now();
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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

  function umBanner(extra: Record<string, unknown>) {
    h.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha de teste",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
        ...extra,
      },
    ];
  }

  async function abrirEdicaoNoPasso3() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    expect(editar).not.toBeNull();
    await act(async () => {
      editar?.click();
      await esperar();
    });
    await configurarTextos(true);
    await abrirMaisOpcoes();
  }

  async function ligarProgramacaoSeFaltar() {
    if (document.getElementById("banner-end-date")) return;
    const chave = document.getElementById("banner-scheduling-toggle");
    expect(chave).not.toBeNull();
    await act(async () => {
      chave?.click();
    });
  }

  async function trocarOFim(fim: Date, inicio?: Date) {
    await act(async () => {
      if (inicio) {
        digitar(
          document.getElementById("banner-start-date") as HTMLInputElement,
          emCampoLocal(inicio),
        );
      }
      digitar(
        document.getElementById("banner-end-date") as HTMLInputElement,
        emCampoLocal(fim),
      );
    });
  }

  async function salvar() {
    await act(async () => {
      botaoComTexto("Salvar Alterações")?.click();
      await esperar();
      await esperar();
    });
  }

  it("fim que estava no futuro e a lojista passou para o passado: pergunta e só grava depois do 'Salvar mesmo assim'", async () => {
    umBanner({
      startDate: new Date(agora - 9 * dia).toISOString(),
      endDate: new Date(agora + 5 * dia).toISOString(),
    });
    await abrirEdicaoNoPasso3();
    await ligarProgramacaoSeFaltar();
    await trocarOFim(new Date(agora - 2 * dia));
    await salvar();

    expect(textoDaTela()).toContain(PERGUNTA);
    expect(h.updateBanner).not.toHaveBeenCalled();

    await act(async () => {
      botaoComTexto("Salvar mesmo assim")?.click();
      await esperar();
      await esperar();
    });
    expect(h.updateBanner).toHaveBeenCalledTimes(1);
    expect(h.updateBanner.mock.calls[0]?.[0]).toBe("banner-1");
    expect(h.updateBanner.mock.calls[0]?.[1]).toHaveProperty("endDate");
  });

  it("banner que já estava vencido e a lojista mudou o fim para OUTRA data vencida: pergunta de novo", async () => {
    umBanner({
      startDate: new Date(agora - 20 * dia).toISOString(),
      endDate: new Date(agora - 2 * dia).toISOString(),
    });
    await abrirEdicaoNoPasso3();
    await ligarProgramacaoSeFaltar();
    await trocarOFim(new Date(agora - 4 * dia));
    await salvar();

    expect(textoDaTela()).toContain(PERGUNTA);
    expect(h.updateBanner).not.toHaveBeenCalled();
  });

  it("banner sem fim nenhum e a lojista põe um fim no passado: pergunta", async () => {
    umBanner({ startDate: null, endDate: null });
    await abrirEdicaoNoPasso3();
    await ligarProgramacaoSeFaltar();
    // ligar a programação já preenche início e fim (agora e +24h): o início
    // vai para antes do fim vencido, senão o caso seria "fim antes do início".
    await trocarOFim(new Date(agora - 3 * dia), new Date(agora - 9 * dia));
    await salvar();

    expect(textoDaTela()).toContain(PERGUNTA);
    expect(h.updateBanner).not.toHaveBeenCalled();
  });

  it("fim que a lojista mudou para o futuro não pergunta nada e grava", async () => {
    umBanner({
      startDate: new Date(agora - 20 * dia).toISOString(),
      endDate: new Date(agora - 2 * dia).toISOString(),
    });
    await abrirEdicaoNoPasso3();
    await ligarProgramacaoSeFaltar();
    await trocarOFim(new Date(agora + 3 * dia));
    await salvar();

    expect(textoDaTela()).not.toContain(PERGUNTA);
    expect(h.updateBanner).toHaveBeenCalledTimes(1);
  });
});
