// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09, segunda foto dos Ajustes): a tela precisa estar
// SEPARADA por partes e as seções técnicas nascerem OCULTAS — "Status de
// funcionamento do sistema" (termômetro do PIX + diagnóstico de conexão) e
// "Identidade e localização da loja" (nome, cidade, UF, horário) só exibem
// o conteúdo quando o lojista clica no cabeçalho da seção.
//
// O CONTRATO:
//   1. A tela abre com as duas seções FECHADAS: os campos da loja e o
//      termômetro do PIX NÃO estão no DOM (nada de informação técnica
//      empurrando o que o lojista edita).
//   2. Um clique no cabeçalho expande o conteúdo; clicar de novo recolhe.
//   3. A seção "Design & Vitrine" (a parte de estética) continua SEMPRE
//      visível — é a porta de trabalho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    storeName: "Loja Teste",
    storeCity: "Uberlândia",
    storeState: "MG",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminSettingsView — seções colapsadas por padrão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  function cabecalhoDaSecao(texto: string) {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;
  }

  async function renderizar() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
  }

  it("a tela abre com as seções técnicas FECHADAS e o Design & Vitrine visível", async () => {
    await renderizar();

    // A porta de estética continua à vista.
    expect(hospedeiro.textContent).toContain("Banners Promocionais");
    expect(hospedeiro.textContent).toContain("Vitrines (Carrosséis)");

    // Conteúdo das seções técnicas NÃO está no DOM (recolhidas).
    expect(hospedeiro.querySelector("#store-name")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("VITE_MP_PUBLIC_KEY");
    expect(hospedeiro.textContent).not.toContain("Latência média");

    // Os cabeçalhos existem e estão marcados como recolhidos.
    const status = cabecalhoDaSecao("Status de funcionamento do sistema")!;
    const loja = cabecalhoDaSecao("Identidade e localização da loja")!;
    expect(status).toBeTruthy();
    expect(loja).toBeTruthy();
    expect(status.getAttribute("aria-expanded")).toBe("false");
    expect(loja.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicar no cabeçalho de Status expande o termômetro do PIX e o diagnóstico; segundo clique recolhe", async () => {
    await renderizar();

    const status = cabecalhoDaSecao("Status de funcionamento do sistema")!;
    await act(async () => {
      status.click();
    });

    // Expandida: termômetro do PIX visível (com o estado) e diagnóstico.
    expect(hospedeiro.textContent).toContain("Pagamento online (PIX)");
    expect(status.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      status.click();
    });

    // Recolhida: o conteúdo sai do DOM no fim da animação de saída.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(hospedeiro.textContent).not.toContain("Pagamento online (PIX)");
  });

  it("clicar no cabeçalho de Identidade expande os campos da loja", async () => {
    await renderizar();

    expect(hospedeiro.querySelector("#store-name")).toBeNull();

    const loja = cabecalhoDaSecao("Identidade e localização da loja")!;
    await act(async () => {
      loja.click();
    });

    const campoNome = hospedeiro.querySelector<HTMLInputElement>("#store-name");
    expect(campoNome).not.toBeNull();
    expect(campoNome!.value).toBe("Loja Teste");
  });

  it("as seções são independentes: abrir Status não abre a Identidade", async () => {
    await renderizar();

    await act(async () => {
      cabecalhoDaSecao("Status de funcionamento do sistema")!.click();
    });

    expect(hospedeiro.textContent).toContain("Pagamento online (PIX)");
    expect(hospedeiro.querySelector("#store-name")).toBeNull();
  });
});
