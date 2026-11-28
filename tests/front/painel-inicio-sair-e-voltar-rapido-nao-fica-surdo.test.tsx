// @vitest-environment jsdom
//
// Mesmo defeito da bolinha do painel, no Início: sair da tela tirava o canal
// "admin-inicio-pedidos" sem esperar a saída, e voltar logo em seguida pegava
// o canal ANTIGO (o realtime-js devolve o de mesmo nome que ainda está na
// lista), cujo `.subscribe()` não faz nada. Confirmada a saída, ninguém ouvia
// os pedidos: os números do Início paravam até a próxima entrada na tela.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadas: 0,
  tempoReal: null as null | ReturnType<
    typeof import("./fixtures/tempo-real-fiel").criarTempoRealFiel
  >,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-fixture" } } }),
}));
vi.mock("@/lib/crm", () => ({
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: () => "Falha de leitura",
}));
vi.mock("@/lib/supabase", async () => {
  const { criarTempoRealFiel } = await import("./fixtures/tempo-real-fiel");
  h.tempoReal = criarTempoRealFiel();
  return {
    supabase: {
      rpc: (nome: string) =>
        Promise.resolve({
          data: nome === "painel_inicio" ? { total: ++h.chamadas } : null,
          error: null,
        }),
      channel: (nome: string) => h.tempoReal!.channel(nome),
      removeChannel: (canal: any) => h.tempoReal!.removeChannel(canal),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Início — sair e voltar rápido não deixa os números surdos", () => {
  let raiz: Root;
  let div: HTMLDivElement;
  let Sonda: (props: { ativo: boolean }) => null;

  async function passar(ms = 2000) {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    h.chamadas = 0;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    div = document.createElement("div");
    document.body.appendChild(div);
    raiz = createRoot(div);
    const { usePainelInicio } = await import("@/hooks/usePainelInicio");
    Sonda = ({ ativo }) => {
      const estado = usePainelInicio(ativo);
      useEffect(() => {
        void estado;
      });
      return null;
    };
  });

  afterEach(() => {
    act(() => raiz.unmount());
    div.remove();
    vi.useRealTimers();
  });

  it("voltou à tela antes de o servidor confirmar a saída: o canal volta a ouvir e um pedido relê os números", async () => {
    await act(async () => raiz.render(<Sonda ativo />));
    await passar(250);
    const tempoReal = h.tempoReal!;
    expect(tempoReal.juntados("admin-inicio-pedidos")).toHaveLength(1);

    await act(async () => raiz.render(<Sonda ativo={false} />));
    await act(async () => raiz.render(<Sonda ativo />));
    await act(async () => {
      tempoReal.confirmarSaidas();
    });
    await passar();

    expect(tempoReal.juntados("admin-inicio-pedidos")).toHaveLength(1);
    const antes = h.chamadas;
    await act(async () => {
      tempoReal.emitir("marketplace_orders");
    });
    await passar();
    expect(h.chamadas).toBeGreaterThan(antes);
  });
});
