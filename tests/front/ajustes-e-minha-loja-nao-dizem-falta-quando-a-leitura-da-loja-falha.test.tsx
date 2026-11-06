// @vitest-environment jsdom
//
// A leitura da configuracao da loja FALHOU e nao ha copia no aparelho
// (`configIndisponivel` do StoreContext): `isLoaded` e true, mas a configuracao
// e a de fabrica. Ajustes escrevia "Falta: Nome e logo, Endereco, WhatsApp" e
// "Falta: CEP da loja" sob os grupos, e Minha loja abria com "Falta preencher:"
// -- afirmando que a lojista nao cadastrou nada. Agora as duas telas nao
// afirmam "falta" nada, avisam "Nao foi possivel carregar os dados da loja" e
// oferecem tentar de novo (releitura SO da configuracao).
//
// Telas de verdade, StoreContext dublado (molde de ajustes-grupos-e-portas e
// minha-loja-contato).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/types";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  refresh: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => h.store,
  TIPO_DAS_COLUNAS_STORE_CONFIG: new Map<string, string>([
    ["store_address", "texto"],
    ["store_city", "texto"],
    ["store_state", "texto"],
    ["origin_cep", "texto"],
    ["store_description", "texto"],
    ["business_hours", "texto"],
  ]),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A configuracao de FABRICA que o contexto deixa quando a leitura falha.
const CONFIG_DE_FABRICA = { storeName: undefined, logoUrl: undefined };

function definirLoja(parcial: Record<string, unknown>) {
  h.store = {
    config: CONFIG_DE_FABRICA,
    isLoaded: true,
    configIndisponivel: false,
    updateConfig: vi.fn(),
    refresh: h.refresh,
    products: [],
    ...parcial,
  };
}

const esperar = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each([
  {
    nome: "Ajustes",
    montar: async (raiz: Root) => {
      const { AdminSettingsView } = await import(
        "@/views/admin/AdminSettingsView"
      );
      await act(async () => {
        raiz.render(
          <AdminSettingsView onNavigate={(_view: View) => {}} active={true} />,
        );
      });
    },
    // O que a tela diz quando a configuracao de fabrica e lida como "vazia".
    textoDeFalta: /Falta:/,
  },
  {
    nome: "Minha loja",
    montar: async (raiz: Root) => {
      const { AdminAboutStoreView } = await import(
        "@/views/admin/AdminAboutStoreView"
      );
      await act(async () => {
        raiz.render(
          <AdminAboutStoreView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
        );
      });
    },
    textoDeFalta: /Falta preencher/,
  },
])("$nome -- quando a leitura da loja falha", ({ montar, textoDeFalta }) => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    pararABuscaDeCep();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.body.className = "";
    vi.unstubAllGlobals();
  });

  async function abrir() {
    await montar(raiz);
    await act(async () => {
      await esperar(50);
    });
  }

  const aviso = () =>
    hospedeiro.querySelector<HTMLElement>("[data-aviso-loja-sem-dados]");

  it("CONTROLE: configuracao de fabrica que o servidor de fato devolveu -- a tela diz o que falta", async () => {
    definirLoja({ configIndisponivel: false });
    await abrir();

    expect(hospedeiro.textContent).toMatch(textoDeFalta);
    expect(aviso()).toBeNull();
  });

  it("leitura FALHOU sem copia: a tela nao afirma que falta nada", async () => {
    definirLoja({ configIndisponivel: true });
    await abrir();

    expect(hospedeiro.textContent).not.toMatch(textoDeFalta);
  });

  it("leitura FALHOU sem copia: avisa que os dados nao carregaram", async () => {
    definirLoja({ configIndisponivel: true });
    await abrir();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(
      "Não foi possível carregar os dados da loja",
    );
  });

  it("o tentar de novo do aviso recarrega SO a configuracao", async () => {
    definirLoja({ configIndisponivel: true });
    await abrir();

    const botao = aviso()?.querySelector("button");
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledWith({ onlyConfig: true });
  });

  it("a configuracao chegou (sinal volta a falso): o aviso some e a tela volta ao normal", async () => {
    definirLoja({ configIndisponivel: true });
    await abrir();
    expect(aviso()).not.toBeNull();

    definirLoja({ configIndisponivel: false });
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await abrir();

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toMatch(textoDeFalta);
  });

  it("StoreContext sem o campo novo (undefined): le como 'nao falhou' e nada muda", async () => {
    definirLoja({ configIndisponivel: undefined });
    await abrir();

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toMatch(textoDeFalta);
  });

  it("ainda carregando (isLoaded false): sem aviso de falha -- 'carregando' nao e 'falhou'", async () => {
    definirLoja({ isLoaded: false, configIndisponivel: false });
    await abrir();

    expect(aviso()).toBeNull();
  });
});
