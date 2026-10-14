// @vitest-environment jsdom
//
// O "Hoje" do Início ficava velho: a lojista abre o app de manhã e vê os números (e a
// data) de ontem até tocar em "Sincronizar", porque a tela só buscava ao ABRIR e só
// recarregava ao voltar a ficar visível se um evento de pedido tivesse chegado enquanto
// estava escondida. Agora, ao voltar a ficar visível, o hook busca de novo quando o
// retrato tem mais de 30 s (FRESCOR_MS) — sem laço e sem chamada dupla com o recarregar
// por evento que já existia.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadasPainel: 0,
  aoMudarPedido: null as null | (() => void),
  // Como o banco responde: "ok", "erro" (resposta com error) ou "rejeita" (a rede cai).
  modo: "ok" as "ok" | "erro" | "rejeita",
  ultimo: null as null | {
    painel: unknown;
    erro: string | null;
    erroAssinatura: string | null;
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } } }),
}));
vi.mock("@/lib/crm", () => ({
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: (_e: unknown, o: string) => `erro ao ${o}`,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      if (nome === "painel_inicio") {
        h.chamadasPainel += 1;
        if (h.modo === "rejeita") return Promise.reject(new Error("rede caiu"));
        if (h.modo === "erro") {
          return Promise.resolve({
            data: null,
            error: { message: "Failed to fetch" },
          });
        }
        return Promise.resolve({
          data: { leitura: h.chamadasPainel },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    channel: vi.fn(() => {
      const canal = {
        on: vi.fn((_tipo: string, _filtro: unknown, aoMudar: () => void) => {
          h.aoMudarPedido = aoMudar;
          return canal;
        }),
        subscribe: vi.fn(() => canal),
      };
      return canal;
    }),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const UMA_HORA_MS = 60 * 60 * 1000;

function definirVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: estado,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("usePainelInicio — voltar a ficar visível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let espiaoDoConsole: { mockRestore: () => void } | undefined;

  async function montar(ativo: boolean) {
    const modulo = await import("@/hooks/usePainelInicio");
    function Sonda() {
      const estado = modulo.usePainelInicio(ativo);
      h.ultimo = {
        painel: estado.painel,
        erro: estado.erro,
        erroAssinatura: estado.erroAssinatura,
      };
      return null;
    }
    await act(async () => raiz.render(createElement(Sonda)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.chamadasPainel = 0;
    h.aoMudarPedido = null;
    h.modo = "ok";
    h.ultimo = null;
    // O hook registra a falha no console; o teste provoca falhas de propósito.
    espiaoDoConsole = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    espiaoDoConsole?.mockRestore();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("controle: abre ativo e busca uma vez", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);
  });

  it("escondida 8 horas SEM evento de pedido: ao voltar, recarrega (uma vez)", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);

    definirVisibilidade("hidden");
    await passar(8 * UMA_HORA_MS);
    definirVisibilidade("visible");
    await passar(5000);

    expect(h.chamadasPainel).toBe(2);
  });

  it("escondida só 10 segundos: ao voltar, NÃO recarrega (o retrato ainda é fresco)", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);

    definirVisibilidade("hidden");
    await passar(10_000);
    definirVisibilidade("visible");
    await passar(5000);

    expect(h.chamadasPainel).toBe(1);
  });

  it("evento de pedido enquanto escondida: ao voltar, recarrega UMA vez só (sem chamada dupla)", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);

    definirVisibilidade("hidden");
    expect(h.aoMudarPedido).not.toBeNull();
    h.aoMudarPedido?.();
    await passar(8 * UMA_HORA_MS);
    definirVisibilidade("visible");
    await passar(5000);

    expect(h.chamadasPainel).toBe(2);
  });

  it("evento de pedido enquanto escondida por 10 s: continua recarregando (a recarga por evento não depende do frescor)", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);

    definirVisibilidade("hidden");
    h.aoMudarPedido?.();
    await passar(10_000);
    definirVisibilidade("visible");
    await passar(5000);

    expect(h.chamadasPainel).toBe(2);
  });

  it("voltar a ficar visível várias vezes seguidas busca uma vez só (sem laço)", async () => {
    await montar(true);
    definirVisibilidade("hidden");
    await passar(8 * UMA_HORA_MS);
    definirVisibilidade("visible");
    definirVisibilidade("visible");
    definirVisibilidade("visible");
    await passar(5000);
    expect(h.chamadasPainel).toBe(2);

    // E, passados os 5 s, o retrato novo é fresco: outra volta rápida não busca.
    definirVisibilidade("hidden");
    await passar(5000);
    definirVisibilidade("visible");
    await passar(5000);
    expect(h.chamadasPainel).toBe(2);
  });

  it("tela inativa (atrás de outra aba) não busca, nem ao voltar a ficar visível", async () => {
    await montar(false);
    expect(h.chamadasPainel).toBe(0);

    definirVisibilidade("hidden");
    await passar(8 * UMA_HORA_MS);
    definirVisibilidade("visible");
    await passar(5000);

    expect(h.chamadasPainel).toBe(0);
    expect(h.aoMudarPedido).toBeNull();
  });

  it("esconder a tela (hidden) com o retrato velho NÃO busca: só voltar a ficar visível busca", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);

    await passar(UMA_HORA_MS); // o retrato fica velho com a tela visível
    definirVisibilidade("hidden");
    await passar(5000);

    expect(h.chamadasPainel).toBe(1);
  });

  it("evento de pedido com a tela visível (recarga marcada) e um esconde-e-volta antes dela: uma busca a mais, não duas", async () => {
    await montar(true);
    expect(h.chamadasPainel).toBe(1);

    await passar(40_000); // retrato com mais de 30 s
    expect(h.aoMudarPedido).not.toBeNull();
    h.aoMudarPedido?.(); // recarga por evento marcada para daqui a 1,5 s
    await passar(200);
    definirVisibilidade("hidden");
    definirVisibilidade("visible"); // volta antes de a recarga marcada rodar
    await passar(5000);

    expect(h.chamadasPainel).toBe(2);
  });

  describe("busca que falha ao voltar a ficar visível", () => {
    it.each(["erro", "rejeita"] as const)(
      "com retrato velho em mãos (falha por %s): leitura silenciosa, sem erro por cima dos números",
      async (modo) => {
        await montar(true);
        expect(h.ultimo?.painel).toEqual({ leitura: 1 });
        expect(h.ultimo?.erro).toBeNull();

        h.modo = modo; // o celular ainda não reconectou
        definirVisibilidade("hidden");
        await passar(8 * UMA_HORA_MS);
        definirVisibilidade("visible");
        await passar(5000);

        expect(h.chamadasPainel).toBe(2); // tentou
        expect(h.ultimo?.erro).toBeNull();
        expect(h.ultimo?.erroAssinatura).toBeNull();
        expect(h.ultimo?.painel).toEqual({ leitura: 1 }); // números de antes seguem
      },
    );

    it("a falha silenciosa não vira retrato fresco: a próxima volta tenta de novo e, com rede, atualiza", async () => {
      await montar(true);
      h.modo = "erro";
      definirVisibilidade("hidden");
      await passar(8 * UMA_HORA_MS);
      definirVisibilidade("visible");
      await passar(5000);
      expect(h.chamadasPainel).toBe(2);

      h.modo = "ok";
      definirVisibilidade("hidden");
      definirVisibilidade("visible");
      await passar(5000);

      expect(h.chamadasPainel).toBe(3);
      expect(h.ultimo?.painel).toEqual({ leitura: 3 });
      expect(h.ultimo?.erro).toBeNull();
    });

    it("sem nada em cache, a falha continua mostrando o erro (comportamento de antes)", async () => {
      h.modo = "erro";
      await montar(true);

      expect(h.chamadasPainel).toBe(1);
      expect(h.ultimo?.painel).toBeNull();
      expect(h.ultimo?.erro).toContain("erro ao");
    });
  });
});
