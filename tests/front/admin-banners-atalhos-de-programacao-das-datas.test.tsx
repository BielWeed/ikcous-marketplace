// @vitest-environment jsdom
//
// Os quatro atalhos de "Programar datas" do painel de banners ("Próximas 24h",
// "Fim de Semana", "7 Dias", "30 Dias") preenchem início e fim sozinhos. Se a
// conta errar um dia, a lojista agenda a promoção do fim de semana para a
// sexta ou deixa o banner sair do ar no sábado, e só descobre quando o banner
// "não aparece". Este teste clica nos botões da tela real, salva, e confere as
// datas que CHEGAM ao `addBanner`.
//
// Relógio: só o `Date` é falso (os temporizadores do React e do teste seguem
// reais). Datas de calendário LOCAL, como o vizinho `banner-datas-sem-sentido`:
// o teste vale em qualquer fuso, sem fixar `TZ`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirMaisOpcoes,
  abrirNovoBannerPelaBarra,
  configurarTextos,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";

const h = vi.hoisted(() => ({
  banners: [] as Record<string, unknown>[],
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
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const DIAS = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

function botaoComTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

// Data/hora no calendário LOCAL (mês de 1 a 12).
const local = (
  a: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
  s = 0,
  ms = 0,
) => new Date(a, m - 1, d, h, min, s, ms);

type Caso = {
  nome: string;
  /** Dia da semana esperado de `agora` (0 = domingo): trava o dado do teste. */
  diaDaSemana: number;
  agora: Date;
  botao: string;
  inicio: Date;
  fim: Date;
};

const FIM_DE_SEMANA = "Fim de Semana";

// Quarta 11/11/2026, 15:30:20.123: o "agora" dos casos que não dependem do dia.
const QUARTA = local(2026, 11, 11, 15, 30, 20, 123);

const casos: Caso[] = [
  // --- Fim de Semana, de segunda a sexta: sábado 00:00 a domingo 23:59:59 ---
  {
    nome: "segunda 09/11 -> sábado 14/11 00:00 a domingo 15/11 23:59:59",
    diaDaSemana: 1,
    agora: local(2026, 11, 9, 8, 5, 10),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 11, 14, 0, 0, 0),
    fim: local(2026, 11, 15, 23, 59, 59),
  },
  {
    nome: "quarta 11/11 -> sábado 14/11 00:00 a domingo 15/11 23:59:59",
    diaDaSemana: 3,
    agora: QUARTA,
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 11, 14, 0, 0, 0),
    fim: local(2026, 11, 15, 23, 59, 59),
  },
  {
    nome: "sexta 13/11 (23:59) -> sábado 14/11 00:00 a domingo 15/11 23:59:59",
    diaDaSemana: 5,
    agora: local(2026, 11, 13, 23, 59, 0),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 11, 14, 0, 0, 0),
    fim: local(2026, 11, 15, 23, 59, 59),
  },
  // --- virada de mês e de ano ---
  {
    nome: "sexta 30/10 -> sábado 31/10 00:00 a domingo 01/11 23:59:59 (virada de mês)",
    diaDaSemana: 5,
    agora: local(2026, 10, 30, 12, 0, 0),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 10, 31, 0, 0, 0),
    fim: local(2026, 11, 1, 23, 59, 59),
  },
  {
    nome: "sexta 31/07 -> sábado 01/08 00:00 a domingo 02/08 23:59:59 (sexta no dia 31)",
    diaDaSemana: 5,
    agora: local(2026, 7, 31, 18, 0, 0),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 8, 1, 0, 0, 0),
    fim: local(2026, 8, 2, 23, 59, 59),
  },
  {
    nome: "quinta 31/12/2026 -> sábado 02/01/2027 00:00 a domingo 03/01/2027 23:59:59 (virada de ano)",
    diaDaSemana: 4,
    agora: local(2026, 12, 31, 10, 0, 0),
    botao: FIM_DE_SEMANA,
    inicio: local(2027, 1, 2, 0, 0, 0),
    fim: local(2027, 1, 3, 23, 59, 59),
  },
  // --- sábado e domingo: já é fim de semana, o início é agora ---
  {
    nome: "sábado 14/11 10:20:30 -> começa agora, termina domingo 15/11 23:59:59",
    diaDaSemana: 6,
    agora: local(2026, 11, 14, 10, 20, 30, 456),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 11, 14, 10, 20, 30, 456),
    fim: local(2026, 11, 15, 23, 59, 59),
  },
  {
    nome: "sábado 28/02/2026 -> começa agora, termina domingo 01/03 23:59:59 (virada de mês)",
    diaDaSemana: 6,
    agora: local(2026, 2, 28, 22, 0, 0),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 2, 28, 22, 0, 0),
    fim: local(2026, 3, 1, 23, 59, 59),
  },
  {
    nome: "domingo 15/11 10:20:30 -> começa agora, termina hoje 23:59:59",
    diaDaSemana: 0,
    agora: local(2026, 11, 15, 10, 20, 30, 456),
    botao: FIM_DE_SEMANA,
    inicio: local(2026, 11, 15, 10, 20, 30, 456),
    fim: local(2026, 11, 15, 23, 59, 59),
  },
  // --- os atalhos de duração: agora + N x 24 h ---
  {
    nome: "Próximas 24h: agora até agora + 24 h",
    diaDaSemana: 3,
    agora: QUARTA,
    botao: "Próximas 24h",
    inicio: QUARTA,
    fim: new Date(QUARTA.getTime() + DIA),
  },
  {
    nome: "7 Dias: agora até agora + 7 x 24 h",
    diaDaSemana: 3,
    agora: QUARTA,
    botao: "7 Dias",
    inicio: QUARTA,
    fim: new Date(QUARTA.getTime() + 7 * DIA),
  },
  {
    nome: "30 Dias: agora até agora + 30 x 24 h",
    diaDaSemana: 3,
    agora: QUARTA,
    botao: "30 Dias",
    inicio: QUARTA,
    fim: new Date(QUARTA.getTime() + 30 * DIA),
  },
];

describe("AdminBannersView: atalhos de programação das datas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    // Só o Date é falso: o React e o `esperar` precisam dos temporizadores reais.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(QUARTA);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
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

  /** "Novo Banner" com imagem enviada, no passo 3 (onde mora "Programar datas"). */
  async function abrirBannerNovoNoPasso3() {
    await montarPainel();
    await abrirNovoBannerPelaBarra();
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
    await configurarTextos(true);
    await abrirMaisOpcoes();
  }

  async function ligarProgramacao() {
    const chave = document.getElementById("banner-scheduling-toggle");
    expect(chave, "a chave da programação tem de estar na tela").not.toBeNull();
    await act(async () => {
      chave?.click();
    });
  }

  async function clicar(rotulo: string) {
    const botao = botaoComTexto(document.body, rotulo);
    expect(botao, `o botão "${rotulo}" tem de estar na tela`).toBeDefined();
    await act(async () => {
      botao?.click();
    });
  }

  async function salvar() {
    await act(async () => {
      botaoComTexto(document.body, "Salvar Alterações")?.click();
      await esperar();
      await esperar();
    });
  }

  it.each(casos)("$nome", async (caso) => {
    // o dia da semana do dado de teste não pode mentir
    expect(DIAS[caso.agora.getDay()]).toBe(DIAS[caso.diaDaSemana]);

    await abrirBannerNovoNoPasso3();
    await ligarProgramacao();
    // o relógio vai para o "agora" do caso só na hora do clique no atalho
    vi.setSystemTime(caso.agora);
    await clicar(caso.botao);
    // o fim tem de estar no futuro do relógio falso para o salvar não perguntar
    await salvar();

    expect(addBanner).toHaveBeenCalledTimes(1);
    const enviado = addBanner.mock.calls[0][0] as {
      startDate: string;
      endDate: string;
    };
    expect(enviado.startDate).toBe(caso.inicio.toISOString());
    expect(enviado.endDate).toBe(caso.fim.toISOString());
  });
});
