// @vitest-environment jsdom
//
// O Início do painel lê DUAS coisas ao mesmo tempo: os números de hoje
// (`painel_inicio`) e a assinatura (`assinatura_da_loja_ler`). O prazo de 20 s
// era um só, por cima das duas: se SÓ a assinatura ficasse pendurada (a outra
// respondia em 300 ms: R$ 850 hoje, 4 vendas, 2 pedidos para preparar), o prazo
// estourava e a tela inteira virava erro — os números que tinham chegado certos
// sumiam por causa da assinatura, e "Tentar de novo" repetia as duas leituras.
//
// Agora o prazo vale POR leitura: a que estoura vira o erro DELA e a outra
// continua valendo.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  // Cada chamada entra aqui; o teste decide se e quando responder.
  painel: [] as Array<(r: { data: unknown; error: unknown }) => void>,
  assinatura: [] as Array<(r: { data: unknown; error: unknown }) => void>,
  // "imediato" responde na hora (com `dados`); "pendurado" só quando o teste mandar.
  modoPainel: "imediato" as "imediato" | "pendurado",
  modoAssinatura: "imediato" as "imediato" | "pendurado",
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

const NUMEROS = { vendasHoje: 850, pedidosHoje: 4, aPrepararCount: 2 };
const ASSINATURA = { plano: "Plano de teste", situacao: "ativa" };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      const ehPainel = nome === "painel_inicio";
      const modo = ehPainel ? h.modoPainel : h.modoAssinatura;
      const fila = ehPainel ? h.painel : h.assinatura;
      const dados = ehPainel
        ? { vendasHoje: 850, pedidosHoje: 4, aPrepararCount: 2 }
        : { plano: "Plano de teste", situacao: "ativa" };
      return new Promise<Resposta>((resolve) => {
        if (modo === "imediato") resolve({ data: dados, error: null });
        else fila.push((r) => resolve(r));
      });
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

describe("usePainelInicio — leitura pendurada não apaga o que a outra trouxe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.painel.length = 0;
    h.assinatura.length = 0;
    h.modoPainel = "imediato";
    h.modoAssinatura = "imediato";
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

  it("só a assinatura pendurada: no prazo os números de hoje aparecem e o erro é só o da assinatura", async () => {
    h.modoAssinatura = "pendurado";
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    // Antes do prazo ainda espera as duas leituras.
    await passar(PRAZO_MS - 1000);
    expect(saida.atual?.carregando).toBe(true);
    expect(saida.atual?.painel).toBeNull();

    await passar(1500);

    expect(saida.atual?.carregando).toBe(false);
    expect(saida.atual?.painel).toEqual(NUMEROS);
    expect(saida.atual?.erro).toBeNull();
    expect(saida.atual?.assinaturaLida).toBe(false);
    expect(saida.atual?.assinatura).toBeNull();
    expect(saida.atual?.erroAssinatura).toBe(
      "Não foi possível ler a assinatura agora. Tente de novo em instantes.",
    );
    // Nada de texto técnico do prazo na tela.
    expect(saida.atual?.erroAssinatura).not.toMatch(/prazo|ms|esgotad/i);
  });

  it("só o painel pendurado: os números têm o erro deles e a assinatura segue valendo", async () => {
    h.modoPainel = "pendurado";
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS + 500);

    expect(saida.atual?.carregando).toBe(false);
    expect(saida.atual?.painel).toBeNull();
    expect(saida.atual?.erro).toBe(
      "Não foi possível carregar os números da loja agora. Tente de novo em instantes.",
    );
    expect(saida.atual?.erro).not.toMatch(/prazo|ms|esgotad/i);
    expect(saida.atual?.assinaturaLida).toBe(true);
    expect(saida.atual?.assinatura).toEqual(ASSINATURA);
    expect(saida.atual?.erroAssinatura).toBeNull();
  });

  it("as duas penduradas: erro geral, sem 'carregando' e sem texto técnico", async () => {
    h.modoPainel = "pendurado";
    h.modoAssinatura = "pendurado";
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS + 500);

    expect(saida.atual?.carregando).toBe(false);
    expect(saida.atual?.painel).toBeNull();
    expect(saida.atual?.erro).not.toBeNull();
    expect(saida.atual?.erro).not.toMatch(/prazo|ms|esgotad/i);
    expect(saida.atual?.assinaturaLida).toBe(false);
    expect(saida.atual?.erroAssinatura).not.toBeNull();
  });

  it("controle: as duas respondem cedo — tudo completo, sem erro, e o prazo não vira erro depois", async () => {
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(300);

    expect(saida.atual?.painel).toEqual(NUMEROS);
    expect(saida.atual?.assinatura).toEqual(ASSINATURA);
    expect(saida.atual?.assinaturaLida).toBe(true);
    expect(saida.atual?.erro).toBeNull();
    expect(saida.atual?.erroAssinatura).toBeNull();

    await passar(PRAZO_MS * 2); // os relógios do prazo foram desarmados
    expect(saida.atual?.painel).toEqual(NUMEROS);
    expect(saida.atual?.erro).toBeNull();
    expect(saida.atual?.erroAssinatura).toBeNull();
  });

  it("'Tentar de novo' depois da assinatura pendurada refaz a busca; se a assinatura responder, fica tudo completo", async () => {
    h.modoAssinatura = "pendurado";
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS + 500);
    expect(saida.atual?.painel).toEqual(NUMEROS);
    expect(saida.atual?.erroAssinatura).not.toBeNull();
    expect(h.assinatura).toHaveLength(1);

    // A rede voltou: a lojista toca em "Tentar de novo".
    h.modoAssinatura = "imediato";
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(300);

    expect(saida.atual?.painel).toEqual(NUMEROS);
    expect(saida.atual?.erro).toBeNull();
    expect(saida.atual?.assinaturaLida).toBe(true);
    expect(saida.atual?.assinatura).toEqual(ASSINATURA);
    expect(saida.atual?.erroAssinatura).toBeNull();
  });

  it("assinatura que chega DEPOIS do prazo é descartada: não sobrescreve o retrato mais novo", async () => {
    h.modoAssinatura = "pendurado";
    const { saida } = await montar();
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(PRAZO_MS + 500);
    expect(saida.atual?.assinatura).toBeNull();

    // Busca nova: a assinatura responde com o plano de agora.
    h.modoAssinatura = "imediato";
    await act(async () => {
      void saida.atual?.atualizar();
    });
    await passar(300);
    expect(saida.atual?.assinatura).toEqual(ASSINATURA);

    // A leitura pendurada da busca antiga, enfim, responde com dado ANTIGO.
    await act(async () => {
      h.assinatura[0]({
        data: { plano: "Plano antigo", situacao: "vencida" },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saida.atual?.assinatura).toEqual(ASSINATURA);
    expect(saida.atual?.erroAssinatura).toBeNull();

    // O cache de módulo também não foi pisado: uma tela que abre agora (outra
    // montagem do hook) parte do retrato novo, não do dado antigo tardio.
    const mod = await import("@/hooks/usePainelInicio");
    const outraTela = document.createElement("div");
    document.body.appendChild(outraTela);
    const outraRaiz = createRoot(outraTela);
    const lida: { atual: ReturnType<typeof mod.usePainelInicio> | null } = {
      atual: null,
    };
    function Outra() {
      const estado = mod.usePainelInicio(false);
      useEffect(() => {
        lida.atual = estado;
      });
      return null;
    }
    await act(async () => outraRaiz.render(<Outra />));
    expect(lida.atual?.assinatura).toEqual(ASSINATURA);
    expect(lida.atual?.erroAssinatura).toBeNull();
    act(() => outraRaiz.unmount());
    outraTela.remove();
  });
});
