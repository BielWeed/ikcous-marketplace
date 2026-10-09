// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09, segunda foto dos Ajustes): a tela precisa estar
// SEPARADA por partes e as seções técnicas nascerem OCULTAS — "Minha loja
// está no ar?" (diagnóstico de conexão), "Mercado Pago" e as demais só
// exibem o conteúdo quando o lojista clica no
// cabeçalho da seção. Títulos no vocabulário do desenho SALÃO+PORÃO
// (13/09/2026). O acordeão "Nome, logo e cores" morou aqui e SAIU em
// 22/09/2026 (duplicado de AdminAboutStoreView).
//
// O CONTRATO:
//   1. A tela abre com as seções FECHADAS: os campos da loja e o termômetro
//      do PIX NÃO estão no DOM (nada de informação técnica empurrando o que
//      o lojista edita).
//   2. Um clique no cabeçalho expande o conteúdo; clicar de novo recolhe.
//   3. Os atalhos de vitrine (grupo "Aparência do app") continuam SEMPRE visíveis —
//      são a porta de trabalho.
//
// Painel simples (H5, 09/10/2026): a seção de Transportadoras e as Consultas
// de frete saíram desta tela e moram na tela de Frete (provas em
// frete-um-lugar-so.test.tsx). Os testes de pendência/onSetDirty abaixo
// miram a seção do Mercado Pago, a seção de formulário que ficou aqui.
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
    invoke.mockImplementation((nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (nome === "credenciais-mercado-pago") {
        // Chaves já salvas (chave FALSA): salvar só a pública é permitido.
        return Promise.resolve({
          data: {
            configurado: true,
            public_key: "APP_USR-publica-falsa-de-teste",
            mascara_token: "••••9999",
            mascara_webhook: "••••7777",
            ultimo_teste: null,
            atualizado_em: null,
            pix_ligado: false,
            public_key_na_loja: true,
            faltando: [],
            pausado: false,
          },
          error: null,
        });
      }
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

  // Painel simples (H5, 09/10/2026): as Transportadoras saíram de Ajustes
  // (moram na tela de Frete — provas em frete-um-lugar-so.test.tsx). A trava
  // "Salve antes de fechar" e a guarda onSetDirty continuam valendo para as
  // seções de formulário que ficaram; estes testes passaram a mirar a do
  // Mercado Pago. Abre a seção (lazy: espera o import assentar), a camada
  // "Suas chaves" e devolve o cabeçalho da seção.
  async function abrirChavesDoMercadoPago() {
    const cabecalho = cabecalhoDaSecao("Mercado Pago")!;
    await act(async () => {
      cabecalho.click();
    });
    const camadaDasChaves = () =>
      [...hospedeiro.querySelectorAll("button[aria-expanded]")].find((b) =>
        b.textContent?.includes("Suas chaves"),
      ) as HTMLButtonElement | undefined;
    // A primeira importação do módulo lazy pode levar mais que um tick.
    for (let i = 0; i < 50 && !camadaDasChaves(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      camadaDasChaves()!.click();
    });
    return cabecalho;
  }

  async function digitarChavePublica(valor: string) {
    const campo = hospedeiro.querySelector(
      "#mp-public-key",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("a tela abre com as seções técnicas FECHADAS e os atalhos de vitrine visíveis", async () => {
    await renderizar();

    // A porta de estética continua à vista.
    expect(hospedeiro.textContent).toContain("Banners");
    expect(hospedeiro.textContent).not.toContain("Banners Promocionais");
    expect(hospedeiro.textContent).toContain("Vitrines");
    expect(hospedeiro.textContent).not.toContain("Vitrines (Carrosséis)");

    // Conteúdo das seções técnicas NÃO está no DOM (recolhidas).
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("VITE_MP_PUBLIC_KEY");
    expect(hospedeiro.textContent).not.toContain("Latência média");

    // Os cabeçalhos existem e estão marcados como recolhidos.
    const status = cabecalhoDaSecao("Minha loja está no ar?")!;
    const mercadoPago = cabecalhoDaSecao("Mercado Pago")!;
    expect(status).toBeTruthy();
    expect(mercadoPago).toBeTruthy();
    expect(status.getAttribute("aria-expanded")).toBe("false");
    expect(mercadoPago.getAttribute("aria-expanded")).toBe("false");
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
  // abaixo (independência entre seções).

  it("as seções são independentes: abrir Status não abre o Mercado Pago", async () => {
    await renderizar();

    await act(async () => {
      cabecalhoDaSecao("Minha loja está no ar?")!.click();
    });

    expect(hospedeiro.textContent).toContain("Pagamento online (PIX)");
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
  });

  // ── Transportadoras e Consultas de frete moraram aqui de 02/09 a
  // 09/10/2026 (frente glm-visual-admin-0209 → painel simples, H5): voltaram
  // para a tela de Frete. Ajustes não monta nenhuma das duas. ─────────────
  it("Transportadoras e Consultas de frete não moram mais em Ajustes", async () => {
    await renderizar();

    expect(cabecalhoDaSecao("Transportadoras")).toBeUndefined();
    expect(cabecalhoDaSecao("Consultas de frete")).toBeUndefined();
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    expect(hospedeiro.querySelector("table")).toBeNull();
  });

  it("uma seção com formulário NÃO fecha com alteração não salva — e fecha depois de salvar", async () => {
    // Achado A1 da revisão adversária: fechar a seção desmonta o conteúdo e
    // jogaria fora o que foi digitado, sem aviso nenhum. Com pendência, o
    // clique no cabeçalho é recusado (com aviso); depois de salvar, fecha.
    await renderizar();
    const cabecalho = await abrirChavesDoMercadoPago();

    // Mexe na chave pública: pendência criada.
    await digitarChavePublica("APP_USR-outra-publica-falsa");

    // O aviso de pendência aparece no cabeçalho…
    expect(hospedeiro.textContent).toMatch(/salve antes de fechar/i);

    // …e o clique de fechar é RECUSADO: o campo continua na tela.
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hospedeiro.querySelector("#mp-public-key")).not.toBeNull();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");

    // Salva as chaves…
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar chaves"),
    ) as HTMLButtonElement;
    expect(botaoSalvar).toBeDefined();
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
    expect(
      invoke.mock.calls.some(
        (c) =>
          c[0] === "credenciais-mercado-pago" && c[1]?.body?.acao === "salvar",
      ),
    ).toBe(true);

    // …a pendência acaba, o aviso some, e fechar volta a funcionar.
    expect(hospedeiro.textContent).not.toMatch(/salve antes de fechar/i);
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(hospedeiro.querySelector("#mp-public-key")).toBeNull();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
  });

  it("a pendência é reportada ao App: onSetDirty true ao mexer, false ao salvar", async () => {
    // Achado 1 da revisão do #414: as guardas do App (beforeunload, diálogo
    // de navegação, popstate) ligam via onSetDirty — recarregar/sair do
    // painel não pode descartar em silêncio o que foi digitado. (A pendência
    // do token das transportadoras é somada pela tela de Frete desde H5:
    // frete-um-lugar-so.test.tsx, F4.)
    const onSetDirty = vi.fn();
    await renderizar(onSetDirty);

    // Montagem limpa: nenhuma pendência reportada.
    expect(onSetDirty).toHaveBeenLastCalledWith(false);

    await abrirChavesDoMercadoPago();

    // Mexe na chave pública: a guarda liga.
    await digitarChavePublica("APP_USR-outra-publica-falsa");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    // Salva: a guarda desliga.
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar chaves"),
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

  // "salvar os provedores ligados dentro da seção atualiza 'Ativo: X'"
  // (achado 5 da revisão Opus) morava aqui: com as Transportadoras na tela
  // de Frete, a prova de que salvar quem está ligado atualiza o estado ao
  // lado sem recarregar é a F5 de frete-um-lugar-so.test.tsx; a releitura do
  // subtítulo de Ajustes ao voltar para a aba é a J2 do mesmo arquivo.
});
