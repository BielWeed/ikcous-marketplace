// @vitest-environment jsdom
//
// Painel simples, H5 (onda 4, frente A): o frete mora num lugar só. As
// Transportadoras (chave, teste, serviços e quem está ligado) e as Consultas
// de frete saíram de Ajustes e foram para a tela de Frete; Ajustes fica só com
// a PORTA "Entrega e frete" e o subtítulo do grupo.
//
// O que este arquivo prende:
//   Frete
//     F1  o painel "Transportadoras" mora entre "Fora da cidade" e
//         "Estratégias do frete local", nasce fechado, e antes de abrir a tela
//         lê `ler_configuracao_frete` UMA vez só (a seção não monta antes);
//     F2  abrir monta o MESMO formulário de chave (um campo por transportadora);
//     F3  fechar e reabrir mantém o token digitado (a seção não desmonta) e
//         não lê de novo;
//     F4  o token não salvo liga a guarda da tela (onSetDirty) sem acender o
//         Salvar do cabeçalho; salvar a chave desliga a guarda;
//     F5  salvar quem está ligado dentro do painel atualiza "Fora da cidade"
//         sem recarregar a tela;
//     F6  "Conectar transportadora" e "Abrir Transportadoras" abrem o painel em
//         vez de mandar para Ajustes;
//     F7  "Consultas de frete" mora sob "Avançado", junto de "Etiquetas", e só
//         busca o histórico com o painel aberto (busca fresca a cada abertura);
//     F8  `painelInicial="nacional"` ainda abre "Fora da cidade".
//   Ajustes
//     J1  não monta a seção de Transportadoras nem o histórico de consultas;
//     J2  a leitura do subtítulo de "Entrega e frete" roda de novo cada vez
//         que a aba Ajustes volta a ficar ativa (salvar no Frete e voltar não
//         deixa o subtítulo velho).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, invoke, tabelasLidas } = vi.hoisted(
  () => ({
    estadoDaLoja: { atual: {} as Record<string, unknown> },
    // O que a edge `ler_configuracao_frete` devolveria.
    estadoDoBanco: {
      ligados: [] as string[],
      provedores: {} as Record<
        string,
        { tem_chave: boolean; contato_email?: string | null }
      >,
    },
    invoke: vi.fn(),
    tabelasLidas: [] as string[],
  }),
);

function lojaPadrao(): Record<string, unknown> {
  return {
    storeName: "Loja Teste",
    storeCity: "Uberlândia",
    storeState: "MG",
    freeShippingMin: 100,
    shippingCoverage: "national",
    originCep: "38400-000",
    enabledShippingMethods: ["sedex", "pac"],
    localDeliveryFee: 10,
    localCepRange: "",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
  };
}

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
          { sandbox: false, servicos: null, ...v },
        ]),
      ),
    },
  };
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig: vi.fn(async () => true),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      tabelasLidas.push(tabela);
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
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

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function drenar() {
  await act(async () => {
    await esperarMicrotarefas();
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

function leiturasDeFrete(): number {
  return invoke.mock.calls.filter(
    (chamada) => chamada[1]?.body?.action === "ler_configuracao_frete",
  ).length;
}

function leiturasDoHistorico(): number {
  return tabelasLidas.filter((t) => t === "shipping_calculation_logs").length;
}

function digitar(campo: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  tabelasLidas.length = 0;
  estadoDaLoja.atual = lojaPadrao();
  estadoDoBanco.ligados = ["melhor_envio"];
  estadoDoBanco.provedores = { melhor_envio: { tem_chave: true } };
  invoke.mockImplementation((_nome: string, opcoes: any) => {
    if (opcoes?.body?.action === "ler_configuracao_frete") {
      return Promise.resolve({ data: respostaConfig(), error: null });
    }
    return Promise.resolve({ data: { success: true }, error: null });
  });
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
  // jsdom não rola: abrir o painel por atalho chama scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
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

function botaoComTexto(padrao: RegExp): HTMLButtonElement | undefined {
  return [...hospedeiro.querySelectorAll("button")].find((b) =>
    padrao.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
}

/** O botão-cabeçalho de um painel da tela de Frete, pelo id da seção. */
function cabecalhoDoPainel(id: string): HTMLButtonElement {
  const botao = hospedeiro.querySelector<HTMLButtonElement>(
    `#${id} > button[aria-expanded]`,
  );
  expect(botao, `painel ${id} ausente`).not.toBeNull();
  return botao as HTMLButtonElement;
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await drenar();
}

describe("Frete: as Transportadoras e as Consultas de frete moram aqui", () => {
  async function abrirFrete(
    props: {
      onSetDirty?: (dirty: boolean) => void;
      onNavigate?: (view: string) => void;
      painelInicial?: "local" | "nacional";
    } = {},
  ) {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={props.onSetDirty ?? vi.fn()}
          onNavigate={props.onNavigate as never}
          painelInicial={props.painelInicial}
        />,
      );
    });
    await drenar();
  }

  it("F1 — 'Transportadoras' fica entre 'Fora da cidade' e 'Estratégias do frete local', fechado, com UMA leitura antes de abrir", async () => {
    await abrirFrete();

    const ordem = [
      ...hospedeiro.querySelectorAll<HTMLElement>(
        "section[id^='painel-frete-']",
      ),
    ].map((s) => s.id);
    const nacional = ordem.indexOf("painel-frete-nacional");
    expect(ordem[nacional + 1]).toBe("painel-frete-transportadoras");
    expect(ordem[nacional + 2]).toBe("painel-frete-estrategias-locais");

    const cabecalho = cabecalhoDoPainel("painel-frete-transportadoras");
    expect(cabecalho.textContent).toContain("Transportadoras");
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");

    // A seção não montou: nenhuma segunda leitura, nenhum campo de chave.
    expect(leiturasDeFrete()).toBe(1);
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
  });

  it("F2 — abrir o painel monta o formulário de chave de cada transportadora", async () => {
    await abrirFrete();

    await clicar(cabecalhoDoPainel("painel-frete-transportadoras"));

    expect(
      cabecalhoDoPainel("painel-frete-transportadoras").getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    expect(hospedeiro.querySelectorAll('input[type="password"]')).toHaveLength(
      3,
    );
    expect(botaoComTexto(/Salvar provedores/)).toBeDefined();
    // A seção leu a configuração dela ao montar.
    expect(leiturasDeFrete()).toBe(2);
  });

  it("F3 — fechar e reabrir mantém o token digitado e não lê de novo", async () => {
    await abrirFrete();
    const cabecalho = cabecalhoDoPainel("painel-frete-transportadoras");
    await clicar(cabecalho);

    const campo = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    await act(async () => {
      digitar(campo, "tok-novo");
    });

    await clicar(cabecalho);
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
    // Fechado só esconde: o campo continua montado, com o que foi digitado.
    expect(hospedeiro.contains(campo)).toBe(true);
    expect(campo.value).toBe("tok-novo");

    await clicar(cabecalho);
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");
    const campoDepois = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(campoDepois).toBe(campo);
    expect(campoDepois.value).toBe("tok-novo");
    expect(leiturasDeFrete()).toBe(2);
  });

  it("F4 — token não salvo liga a guarda da tela sem acender o Salvar do cabeçalho; salvar a chave desliga", async () => {
    const onSetDirty = vi.fn();
    await abrirFrete({ onSetDirty });
    expect(onSetDirty).toHaveBeenLastCalledWith(false);

    await clicar(cabecalhoDoPainel("painel-frete-transportadoras"));
    const campo = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    await act(async () => {
      digitar(campo, "tok-novo");
    });
    await drenar();

    expect(onSetDirty).toHaveBeenLastCalledWith(true);
    // O Salvar do cabeçalho grava as regras de frete, não a chave: continua
    // "Salvo" (a chave tem o botão Salvar do próprio cartão).
    expect(botaoComTexto(/^Salvo$/)).toBeDefined();

    const salvarDoCartao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement;
    expect(salvarDoCartao).toBeDefined();
    await clicar(salvarDoCartao);
    await drenar();

    expect(
      invoke.mock.calls.some((c) => c[1]?.body?.action === "save_credentials"),
    ).toBe(true);
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });

  it("F5 — salvar quem está ligado dentro do painel atualiza 'Fora da cidade' na hora", async () => {
    estadoDoBanco.provedores = {
      melhor_envio: { tem_chave: true },
      superfrete: { tem_chave: true, contato_email: "tecnico@loja.com.br" },
    };
    await abrirFrete();
    const nacional = cabecalhoDoPainel("painel-frete-nacional");
    expect(nacional.textContent).toContain("Melhor Envio ligado");

    await clicar(cabecalhoDoPainel("painel-frete-transportadoras"));
    const linhaSF = [...hospedeiro.querySelectorAll("label")].find(
      (l) =>
        /SuperFrete/.test(l.textContent ?? "") &&
        l.querySelector('input[type="checkbox"]'),
    ) as HTMLLabelElement;
    await act(async () => {
      (linhaSF.querySelector('input[type="checkbox"]') as HTMLElement).click();
    });

    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "save_active_providers") {
        estadoDoBanco.ligados = ["melhor_envio", "superfrete"];
        return Promise.resolve({
          data: { success: true, ligados: estadoDoBanco.ligados },
          error: null,
        });
      }
      if (action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaConfig(), error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await clicar(botaoComTexto(/Salvar provedores/) as HTMLButtonElement);
    await drenar();

    // Sem recarregar a tela: o resumo de "Fora da cidade" já conta os dois.
    expect(cabecalhoDoPainel("painel-frete-nacional").textContent).toContain(
      "2 provedores ligados",
    );
  });

  it("F6 — 'Conectar transportadora' e 'Abrir Transportadoras' abrem o painel, sem sair da tela", async () => {
    estadoDoBanco.ligados = [];
    estadoDoBanco.provedores = {};
    const onNavigate = vi.fn();
    await abrirFrete({ onNavigate });

    await clicar(
      botaoComTexto(/conectar transportadora/i) as HTMLButtonElement,
    );
    expect(
      cabecalhoDoPainel("painel-frete-transportadoras").getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    expect(hospedeiro.querySelectorAll('input[type="password"]')).toHaveLength(
      3,
    );

    await clicar(cabecalhoDoPainel("painel-frete-transportadoras"));
    await clicar(botaoComTexto(/abrir transportadoras/i) as HTMLButtonElement);
    expect(
      cabecalhoDoPainel("painel-frete-transportadoras").getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    expect(onNavigate).not.toHaveBeenCalledWith("admin-settings");
    expect(hospedeiro.textContent).not.toMatch(/Abrir Ajustes/);
  });

  it("F7 — 'Consultas de frete' mora sob 'Avançado', junto de 'Etiquetas', e só busca com o painel aberto", async () => {
    await abrirFrete();

    const avancado = [...hospedeiro.querySelectorAll("h2")].find(
      (h) => h.textContent === "Avançado",
    );
    expect(avancado, "título 'Avançado' ausente").toBeDefined();
    const bloco = avancado!.parentElement as HTMLElement;
    expect(bloco.querySelector("#painel-frete-etiquetas")).not.toBeNull();
    expect(bloco.querySelector("#painel-frete-consultas")).not.toBeNull();
    expect(bloco.querySelector("#painel-frete-transportadoras")).toBeNull();

    const consultas = cabecalhoDoPainel("painel-frete-consultas");
    expect(consultas.textContent).toContain("Consultas de frete");
    expect(consultas.getAttribute("aria-expanded")).toBe("false");
    expect(leiturasDoHistorico()).toBe(0);
    expect(hospedeiro.querySelector("#historico-cotacoes-section")).toBeNull();

    await clicar(consultas);
    expect(leiturasDoHistorico()).toBe(1);
    expect(
      hospedeiro.querySelector("#historico-cotacoes-section"),
    ).not.toBeNull();

    // Fechar desmonta; reabrir busca de novo (o histórico é fresco).
    await clicar(consultas);
    expect(hospedeiro.querySelector("#historico-cotacoes-section")).toBeNull();
    await clicar(consultas);
    expect(leiturasDoHistorico()).toBe(2);
  });

  it("F8 — painelInicial='nacional' ainda abre 'Fora da cidade' (e só ele)", async () => {
    await abrirFrete({ painelInicial: "nacional" });
    expect(
      cabecalhoDoPainel("painel-frete-nacional").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      cabecalhoDoPainel("painel-frete-transportadoras").getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    expect(leiturasDeFrete()).toBe(1);
  });
});

describe("Ajustes: só a porta e o subtítulo de 'Entrega e frete'", () => {
  async function renderizarAjustes(active: boolean) {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={active} />);
    });
    await drenar();
  }

  function subtituloDaEntrega(): string | null {
    const secao = [...hospedeiro.querySelectorAll("section")].find(
      (s) => s.querySelector(":scope > h2")?.textContent === "Entrega e frete",
    );
    expect(secao, "grupo 'Entrega e frete' ausente").toBeDefined();
    return secao!.querySelector(":scope > p")?.textContent ?? null;
  }

  it("J1 — não monta Transportadoras nem Consultas de frete; a porta leva ao Frete", async () => {
    await renderizarAjustes(true);

    const cabecalhos = [
      ...hospedeiro.querySelectorAll("button[aria-expanded]"),
    ].map((b) => b.textContent ?? "");
    expect(cabecalhos.some((t) => t.includes("Transportadoras"))).toBe(false);
    expect(cabecalhos.some((t) => t.includes("Consultas de frete"))).toBe(
      false,
    );
    expect(hospedeiro.textContent).not.toContain("Ativo:");
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    expect(hospedeiro.querySelector("#historico-cotacoes-section")).toBeNull();
    expect(leiturasDoHistorico()).toBe(0);
    // Só a leitura do subtítulo.
    expect(leiturasDeFrete()).toBe(1);
    expect(subtituloDaEntrega()).toBe(
      "R$ 10 por entrega · Melhor Envio ligado",
    );
  });

  it("J2 — Ajustes inativo → ativo relê, e o subtítulo acompanha o que foi salvo no Frete", async () => {
    estadoDoBanco.ligados = [];
    estadoDoBanco.provedores = {};
    await renderizarAjustes(true);
    expect(leiturasDeFrete()).toBe(1);
    expect(subtituloDaEntrega()).toBe("R$ 10 por entrega · Sem transportadora");

    // A lojista vai ao Frete e liga o Melhor Envio.
    await renderizarAjustes(false);
    estadoDoBanco.ligados = ["melhor_envio"];
    estadoDoBanco.provedores = { melhor_envio: { tem_chave: true } };
    expect(leiturasDeFrete()).toBe(1);

    await renderizarAjustes(true);
    expect(leiturasDeFrete()).toBe(2);
    expect(subtituloDaEntrega()).toBe(
      "R$ 10 por entrega · Melhor Envio ligado",
    );
  });
});
