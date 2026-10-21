// @vitest-environment jsdom
//
// Ajustes liga os dois lados do aviso "transportadora sem pagamento pelo app"
// (14/10/2026): é aqui que mora o botão Pausar, e é daqui que o painel de Frete
// fica sabendo o estado REAL do pagamento pelo app.
//
//   S1  com transportadora vendendo, Pausar abre o aviso e NÃO pausa;
//   S2  sem transportadora ligada, Pausar pausa direto (nenhum ruído);
//   S3  loja que atende SÓ a cidade: a transportadora não vende, Pausar direto;
//   S4  o que o servidor devolveu (o `ler` ao abrir a seção, e depois o Pausar)
//       vira o estado do painel que a tela de Frete lê — o eco que evita aviso
//       falso por retrato velho do boot.
//
// Padrão do vizinho admin-settings-pix-acompanha-o-interruptor.test.tsx:
// createRoot + act, a edge é DUBLÊ, as chaves são FALSAS de mentira.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

type Chamada = { nome: string; corpo: Record<string, unknown> };
const chamadas: Chamada[] = [];

const { invokeFalso, cenario, mockFlags, mockChave, mockConfig } = vi.hoisted(
  () => ({
    invokeFalso: vi.fn(),
    cenario: {
      salvo: {} as Record<string, unknown>,
      respostaDesligar: {} as Record<string, unknown>,
      ligadosDeFrete: ["melhor_envio"] as string[],
    },
    mockFlags: { pagamentoOnlineLigado: vi.fn(() => false) },
    mockChave: {
      chavePublicaMercadoPago: vi.fn((): string | null => PUBLICA_FALSA),
    },
    mockConfig: { shippingCoverage: "national" as "local" | "national" },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(
  async (
    nome: string,
    opcoes: { body?: Record<string, unknown> & { action?: string } },
  ) => {
    const corpo = opcoes?.body ?? {};
    chamadas.push({ nome, corpo });
    if (corpo.action === "ler_configuracao_frete") {
      return {
        data: {
          success: true,
          modo: "multi",
          ligados: cenario.ligadosDeFrete,
          provedores: {
            melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
            superfrete: { tem_chave: false, sandbox: false, servicos: null },
            frenet: { tem_chave: false, sandbox: false, servicos: null },
          },
        },
        error: null,
      };
    }
    if (corpo.acao === "ler") return { data: cenario.salvo, error: null };
    if (corpo.acao === "desligar_pix")
      return { data: cenario.respostaDesligar, error: null };
    return { data: null, error: null };
  },
);

vi.mock("@/lib/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));
vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  chavePublicaMercadoPago: mockChave.chavePublicaMercadoPago,
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
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
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  esquecerEcoDoPagamentoPeloApp,
  pagamentoPeloAppAgora,
} from "@/lib/pagamento-pelo-app-no-painel";

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CONFIGURADO_RECEBENDO = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: null,
  ultimo_teste: {
    quando: new Date().toISOString(),
    conectado: true,
    mensagem: "Conectado!",
    ambiente: "producao",
    conta: "Loja Teste",
  } as unknown,
  atualizado_em: new Date().toISOString(),
  pix_ligado: true,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

describe("Ajustes — Pausar avisa da transportadora e conta ao Frete o estado do pagamento", () => {
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
    esquecerEcoDoPagamentoPeloApp();
    chamadas.length = 0;
    cenario.salvo = { ...CONFIGURADO_RECEBENDO };
    cenario.respostaDesligar = {
      pix_ligado: false,
      pausado: true,
      faltando: [],
      public_key_na_loja: true,
    };
    cenario.ligadosDeFrete = ["melhor_envio"];
    mockConfig.shippingCoverage = "national";
    mockFlags.pagamentoOnlineLigado.mockReturnValue(false);
    mockChave.chavePublicaMercadoPago.mockReturnValue(PUBLICA_FALSA);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    esquecerEcoDoPagamentoPeloApp();
    vi.unstubAllGlobals();
  });

  async function assentar() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  function botaoPorTexto(trecho: string): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    );
    if (!botao) throw new Error(`Botão "${trecho}" não está na tela.`);
    return botao as HTMLButtonElement;
  }

  function botaoExato(texto: string): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
    return botao as HTMLButtonElement;
  }

  async function clicar(elemento: HTMLElement) {
    await act(async () => {
      elemento.click();
    });
    await assentar();
  }

  async function abrirAjustesNoMercadoPago() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await assentar();
    await clicar(botaoPorTexto("Mercado Pago"));
    // A seção é lazy: 10 ms não garantem que o primeiro import e a leitura
    // terminaram. Aguarde o controle real, sem alterar a regra do pagamento.
    await vi.waitFor(
      async () => {
        await assentar();
        expect(botaoExato("Pausar").disabled).toBe(false);
      },
      { timeout: 5000 },
    );
  }

  const pausouNaEdge = () =>
    chamadas.some((c) => c.corpo.acao === "desligar_pix");
  const aviso = () =>
    hospedeiro.querySelector("[data-aviso-pausar-sem-transportadora]");

  it("S1 — com transportadora vendendo, Pausar abre o aviso e NÃO pausa", async () => {
    await abrirAjustesNoMercadoPago();

    await clicar(botaoExato("Pausar"));

    expect(aviso()).not.toBeNull();
    expect(pausouNaEdge()).toBe(false);
  });

  it("S2 — sem transportadora ligada, Pausar pausa direto", async () => {
    cenario.ligadosDeFrete = [];
    await abrirAjustesNoMercadoPago();

    await clicar(botaoExato("Pausar"));

    expect(aviso()).toBeNull();
    expect(pausouNaEdge()).toBe(true);
  });

  it("S3 — loja que atende SÓ a cidade: a transportadora não vende, Pausar pausa direto", async () => {
    mockConfig.shippingCoverage = "local";
    await abrirAjustesNoMercadoPago();

    await clicar(botaoExato("Pausar"));

    expect(aviso()).toBeNull();
    expect(pausouNaEdge()).toBe(true);
  });

  it("S4 — o `ler` ao abrir a seção e o Pausar viram o estado que a tela de Frete lê", async () => {
    // Boot diz "desligado"; o servidor diz "ligado" (o `ler`).
    mockFlags.pagamentoOnlineLigado.mockReturnValue(false);
    await abrirAjustesNoMercadoPago();
    expect(pagamentoPeloAppAgora()).toBe(true);

    // Pausar de verdade (confirmando o aviso) → servidor devolve desligado.
    await clicar(botaoExato("Pausar"));
    await clicar(botaoExato("Pausar mesmo assim"));
    expect(pausouNaEdge()).toBe(true);
    expect(pagamentoPeloAppAgora()).toBe(false);
  });
});
