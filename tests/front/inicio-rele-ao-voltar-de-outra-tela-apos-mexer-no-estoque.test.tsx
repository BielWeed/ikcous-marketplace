// @vitest-environment jsdom
//
// DEPOIS DE REPOR O ESTOQUE, O INÍCIO NÃO PODE REPETIR O NÚMERO ANTIGO.
//
// O Início guarda o último retrato por 30 s (cache de módulo). A lojista abre o
// Início, vê "3 produtos com estoque baixo", vai a Produtos, repõe o estoque e
// volta em segundos: o retrato ainda era "fresco" e o número antigo ficava na
// tela até chegar um pedido novo. Agora, sair do Início faz o retrato deixar de
// contar como fresco: ele continua na tela, mas a volta busca de novo.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadasPainel: 0,
  ultimo: null as null | { painel: unknown; carregando: boolean },
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
        return Promise.resolve({
          data: { leitura: h.chamadasPainel },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    channel: vi.fn(() => {
      const canal = {
        on: vi.fn(() => canal),
        subscribe: vi.fn(() => canal),
      };
      return canal;
    }),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("usePainelInicio: voltar ao Início depois de passar por outra tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let espiaoDoConsole: { mockRestore: () => void } | undefined;
  let Sonda: (props: { ativo: boolean }) => null;

  async function desenhar(ativo: boolean) {
    await act(async () => raiz.render(createElement(Sonda, { ativo })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Meio-dia em São Paulo, fixo: o hook também recarrega quando o DIA muda.
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    h.chamadasPainel = 0;
    h.ultimo = null;
    espiaoDoConsole = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const modulo = await import("@/hooks/usePainelInicio");
    Sonda = function SondaDoPainel({ ativo }: { ativo: boolean }) {
      const estado = modulo.usePainelInicio(ativo);
      h.ultimo = { painel: estado.painel, carregando: estado.carregando };
      return null;
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    espiaoDoConsole?.mockRestore();
  });

  it("controle: abre ativo e busca uma vez", async () => {
    await desenhar(true);
    expect(h.chamadasPainel).toBe(1);
    expect(h.ultimo?.painel).toEqual({ leitura: 1 });
  });

  it("sai do Início e volta em segundos: busca de novo e mostra o número novo", async () => {
    await desenhar(true);
    expect(h.chamadasPainel).toBe(1);

    await desenhar(false); // foi a Produtos repor o estoque
    // O retrato antigo continua na tela enquanto a leitura nova não chega.
    expect(h.ultimo?.painel).toEqual({ leitura: 1 });

    await desenhar(true); // voltou, 1 s depois: dentro dos 30 s do cache
    expect(h.chamadasPainel).toBe(2);
    expect(h.ultimo?.painel).toEqual({ leitura: 2 });
  });

  it("depois da busca nova o retrato volta a ser fresco: ficar no Início não busca mais", async () => {
    await desenhar(true);
    await desenhar(false);
    await desenhar(true);
    expect(h.chamadasPainel).toBe(2);

    // Mesma tela, sem sair: nada de busca extra por ter reposto o cache.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.chamadasPainel).toBe(2);
  });
});
