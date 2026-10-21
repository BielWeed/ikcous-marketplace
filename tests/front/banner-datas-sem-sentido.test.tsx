// @vitest-environment jsdom
//
// Datas sem sentido salvavam sem aviso no painel de banners:
//   - o fim ANTES do início só mostrava um aviso, e o botão salvava mesmo
//     assim (o banner nunca aparece);
//   - banner com o fim JÁ VENCIDO também salvava sem pergunta — a lojista só
//     descobria quando o banner "não aparecia";
//   - ligar "Programação Temporal" preenche o fim em 24 h sem dizer: quem
//     esquecia de ajustar via o banner sumir no dia seguinte.
//
// Duas camadas: as funções puras (`problemaDasDatas`, `fimDoBannerEmTexto`)
// e a tela real (AdminBannersView) montada como nos testes vizinhos.
import {
  MENSAGEM_FIM_ANTES_DO_INICIO,
  fimDoBannerEmTexto,
  problemaDasDatas,
} from "@/lib/datas-do-banner";
import { act } from "react";
import { flushSync } from "react-dom";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirMaisOpcoes,
  configurarTextos,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";

// Datas de calendário LOCAL: o teste vale em qualquer fuso.
const local = (a: number, m: number, d: number, h = 12, min = 0) =>
  new Date(a, m - 1, d, h, min).toISOString();
const AGORA = new Date(2026, 9, 14, 12, 0); // 14/10/2026 12:00

describe("problemaDasDatas", () => {
  it.each([
    ["sem datas", null, null, null],
    ["só início", local(2026, 10, 20), null, null],
    [
      "fim depois do início, no futuro",
      local(2026, 10, 15),
      local(2026, 10, 16),
      null,
    ],
    ["só fim, no futuro", null, local(2026, 10, 16), null],
    [
      "fim antes do início",
      local(2026, 10, 20),
      local(2026, 10, 18),
      "fim-antes-do-inicio",
    ],
    [
      "fim igual ao início",
      local(2026, 10, 20),
      local(2026, 10, 20),
      "fim-antes-do-inicio",
    ],
    [
      "fim já passou (início antes)",
      local(2026, 10, 1),
      local(2026, 10, 10),
      "fim-ja-passou",
    ],
    ["só fim, já passou", null, local(2026, 10, 10), "fim-ja-passou"],
    [
      "fim 1 minuto no passado",
      null,
      local(2026, 10, 14, 11, 59),
      "fim-ja-passou",
    ],
    ["fim daqui a 1 minuto", null, local(2026, 10, 14, 12, 1), null],
    ["fim ilegível", null, "isto-nao-e-data", null],
  ])("%s", (_nome, inicio, fim, esperado) => {
    expect(problemaDasDatas(inicio, fim, AGORA)).toBe(esperado);
  });

  it("fim antes do início vence 'já passou' (o bloqueio é o mais grave)", () => {
    expect(
      problemaDasDatas(local(2026, 10, 5), local(2026, 10, 3), AGORA),
    ).toBe("fim-antes-do-inicio");
  });
});

describe("fimDoBannerEmTexto", () => {
  it.each([
    ["hoje", local(2026, 10, 14, 18, 5), "Termina hoje às 18:05."],
    ["amanhã", local(2026, 10, 15, 9, 30), "Termina amanhã às 09:30."],
    ["amanhã, 23:59", local(2026, 10, 15, 23, 59), "Termina amanhã às 23:59."],
    [
      "depois de amanhã",
      local(2026, 10, 16, 9, 30),
      "Termina em 16/10 às 09:30.",
    ],
    ["outro ano", local(2027, 1, 2, 8, 0), "Termina em 02/01/2027 às 08:00."],
    [
      "já passou",
      local(2026, 10, 10, 14, 30),
      "Já terminou em 10/10 às 14:30.",
    ],
    ["vazio", null, ""],
    ["ilegível", "xx", ""],
  ])("%s", (_nome, fim, esperado) => {
    expect(fimDoBannerEmTexto(fim, AGORA)).toBe(esperado);
  });
});

// ---------------------------------------------------------------------------
// A tela real.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  banners: [] as Record<string, unknown>[],
  toastError: vi.fn(),
  deleteStorageFile: vi.fn(),
  offline: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

const addBanner = vi.fn();
const updateBanner = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile: h.deleteStorageFile,
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
  useOnlineStatus: () => h.offline,
}));
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

function botaoComTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
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

describe("AdminBannersView: datas sem sentido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.offline = false;
    h.deleteStorageFile.mockResolvedValue(undefined);
    // O botão "Novo Banner" só aparece com a lista populada.
    h.banners = [
      {
        id: "banner-existente-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    addBanner.mockResolvedValue(undefined);
    updateBanner.mockResolvedValue(undefined);
    uploadBannerImage.mockResolvedValue(
      "https://proj.supabase.co/storage/v1/object/public/banners/nova.jpg",
    );
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

  async function montarPainel() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  /** Passa para o passo 3 (Destino), onde mora a "Programação Temporal". */
  async function irParaOPasso3() {
    await configurarTextos(true);
    await abrirMaisOpcoes();
  }

  /** "Novo Banner" com imagem enviada, já no passo 3. */
  async function abrirBannerNovoNoPasso3() {
    await montarPainel();
    await act(async () => {
      botaoComTexto(hospedeiro, "Novo Banner")?.click();
    });
    await escolherImagemPropria();
    const entrada = document.getElementById(
      "banner-upload",
    ) as HTMLInputElement;
    Object.defineProperty(entrada, "files", {
      value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
      await esperar();
    });
    await irParaOPasso3();
  }

  async function ligarProgramacao() {
    const chave = document.getElementById("banner-scheduling-toggle");
    expect(chave, "a chave da programação tem de estar na tela").not.toBeNull();
    await act(async () => {
      chave?.click();
    });
  }

  async function escolherDatas(inicio: Date, fim: Date) {
    await act(async () => {
      digitar(
        document.getElementById("banner-start-date") as HTMLInputElement,
        emCampoLocal(inicio),
      );
      digitar(
        document.getElementById("banner-end-date") as HTMLInputElement,
        emCampoLocal(fim),
      );
    });
  }

  async function salvar() {
    await act(async () => {
      botaoComTexto(document.body, "Salvar Alterações")?.click();
      await esperar();
      await esperar();
    });
  }

  it("ligar a programação MOSTRA que o fim ficou para amanhã, com a hora", async () => {
    await abrirBannerNovoNoPasso3();
    expect(textoDaTela()).not.toMatch(/Termina amanhã/);
    await ligarProgramacao();
    expect(textoDaTela()).toMatch(/Termina amanhã às \d{2}:\d{2}\./);
  });

  it("fim antes do início: mostra o motivo no campo e NÃO salva", async () => {
    await abrirBannerNovoNoPasso3();
    await ligarProgramacao();
    const agora = Date.now();
    await escolherDatas(new Date(agora + 5 * dia), new Date(agora + 3 * dia));

    expect(textoDaTela()).toContain(MENSAGEM_FIM_ANTES_DO_INICIO);
    await salvar();

    expect(addBanner).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(MENSAGEM_FIM_ANTES_DO_INICIO);
    // o formulário continua aberto para a lojista corrigir
    expect(botaoComTexto(document.body, "Salvar Alterações")).toBeDefined();
  });

  it("fim já vencido: pergunta antes; 'Voltar e ajustar' não salva", async () => {
    await abrirBannerNovoNoPasso3();
    await ligarProgramacao();
    const agora = Date.now();
    await escolherDatas(new Date(agora - 5 * dia), new Date(agora - 2 * dia));

    await salvar();

    expect(textoDaTela()).toContain(
      "Este banner já terminou e não vai aparecer. Salvar mesmo assim?",
    );
    expect(addBanner).not.toHaveBeenCalled();

    await act(async () => {
      botaoComTexto(document.body, "Voltar e ajustar")?.click();
      await esperar(50);
    });
    expect(addBanner).not.toHaveBeenCalled();
    expect(textoDaTela()).not.toContain("Salvar mesmo assim?");
  });

  it("fim já vencido: 'Salvar mesmo assim' salva uma vez só", async () => {
    await abrirBannerNovoNoPasso3();
    await ligarProgramacao();
    const agora = Date.now();
    await escolherDatas(new Date(agora - 5 * dia), new Date(agora - 2 * dia));
    await salvar();

    await act(async () => {
      botaoComTexto(document.body, "Salvar mesmo assim")?.click();
      await esperar();
      await esperar();
    });

    expect(addBanner).toHaveBeenCalledTimes(1);
  });

  it("datas boas (fim no futuro) salvam direto, sem pergunta nem aviso", async () => {
    await abrirBannerNovoNoPasso3();
    await ligarProgramacao();
    const agora = Date.now();
    await escolherDatas(new Date(agora + dia), new Date(agora + 3 * dia));
    await salvar();

    expect(addBanner).toHaveBeenCalledTimes(1);
    expect(textoDaTela()).not.toContain("Salvar mesmo assim?");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("sem programação nenhuma: salva direto, como sempre", async () => {
    await abrirBannerNovoNoPasso3();
    await salvar();
    expect(addBanner).toHaveBeenCalledTimes(1);
  });

  it("editar banner que JÁ estava vencido sem mexer nas datas não pergunta de novo", async () => {
    const agora = Date.now();
    h.banners = [
      {
        id: "velho-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/velho.jpg",
        title: "Campanha antiga",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
        startDate: new Date(agora - 9 * dia).toISOString(),
        endDate: new Date(agora - 2 * dia).toISOString(),
      },
    ];
    await montarPainel();
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    expect(editar, "botão Editar do cartão do banner").not.toBeNull();
    await act(async () => {
      editar?.click();
      await esperar();
    });
    await irParaOPasso3();
    await salvar();

    expect(textoDaTela()).not.toContain("Salvar mesmo assim?");
    expect(updateBanner).toHaveBeenCalledTimes(1);
  });

  async function abrirConfirmacaoDeFimVencido() {
    await abrirBannerNovoNoPasso3();
    await ligarProgramacao();
    const agora = Date.now();
    await escolherDatas(new Date(agora - 5 * dia), new Date(agora - 2 * dia));
    await salvar();
    expect(textoDaTela()).toContain("Salvar mesmo assim?");
  }

  it("Esc com a pergunta 'já terminou' aberta fecha SÓ a pergunta: o formulário e a foto ficam", async () => {
    await abrirConfirmacaoDeFimVencido();

    await act(async () => {
      globalThis.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(50);
    });

    expect(textoDaTela()).not.toContain("Salvar mesmo assim?");
    // o formulário continua aberto, com o que a lojista já fez
    expect(botaoComTexto(document.body, "Salvar Alterações")).toBeDefined();
    // e a foto recém-enviada NÃO foi apagada do Storage
    expect(h.deleteStorageFile).not.toHaveBeenCalled();
    expect(addBanner).not.toHaveBeenCalled();
  });

  it("Esc de verdade (passa pelo Radix, que já fechou a pergunta e cancelou o evento) não fecha também o formulário", async () => {
    await abrirConfirmacaoDeFimVencido();
    // Num navegador real há uma tarefa de microtarefas entre um ouvinte e
    // outro do mesmo evento, e o React já terminou de fechar a pergunta
    // quando o ouvinte da janela roda. O jsdom não faz isso sozinho.
    const terminarDeRenderizar = () => flushSync(() => {});
    document.addEventListener("keydown", terminarDeRenderizar);

    try {
      await act(async () => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await esperar(50);
      });
    } finally {
      document.removeEventListener("keydown", terminarDeRenderizar);
    }

    expect(textoDaTela()).not.toContain("Salvar mesmo assim?");
    expect(botaoComTexto(document.body, "Salvar Alterações")).toBeDefined();
    expect(h.deleteStorageFile).not.toHaveBeenCalled();
  });

  it("um SEGUNDO Esc (pergunta já fechada) continua fechando o formulário", async () => {
    await abrirConfirmacaoDeFimVencido();
    const apertarEsc = () =>
      act(async () => {
        globalThis.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await esperar(50);
      });
    await apertarEsc();
    await apertarEsc();
    expect(botaoComTexto(document.body, "Salvar Alterações")).toBeUndefined();
  });

  it("a confirmação não 'sobra': se 'Salvar mesmo assim' não salvou (ficou offline), a próxima vez pergunta de novo", async () => {
    await abrirConfirmacaoDeFimVencido();
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    const renderizar = () =>
      act(async () => {
        // função nova a cada chamada: força o re-render do componente memo
        raiz.render(
          <AdminBannersView
            onNavigate={(...a: Parameters<typeof onNavigate>) =>
              onNavigate(...a)
            }
            active={true}
          />,
        );
      });

    // a internet cai com a pergunta aberta; "Salvar mesmo assim" não salva
    h.offline = true;
    await renderizar();
    await act(async () => {
      botaoComTexto(document.body, "Salvar mesmo assim")?.click();
      await esperar(50);
    });
    expect(addBanner).not.toHaveBeenCalled();

    // volta a internet; salvar de novo tem de PERGUNTAR outra vez
    h.offline = false;
    await renderizar();
    await salvar();
    expect(textoDaTela()).toContain("Salvar mesmo assim?");
    expect(addBanner).not.toHaveBeenCalled();
  });
});
