// @vitest-environment jsdom
//
// Achado AdminBannersView-1156: o override registrado por
// AdminBannersView ao abrir o diálogo ("Novo Banner"/editar) nunca
// empurrava uma entrada própria no histórico do navegador. O Voltar
// FÍSICO do Android dispara `popstate` em App.tsx, que roda o override
// (fecha o diálogo) mas, de propósito, cai em seguida em
// `syncWithUrl('popstate')` — como a URL já tinha mudado para a entrada
// ANTERIOR (ex.: /admin-settings, pois nada deste componente nunca
// empurrou nada), o app trocava de tela por baixo do diálogo. O botão
// "Voltar" da própria tela (AdminArea.tsx:705 → backOverride) só fecha o
// diálogo — o Voltar físico e o Voltar da tela faziam coisas diferentes.
//
// Padrão que já funciona no app (CheckoutView.tsx:1008-1054): ao abrir o
// diálogo, empurrar `{...history.state, modal: "banner"}` na MESMA URL;
// ao fechar, consumir essa entrada com `history.back()` quando ela ainda
// não tiver sido consumida pelo próprio pop do navegador — sem isto
// ficava uma entrada órfã e o PRÓXIMO Voltar físico não fazia nada
// sozinho (precisava de dois toques para sair de Banners).
//
// Este arquivo prova, no nível do componente (sem montar App.tsx inteiro,
// fora do escopo desta tarefa — arquivos_permitidos não inclui App.tsx):
//
// 1. Abrir o diálogo empurra uma entrada de histórico com `modal: "banner"`
//    na MESMA URL (não navega para lugar nenhum).
// 2. O Voltar FÍSICO (o navegador já fez o pop antes do popstate chegar
//    ao override, exatamente como App.tsx:1954-1958 descreve) fecha só o
//    diálogo e NÃO consome mais nenhuma entrada — se consumisse, seria a
//    saída indevida da tela que este achado descreve.
// 3. O botão Voltar da própria tela / Escape (chamada direta ao override,
//    SEM pop prévio do navegador) consome a entrada empurrada com
//    `history.back()`, para não deixar órfã.
// 4. O override é idempotente: chamá-lo de novo depois de já ter fechado
//    não repete o fechamento nem consome outra entrada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

// Só precisa de um banner publicado para o botão "Novo Banner" renderizar
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

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

describe("AdminBannersView — Voltar do celular com o diálogo aberto fecha só o diálogo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Captura o override registrado, do mesmo jeito que App.tsx guarda em
  // backOverrideRef para rodar no popstate (App.tsx:1954-1958) e que
  // AdminArea.tsx:705 chama direto a partir do botão Voltar da tela. Em
  // produção `onSetBackOverride` É o `setBackOverride` de um
  // `useState<(() => void) | null>` (App.tsx:662, 2211) — o componente
  // chama `onSetBackOverride(() => fnReal)` de propósito, no formato de
  // "updater" do useState, para o React não confundir a função guardada
  // com uma função de atualização. O dublê replica esse mesmo contrato
  // (chama o argumento como updater quando é função) — sem isto,
  // guardar o argumento cru capturaria o WRAPPER `() => fnReal` em vez
  // de `fnReal`, e todo `overrideAtual?.()` do teste seria um no-op.
  let overrideAtual: (() => void) | null = null;
  const onSetBackOverride = vi.fn((fn: unknown) => {
    overrideAtual =
      typeof fn === "function"
        ? (fn as () => (() => void) | null)()
        : (fn as (() => void) | null);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    overrideAtual = null;
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
    // Base limpa do histórico real do jsdom: uma única entrada, imitando
    // a URL da tela de Banners já carregada (equivalente ao que
    // App.tsx/syncWithUrl deixaria como history.state antes de o diálogo
    // abrir).
    window.history.replaceState(
      { view: "admin-banners" },
      "",
      "/admin-banners",
    );

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
      raiz.render(
        <AdminBannersView
          onNavigate={onNavigate}
          active={true}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function abrirDialogoNovoBanner() {
    const botaoNovoBanner = localizarBotaoPorTexto(hospedeiro, "Novo Banner")!;
    expect(botaoNovoBanner).toBeDefined();
    await act(async () => {
      botaoNovoBanner.click();
      await esperarMicrotarefas();
    });
    // Diálogo realmente aberto (o botão "Salvar Banner" só existe dentro dele).
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();
  }

  it("abrir o diálogo empurra uma entrada de histórico própria, na MESMA URL, sem navegar para lugar nenhum", async () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    await montar();
    await abrirDialogoNovoBanner();

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    const [estadoEmpurrado, , urlEmpurrada] = pushStateSpy.mock.calls[0];
    expect(estadoEmpurrado).toMatchObject({
      view: "admin-banners",
      modal: "banner",
    });
    // Mesma URL de antes — o pushState só marca a entrada, não navega.
    expect(urlEmpurrada).toBe("/admin-banners");
    expect(window.location.pathname).toBe("/admin-banners");
    // O override foi registrado (é o que App.tsx roda no popstate e o que
    // o botão Voltar da tela chama direto).
    expect(overrideAtual).toBeInstanceOf(Function);
  });

  it("Voltar FÍSICO (navegador já fez o pop antes do override rodar) fecha só o diálogo e NÃO consome outra entrada", async () => {
    await montar();
    await abrirDialogoNovoBanner();

    // Neste ponto o topo da pilha é a entrada com modal:"banner" que o
    // diálogo empurrou. Um Voltar físico de verdade faz o NAVEGADOR popar
    // essa entrada sozinho, ANTES de disparar `popstate` — é assim que
    // App.tsx:1954-1958 encontra `history.state` já sem o modal quando
    // roda `backOverrideRef.current()`. `replaceState` reproduz essa
    // pré-condição de forma determinística (o `back()` real do jsdom não
    // resolve de forma síncrona/confiável entre versões, e mockar sua
    // implementação fingiria o comportamento em vez de reproduzi-lo).
    window.history.replaceState(
      { view: "admin-banners" },
      "",
      "/admin-banners",
    );
    expect(window.history.state?.modal).toBeUndefined();
    const backSpy = vi.spyOn(window.history, "back");

    // Agora simula exatamente o que App.tsx faz em seguida: roda o
    // override capturado (backOverrideRef.current()).
    await act(async () => {
      overrideAtual?.();
    });

    // Fechou só o diálogo...
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeUndefined();
    // ...e NÃO tentou consumir outra entrada (senão seria a saída
    // indevida da tela que este achado descreve — o app sairia de
    // Banners de verdade, não só fecharia o diálogo).
    expect(backSpy).not.toHaveBeenCalled();
  });

  it("Voltar da PRÓPRIA TELA (chamada direta ao override, sem pop prévio) consome a entrada empurrada para não deixar órfã", async () => {
    await montar();
    await abrirDialogoNovoBanner();

    // Ninguém apertou o Voltar físico ainda: a entrada com modal:"banner"
    // continua no topo. AdminArea.tsx:705 (`onBack={backOverride}`) chama
    // o override DIRETO, sem passar pelo popstate.
    expect(window.history.state?.modal).toBe("banner");
    const backSpy = vi.spyOn(window.history, "back");

    await act(async () => {
      overrideAtual?.();
    });

    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeUndefined();
    // Consumiu a entrada que ele mesmo empurrou — sem isto ela ficava
    // órfã e o PRÓXIMO Voltar físico não faria nada sozinho.
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("override é idempotente: chamado de novo depois de já ter fechado não repete o fechamento nem consome outra entrada", async () => {
    await montar();
    await abrirDialogoNovoBanner();

    const backSpy = vi.spyOn(window.history, "back");
    const fecharPrimeiraVez = overrideAtual;

    await act(async () => {
      fecharPrimeiraVez?.();
    });
    expect(backSpy).toHaveBeenCalledTimes(1);

    // O botão Voltar do AdminLayout e o popstate resultante do
    // history.back() acima podem entregar a MESMA função de fechamento
    // uma segunda vez (AdminArea.tsx:705 chama o override direto; o
    // history.back() disparado pela limpeza também pode gerar um
    // popstate que roda o override de novo antes da desregistração).
    await act(async () => {
      fecharPrimeiraVez?.();
    });

    // Não chamou history.back() de novo (não existe mais entrada dela
    // própria para consumir) — a segunda chamada foi um no-op.
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
