// @vitest-environment jsdom
//
// Buracos de prova da página "Sobre a loja" achados por MUTAÇÃO (plantar um
// defeito de uma linha em `AboutStoreView.tsx` e ver se algum teste cai). Os
// três defeitos abaixo sobreviviam a todos os testes vizinhos:
// - tirar `isPresent &&`: o botão "Falar com a loja" mora num portal no <body>;
//   se ele não sumisse junto com a tela que está SAINDO, ficaria flutuando por
//   cima da tela seguinte;
// - tirar a guarda `current !== logoSelection` do `logoFalhou`: dois avisos de
//   erro da MESMA logo no mesmo instante pulavam a logo do build e iam direto
//   para a inicial ("a falha só avança a candidata que a originou");
// - tirar `haptic.light()` depois de abrir o WhatsApp: o toque perdia a
//   vibração de confirmação.
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

type ConfigDeTeste = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  presente: true,
  vibrou: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: estado.vibrou, medium: vi.fn() },
}));
vi.mock("framer-motion", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("framer-motion")>();
  return { ...real, useIsPresent: () => estado.presente };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const LOJA_COM_LOGO_E_WHATSAPP: ConfigDeTeste = {
  storeName: "Loja de Teste",
  logoUrl: "https://cdn.exemplo.test/logo.png",
  storeCity: null,
  storeState: null,
  businessHours: null,
  whatsappNumber: "34999999999",
  storeDescription: null,
  storeAddress: null,
  originCep: null,
};

describe("AboutStoreView — saída animada, erro duplo da logo e vibração do WhatsApp", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // A primeira compilação da tela passa dos 5 s de um teste comum.
  beforeAll(async () => {
    await import("@/views/customer/AboutStoreView");
  }, 60_000);

  beforeEach(() => {
    estado.config = LOJA_COM_LOGO_E_WHATSAPP;
    estado.presente = true;
    estado.vibrou.mockClear();
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("open", vi.fn());
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
  });

  async function renderizarPagina() {
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function botaoWhatsapp() {
    return document.body.querySelector<HTMLButtonElement>(
      "button[aria-label='Falar com a loja no WhatsApp']",
    );
  }

  function logo() {
    return hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
  }

  it("CONTROLE: com a tela presente o botão 'Falar com a loja' existe", async () => {
    await renderizarPagina();
    expect(botaoWhatsapp()).not.toBeNull();
  });

  it("tela SAINDO (animação de saída): o botão do portal some junto", async () => {
    estado.presente = false;
    await renderizarPagina();
    expect(botaoWhatsapp()).toBeNull();
  });

  it("tocar em 'Falar com a loja' abre o WhatsApp e vibra uma vez, de leve", async () => {
    await renderizarPagina();
    await act(async () => {
      botaoWhatsapp()?.click();
    });
    expect(vi.mocked(globalThis.open)).toHaveBeenCalledTimes(1);
    expect(estado.vibrou).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: um erro da logo do banco passa para a logo do build; o segundo, para a inicial", async () => {
    await renderizarPagina();
    expect(logo()?.getAttribute("src")).toBe(
      "https://cdn.exemplo.test/logo.png",
    );
    await act(async () => {
      logo()?.dispatchEvent(new Event("error"));
    });
    expect(logo()?.getAttribute("src")).toBe("/identity/aurora/header.webp");
    await act(async () => {
      logo()?.dispatchEvent(new Event("error"));
    });
    expect(logo()).toBeNull();
    expect(hospedeiro.textContent).toContain("L");
  });

  it("LIMITE: dois erros da MESMA logo do banco no mesmo instante avançam UMA candidata só", async () => {
    await renderizarPagina();
    const imagemDoBanco = logo();
    expect(imagemDoBanco?.getAttribute("src")).toBe(
      "https://cdn.exemplo.test/logo.png",
    );
    await act(async () => {
      imagemDoBanco?.dispatchEvent(new Event("error"));
      imagemDoBanco?.dispatchEvent(new Event("error"));
    });
    // A logo do build (próxima candidata) continua na tela: o segundo aviso
    // era da candidata que já saiu e não pode queimar esta.
    expect(logo()?.getAttribute("src")).toBe("/identity/aurora/header.webp");
  });
});
