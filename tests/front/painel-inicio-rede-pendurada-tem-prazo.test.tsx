// @vitest-environment jsdom
//
// Rede que conecta e não responde (3G fraco, troca de Wi-Fi para 4G, portal de
// Wi-Fi): a busca do Início (`painel_inicio` + `assinatura_da_loja_ler`) saía e
// não voltava. Ela fica guardada como "busca em voo" e TODA chamada nova
// (Sincronizar, voltar ao Início, aviso de conexão restabelecida) entrava na
// fila atrás dela — o Início ficava em esqueleto, com o botão girando e
// desabilitado, sem erro e sem "Tentar de novo", até o navegador desistir da
// requisição (minutos).
//
// Agora a busca tem prazo (20 s): estourou, vira o erro de sempre (com "Tentar
// de novo" na tela) e a próxima busca sai limpa. Resposta que chegar DEPOIS do
// prazo é descartada: não sobrescreve o retrato mais novo.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  // Cada chamada de `painel_inicio` entra aqui; o teste decide se e quando responder.
  painel: [] as Array<(r: unknown) => void>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } } }),
}));

// A frase de erro é a REAL (a que a lojista lê); só os leitores de payload são dublês.
vi.mock("@/lib/crm", async () => {
  const real = await import("@/lib/erro-do-painel");
  return {
    lerPainelInicio: (d: unknown) => d,
    lerAssinaturaDaLoja: (d: unknown) => d,
    mensagemDeErroDoPainel: real.mensagemDeErroDoPainel,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      if (nome === "painel_inicio") {
        return new Promise((resolve) => {
          h.painel.push((data) => resolve({ data, error: null }));
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_MS = 20_000;

describe("usePainelInicio — rede pendurada não prende o Início", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.painel.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function montar() {
    const mod = await import("@/hooks/usePainelInicio");
    const saida: { atual: ReturnType<typeof mod.usePainelInicio> | null } = {
      atual: null,
    };
    function Sonda() {
      const estado = mod.usePainelInicio(false);
      useEffect(() => {
        saida.atual = estado;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    return { saida };
  }

  const passar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("busca que nunca volta: antes do prazo segue carregando; no prazo vira erro em português, sem 'carregando'", async () => {
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS - 1000);
    expect(h.painel).toHaveLength(1);
    expect(saida.atual?.carregando).toBe(true);
    expect(saida.atual?.erro).toBeNull();

    await passar(1500);

    expect(saida.atual?.carregando).toBe(false);
    expect(saida.atual?.painel).toBeNull();
    expect(saida.atual?.erro).toBe(
      "Não foi possível carregar o Início agora. Tente de novo em instantes.",
    );
    // Nada de texto técnico do prazo na tela.
    expect(saida.atual?.erro).not.toMatch(/prazo|ms|esgotad/i);
  });

  it("depois do prazo, atualizar() sai com busca NOVA (não entra na fila da pendurada) e destrava o Início", async () => {
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS + 500);
    expect(saida.atual?.erro).not.toBeNull();
    expect(h.painel).toHaveLength(1);

    // A rede voltou: a lojista toca em Sincronizar / "Tentar de novo".
    let terminou = false;
    await act(async () => {
      void saida.atual?.atualizar().then(() => {
        terminou = true;
      });
    });
    expect(h.painel).toHaveLength(2); // saiu na hora, sem esperar a pendurada
    expect(saida.atual?.carregando).toBe(true);

    await act(async () => {
      h.painel[1]({ total: 7 });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(terminou).toBe(true);
    expect(saida.atual?.carregando).toBe(false);
    expect(saida.atual?.erro).toBeNull();
    expect(saida.atual?.painel).toEqual({ total: 7 });
  });

  it("recarga forçada pedida DURANTE a busca pendurada não fica presa para sempre: sai uma busca nova quando o prazo corta a velha", async () => {
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(5000);
    // Sincronizar com a busca ainda em voo: entra na fila atrás dela.
    let forcadaTerminou = false;
    await act(async () => {
      void saida.atual?.atualizar().then(() => {
        forcadaTerminou = true;
      });
    });
    expect(h.painel).toHaveLength(1);

    await passar(PRAZO_MS - 5000 + 500); // o prazo da primeira estoura
    expect(h.painel).toHaveLength(2); // a forçada seguiu em frente

    await act(async () => {
      h.painel[1]({ total: 3 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(forcadaTerminou).toBe(true);
    expect(saida.atual?.painel).toEqual({ total: 3 });
    expect(saida.atual?.erro).toBeNull();
  });

  it("resposta que chega DEPOIS do prazo é descartada: não sobrescreve o retrato mais novo", async () => {
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS + 500);
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await act(async () => {
      h.painel[1]({ total: 2 }); // a busca nova responde
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saida.atual?.painel).toEqual({ total: 2 });

    // A busca pendurada, enfim, responde com números ANTIGOS.
    await act(async () => {
      h.painel[0]({ total: 1 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saida.atual?.painel).toEqual({ total: 2 });

    // E uma leitura seguinte ainda vê o retrato novo (cache não foi pisado).
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await act(async () => {
      h.painel[2]({ total: 4 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saida.atual?.painel).toEqual({ total: 4 });
  });

  it("controle: busca que responde dentro do prazo não vira erro nem depois que o prazo passaria", async () => {
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(3000);
    await act(async () => {
      h.painel[0]({ total: 9 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saida.atual?.painel).toEqual({ total: 9 });

    await passar(PRAZO_MS * 2); // o relógio do prazo foi desarmado
    expect(saida.atual?.erro).toBeNull();
    expect(saida.atual?.painel).toEqual({ total: 9 });
  });
});
