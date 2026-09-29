// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09, segunda foto dos Ajustes): a tela precisa estar
// SEPARADA por partes e as seções técnicas nascerem OCULTAS — "Minha loja
// está no ar?" (termômetro do PIX + diagnóstico de conexão), "Entrega e
// frete" e as demais só exibem o conteúdo quando o lojista clica no
// cabeçalho da seção. Títulos no vocabulário do desenho SALÃO+PORÃO
// (13/09/2026). O acordeão "Nome, logo e cores" morou aqui e SAIU em
// 22/09/2026 (duplicado de AdminAboutStoreView).
//
// O CONTRATO:
//   1. A tela abre com as seções FECHADAS: os campos da loja e o termômetro
//      do PIX NÃO estão no DOM (nada de informação técnica empurrando o que
//      o lojista edita).
//   2. Um clique no cabeçalho expande o conteúdo; clicar de novo recolhe.
//   3. Os atalhos de vitrine (grupo "Sua loja") continuam SEMPRE visíveis —
//      são a porta de trabalho.
//
// RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2): a seção de
// Transportadoras deixou de ler `store_shipping_credentials` por PostgREST e
// de decidir estado por `config.shippingProvider` — ela lê e grava pela edge
// `calculate-shipping` (`ler_configuracao_frete`/`save_credentials`) e
// mostra um CARTÃO POR PROVEDOR (Melhor Envio, SuperFrete, Frenet), cada um
// com seu próprio campo de chave e botão "Salvar". Os testes de
// pendência/onSetDirty abaixo miram o PRIMEIRO cartão (Melhor Envio, index 0
// na ordem de exibição) em vez de um único campo — não existe mais "o"
// campo de token, existem três.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
}));
const updateConfig = vi.fn();

const { mockConfig, estadoDoBanco, invoke } = vi.hoisted(() => ({
  mockConfig: {
    storeName: "Loja Teste",
    storeCity: "Uberlândia",
    storeState: "MG",
  },
  // Estado que a edge `ler_configuracao_frete` devolveria — a fonte única
  // que a seção de Transportadoras e o subtítulo "Ativo: ..." consultam.
  estadoDoBanco: {
    ligados: ["melhor_envio"] as string[],
    provedores: {
      melhor_envio: { tem_chave: true, sandbox: false },
    } as Record<string, { tem_chave: boolean; sandbox?: boolean }>,
  },
  invoke: vi.fn(),
}));

function respostaConfig() {
  return {
    success: true,
    modo: estadoDoBanco.ligados.length > 0 ? "multi" : "legado",
    ligados: estadoDoBanco.ligados,
    provedores: {
      melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
      ...Object.fromEntries(
        Object.entries(estadoDoBanco.provedores).map(([p, v]) => [
          p,
          { servicos: null, ...v },
        ]),
      ),
    },
  };
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminSettingsView — seções colapsadas por padrão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDoBanco.ligados = ["melhor_envio"];
    estadoDoBanco.provedores = { melhor_envio: { tem_chave: true } };
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaConfig(), error: null });
      }
      if (action === "save_credentials") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    updateConfig.mockResolvedValue(true);
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

  // Abre "Entrega e frete" e drena os dois fetches que a seção de
  // Transportadoras faz no mount (ela só monta quando a seção expande):
  // `ler_configuracao_frete` chega em dois `await` (o `chamarEdgeDeFrete` e
  // a normalização do estado).
  async function abrirEntregaEFrete() {
    const cabecalho = cabecalhoDaSecao("Entrega e frete")!;
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return cabecalho;
  }

  it("a tela abre com as seções técnicas FECHADAS e os atalhos de vitrine visíveis", async () => {
    await renderizar();

    // A porta de estética continua à vista.
    expect(hospedeiro.textContent).toContain("Banners Promocionais");
    expect(hospedeiro.textContent).toContain("Vitrines (Carrosséis)");

    // Conteúdo das seções técnicas NÃO está no DOM (recolhidas).
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("VITE_MP_PUBLIC_KEY");
    expect(hospedeiro.textContent).not.toContain("Latência média");

    // Os cabeçalhos existem e estão marcados como recolhidos.
    const status = cabecalhoDaSecao("Minha loja está no ar?")!;
    const entrega = cabecalhoDaSecao("Entrega e frete")!;
    expect(status).toBeTruthy();
    expect(entrega).toBeTruthy();
    expect(status.getAttribute("aria-expanded")).toBe("false");
    expect(entrega.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicar no cabeçalho de Status expande o termômetro do PIX e o diagnóstico; segundo clique recolhe", async () => {
    await renderizar();

    const status = cabecalhoDaSecao("Minha loja está no ar?")!;
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

  // "clicar no cabeçalho de Identidade expande os campos da loja" morava
  // aqui e SAIU em 22/09/2026 junto com o acordeão "Nome, logo e cores"
  // (duplicado de AdminAboutStoreView, removido de AdminSettingsView). O
  // mecanismo genérico de abrir/expandir continua provado acima (Status) e
  // abaixo (independência entre seções, usando Entrega e frete).

  it("as seções são independentes: abrir Status não abre Entrega e frete", async () => {
    await renderizar();

    await act(async () => {
      cabecalhoDaSecao("Minha loja está no ar?")!.click();
    });

    expect(hospedeiro.textContent).toContain("Pagamento online (PIX)");
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
  });

  // ── Seções novas da frente glm-visual-admin-0209 (transportadoras e
  // histórico mudaram da tela de Frete para cá) ──────────────────────────
  it("as seções de Entrega e frete e Consultas de frete também nascem FECHADAS", async () => {
    await renderizar();

    const transportadoras = cabecalhoDaSecao("Entrega e frete")!;
    const historico = cabecalhoDaSecao("Consultas de frete")!;
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
    await renderizar();
    const cabecalho = await abrirEntregaEFrete();

    // Três cartões (Melhor Envio, SuperFrete, Frenet) — o teste mira o
    // PRIMEIRO (Melhor Envio), que é o que a resposta mockada marca como
    // "tem_chave".
    const campos = [
      ...hospedeiro.querySelectorAll('input[type="password"]'),
    ] as HTMLInputElement[];
    expect(campos).toHaveLength(3);
    const campoToken = campos[0];
    // 1.5.4/1.5.7: a chave salva não volta ao campo (só-escrita) — nasce vazio.
    expect(campoToken.value).toBe("");

    // Mexe no token do primeiro cartão: pendência criada.
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

    // …e o clique de fechar é RECUSADO: os campos continuam na tela.
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hospedeiro.querySelectorAll('input[type="password"]')).toHaveLength(
      3,
    );
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");

    // Salva o PRIMEIRO cartão (Melhor Envio)…
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement;
    expect(botaoSalvar).toBeDefined();
    expect(botaoSalvar.disabled).toBe(false);
    await act(async () => {
      botaoSalvar.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
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
    await renderizar(onSetDirty);

    // Montagem limpa: nenhuma pendência reportada.
    expect(onSetDirty).toHaveBeenLastCalledWith(false);

    const cabecalho = cabecalhoDaSecao("Entrega e frete")!;
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const campoToken = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(campoToken).not.toBeNull();

    // Mexe no token do primeiro cartão: a guarda liga.
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
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement;
    await act(async () => {
      botaoSalvar.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });

  // ── Achado 5 (revisão Opus): o subtítulo "Ativo: X" só lia os
  // provedores ligados UMA VEZ, ao montar — salvar dentro da seção não o
  // atualizava até a página recarregar. `TransportadorasSection` agora
  // avisa o pai (`onLigadosMudou`) a cada leitura confirmada. ────────────
  it("salvar os provedores ligados dentro da seção atualiza 'Ativo: X' sem precisar reabrir a tela", async () => {
    estadoDoBanco.provedores = {
      melhor_envio: { tem_chave: true },
      superfrete: { tem_chave: true },
    };
    await renderizar();
    expect(hospedeiro.textContent).toContain("Ativo: Melhor Envio");
    expect(hospedeiro.textContent).not.toContain("Melhor Envio + SuperFrete");

    await abrirEntregaEFrete();

    const linhaSF = [...hospedeiro.querySelectorAll("label")].find(
      (l) =>
        /SuperFrete/.test(l.textContent ?? "") &&
        l.querySelector('input[type="checkbox"]'),
    ) as HTMLLabelElement;
    const caixaSF = linhaSF.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      caixaSF.click();
    });

    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaConfig(), error: null });
      }
      if (action === "save_active_providers") {
        estadoDoBanco.ligados = ["melhor_envio", "superfrete"];
        return Promise.resolve({
          data: { success: true, ligados: estadoDoBanco.ligados },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });

    const botaoSalvarProvedores = [
      ...hospedeiro.querySelectorAll("button"),
    ].find((b) => /Salvar provedores/.test(b.textContent ?? "")) as
      | HTMLButtonElement
      | undefined;
    expect(botaoSalvarProvedores).toBeDefined();
    await act(async () => {
      botaoSalvarProvedores?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O cabeçalho "Entrega e frete" mostra o subtítulo "Ativo: X" fora da
    // seção — reflete a mudança SEM fechar/reabrir e sem recarregar a
    // página: o callback avisou o pai direto.
    expect(hospedeiro.textContent).toContain(
      "Ativo: Melhor Envio + SuperFrete",
    );
  });
});
