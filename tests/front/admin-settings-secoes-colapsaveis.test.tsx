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
    shippingProvider: "flat_fee" as "flat_fee" | "melhor_envio" | "frenet",
    enabledShippingMethods: ["sedex", "pac"] as string[],
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "store_shipping_credentials") {
        return {
          select: () =>
            Promise.resolve({
              data: [
                {
                  provider: "melhor_envio",
                  credentials: { token: "tok-da-loja", sandbox: false },
                },
              ],
              error: null,
            }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    },
  },
}));

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

  async function renderizar(onSetDirty?: (dirty: boolean) => void) {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(
        <AdminSettingsView
          onNavigate={vi.fn()}
          active={true}
          onSetDirty={onSetDirty}
        />,
      );
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

  // ── Seções novas da frente glm-visual-admin-0209 (transportadoras e
  // histórico mudaram da tela de Frete para cá) ──────────────────────────
  it("as seções de Transportadoras e Histórico também nascem FECHADAS", async () => {
    await renderizar();

    const transportadoras = cabecalhoDaSecao(
      "Transportadoras e cotação de frete",
    )!;
    const historico = cabecalhoDaSecao("Histórico de cotações de frete")!;
    expect(transportadoras).toBeTruthy();
    expect(historico).toBeTruthy();
    expect(transportadoras.getAttribute("aria-expanded")).toBe("false");
    expect(historico.getAttribute("aria-expanded")).toBe("false");

    // Fechadas = nada de campo de token nem consulta ao histórico no DOM.
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    expect(hospedeiro.querySelector("table")).toBeNull();
  });

  it("a seção de Transportadoras NÃO fecha com alteração não salva — e fecha depois de salvar", async () => {
    // Achado A1 da revisão adversária: fechar a seção desmonta o card e
    // jogaria fora o token digitado, sem aviso nenhum. Com pendência, o
    // clique no cabeçalho é recusado (com aviso); depois de salvar, fecha.
    updateConfig.mockResolvedValue(true);
    mockConfig.shippingProvider = "melhor_envio";
    mockConfig.enabledShippingMethods = ["sedex", "pac"];

    await renderizar();

    const cabecalho = cabecalhoDaSecao("Transportadoras e cotação de frete")!;
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const campoToken = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(campoToken).not.toBeNull();
    expect(campoToken.value).toBe("tok-da-loja");

    // Mexe no token: pendência criada.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoToken, "tok-novo");
      campoToken.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // O aviso de pendência aparece no cabeçalho…
    expect(hospedeiro.textContent).toMatch(/salve antes de fechar/i);

    // …e o clique de fechar é RECUSADO: o token continua na tela.
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      hospedeiro.querySelector('input[type="password"]'),
    ).not.toBeNull();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");

    // Salva dentro da própria seção…
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botaoSalvar.disabled).toBe(false);
    await act(async () => {
      botaoSalvar.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    // …a pendência acaba, o aviso some, e fechar volta a funcionar.
    expect(hospedeiro.textContent).not.toMatch(/salve antes de fechar/i);
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
  });

  it("a pendência do token é reportada ao App: onSetDirty true ao mexer, false ao salvar", async () => {
    // Achado 1 da revisão do #414: a tela de Frete antiga ligava as guardas
    // do App (beforeunload, diálogo de navegação, popstate) via onSetDirty;
    // com a mudança de casa para o Ajustes, a pendência do token precisa ser
    // espelhada nele também — recarregar/sair do painel não pode descartar
    // o token digitado em silêncio.
    const onSetDirty = vi.fn();
    updateConfig.mockResolvedValue(true);
    mockConfig.shippingProvider = "melhor_envio";
    mockConfig.enabledShippingMethods = ["sedex", "pac"];

    await renderizar(onSetDirty);

    // Montagem limpa: nenhuma pendência reportada.
    expect(onSetDirty).toHaveBeenLastCalledWith(false);

    const cabecalho = cabecalhoDaSecao("Transportadoras e cotação de frete")!;
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const campoToken = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(campoToken).not.toBeNull();

    // Mexe no token: a guarda liga.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoToken, "tok-novo");
      campoToken.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    // Salva: a guarda desliga.
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    await act(async () => {
      botaoSalvar.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});
