// @vitest-environment jsdom
//
// A leitura da configuracao da loja FALHOU e nao ha copia no aparelho
// (`configIndisponivel`): a tela mostra a configuracao de FABRICA. Gravar a
// partir dela apagaria os dados reais:
//   - Minha loja manda os tres campos da identidade legal juntos (razao social
//     e CNPJ vazios na tela sobrescreveriam os verdadeiros);
//   - Formas de pagamento parte da lista de fabrica e um toque grava a lista
//     toda derivada dela.
// Enquanto o sinal esta ligado, os campos e interruptores ficam travados; o
// aviso e o "Tentar de novo" seguem ativos. Com o sinal desligado, nada muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/types";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  refresh: vi.fn(),
  updateConfig: vi.fn(),
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
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
  lerChaveSupabase: () => "sb_publishable_synthetic",
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

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CONFIG_DE_FABRICA = {
  storeName: undefined,
  logoUrl: undefined,
  formasPagamentoEntrega: ["pix", "card", "cash"],
};

function definirLoja(parcial: Record<string, unknown>) {
  h.store = {
    config: CONFIG_DE_FABRICA,
    isLoaded: true,
    configIndisponivel: false,
    updateConfig: h.updateConfig,
    refresh: h.refresh,
    products: [],
    ...parcial,
  };
}

const esperar = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("leitura da loja falhou: nada de gravar por cima dos dados reais", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfig.mockResolvedValue(true);
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

  describe("Minha loja", () => {
    async function abrir() {
      const { AdminAboutStoreView } = await import(
        "@/views/admin/AdminAboutStoreView"
      );
      await act(async () => {
        raiz.render(
          <AdminAboutStoreView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
        );
      });
      await act(async () => {
        await esperar(50);
      });
    }

    const formulario = () => hospedeiro.querySelector("fieldset");
    const botaoDoAviso = () =>
      hospedeiro.querySelector<HTMLButtonElement>(
        "[data-aviso-loja-sem-dados] button",
      );

    it("com o sinal ligado: o formulario inteiro fica travado (nenhum campo editavel)", async () => {
      definirLoja({ configIndisponivel: true });
      await abrir();

      expect(formulario()?.disabled).toBe(true);
      const campos = [
        ...(formulario()?.querySelectorAll<HTMLInputElement>(
          "input, textarea, select",
        ) ?? []),
      ];
      expect(campos.length).toBeGreaterThan(0);
      for (const campo of campos) {
        expect(campo.matches(":disabled"), campo.id || campo.name).toBe(true);
      }
    });

    it("com o sinal ligado: o aviso e o 'Tentar de novo' continuam ativos, FORA do formulario travado", async () => {
      definirLoja({ configIndisponivel: true });
      await abrir();

      const botao = botaoDoAviso();
      expect(botao).toBeTruthy();
      expect(botao?.matches(":disabled")).toBe(false);
      expect(botao?.closest("fieldset")).toBeNull();
      await act(async () => {
        botao?.click();
      });
      expect(h.refresh).toHaveBeenCalledWith({ onlyConfig: true });
    });

    it("com o sinal ligado: nenhuma gravacao acontece", async () => {
      definirLoja({ configIndisponivel: true });
      await abrir();

      const salvar = hospedeiro.querySelector<HTMLButtonElement>(
        '[aria-label="Ações de Minha loja"] button',
      );
      await act(async () => {
        salvar?.click();
        await esperar(20);
      });
      expect(h.updateConfig).not.toHaveBeenCalled();
    });

    async function digitarEmailDaEmpresa(valor: string) {
      const campo = hospedeiro.querySelector<HTMLInputElement>(
        "#empresa-email",
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      await act(async () => {
        campo.focus();
        setter?.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        await esperar(500);
      });
    }

    // Re-render com uma funcao nova: a tela e `memo`, e o dublê do contexto nao
    // avisa sozinho quando o sinal muda.
    async function rerenderizar() {
      const { AdminAboutStoreView } = await import(
        "@/views/admin/AdminAboutStoreView"
      );
      await act(async () => {
        raiz.render(
          <AdminAboutStoreView onNavigate={() => {}} onSetDirty={() => {}} />,
        );
        await esperar(20);
      });
    }

    const botaoSalvar = () =>
      hospedeiro.querySelector<HTMLButtonElement>(
        '[aria-label="Ações de Minha loja"] button',
      ) as HTMLButtonElement;

    it("CONTROLE: com o sinal desligado, uma alteracao pendente e gravada como hoje", async () => {
      definirLoja({ configIndisponivel: false });
      await abrir();
      await digitarEmailDaEmpresa("loja@exemplo.com");

      expect(botaoSalvar().getAttribute("aria-disabled")).toBe("false");
      await act(async () => {
        botaoSalvar().click();
        await esperar(50);
      });
      expect(h.updateConfig).toHaveBeenCalledTimes(1);
    });

    it("alteracao pendente e a leitura FALHA depois: o botao Salvar trava e nada e gravado (razao social e CNPJ vazios nao vao por cima)", async () => {
      definirLoja({ configIndisponivel: false });
      await abrir();
      await digitarEmailDaEmpresa("loja@exemplo.com");
      expect(botaoSalvar().getAttribute("aria-disabled")).toBe("false");

      definirLoja({ configIndisponivel: true });
      await rerenderizar();

      expect(botaoSalvar().getAttribute("aria-disabled")).toBe("true");
      await act(async () => {
        botaoSalvar().click();
        await esperar(50);
      });
      expect(h.updateConfig).not.toHaveBeenCalled();
    });

    it("com o sinal desligado: o formulario fica editavel e nao ha aviso", async () => {
      definirLoja({ configIndisponivel: false });
      await abrir();

      expect(formulario()?.disabled).toBe(false);
      expect(botaoDoAviso()).toBeNull();
    });
  });

  describe("Ajustes - Formas de pagamento", () => {
    async function abrirAsFormas() {
      const { AdminSettingsView } = await import(
        "@/views/admin/AdminSettingsView"
      );
      await act(async () => {
        raiz.render(
          <AdminSettingsView
            onNavigate={vi.fn() as unknown as (view: View) => void}
            active={true}
          />,
        );
      });
      await act(async () => {
        await esperar(10);
      });
      const cabecalho = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Formas de pagamento"),
      );
      if (!cabecalho) throw new Error("Cabecalho das formas nao esta na tela");
      await act(async () => {
        cabecalho.click();
        await esperar(10);
      });
    }

    const interruptor = (rotulo: string) =>
      hospedeiro.querySelector<HTMLButtonElement>(
        `[role="switch"][aria-label="${rotulo}"]`,
      );
    const ROTULOS = [
      "Pix na entrega ou retirada",
      "Cartão na entrega ou retirada",
      "Dinheiro na entrega ou retirada",
    ];

    it("com o sinal ligado: os tres interruptores ficam travados e um toque nao grava a lista de fabrica", async () => {
      definirLoja({ configIndisponivel: true });
      await abrirAsFormas();

      for (const rotulo of ROTULOS) {
        const chave = interruptor(rotulo);
        expect(chave, rotulo).toBeTruthy();
        expect(chave?.disabled, rotulo).toBe(true);
      }
      await act(async () => {
        interruptor(ROTULOS[1])?.click();
        await esperar(10);
      });
      expect(h.updateConfig).not.toHaveBeenCalled();
    });

    it("com o sinal ligado: o aviso com 'Tentar de novo' segue ativo", async () => {
      definirLoja({ configIndisponivel: true });
      await abrirAsFormas();

      const botao = hospedeiro.querySelector<HTMLButtonElement>(
        "[data-aviso-loja-sem-dados] button",
      );
      expect(botao?.matches(":disabled")).toBe(false);
    });

    it("com o sinal desligado: os interruptores funcionam como antes", async () => {
      definirLoja({ configIndisponivel: false });
      await abrirAsFormas();

      expect(interruptor(ROTULOS[1])?.disabled).toBe(false);
      await act(async () => {
        interruptor(ROTULOS[1])?.click();
        await esperar(10);
      });
      expect(h.updateConfig).toHaveBeenCalledTimes(1);
      expect(h.updateConfig.mock.calls[0][0]).toEqual({
        formasPagamentoEntrega: ["pix", "cash"],
      });
    });
  });
});
