// @vitest-environment jsdom
//
// Início do painel com conexão lenta: a primeira consulta sai e termina ANTES
// de o canal de atualização ao vivo confirmar. Uma venda confirmada nesse
// intervalo não chega por evento (o canal ainda não estava ouvindo) e a
// consulta já tinha lido o banco: o Início ficava com R$ 0 e nenhuma venda,
// dizendo "Ao vivo". A primeira confirmação do canal passa a pedir UMA
// releitura silenciosa — e só quando a consulta inicial não vai ler depois dela.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EstadoLido {
  painel: unknown;
  desatualizado: boolean;
  carregando: boolean;
}

const h = vi.hoisted(() => ({
  // Vendas no "servidor": lidas no instante em que a consulta SAI.
  vendas: 0,
  chamadas: 0,
  manual: false,
  falhar: false,
  pendentes: [] as Array<() => void>,
  status: null as ((status: string) => void) | null,
  estado: null as null | {
    painel: unknown;
    desatualizado: boolean;
    carregando: boolean;
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-fixture" } } }),
}));
vi.mock("@/lib/crm", () => ({
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: () => "Falha de leitura",
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome !== "painel_inicio") {
        return Promise.resolve({ data: null, error: null });
      }
      h.chamadas += 1;
      const total = h.vendas;
      const falha = h.falhar;
      return new Promise((resolve) => {
        const responder = () =>
          resolve(
            falha
              ? { data: null, error: { message: "sem rede" } }
              : { data: { total }, error: null },
          );
        if (h.manual) h.pendentes.push(responder);
        else responder();
      });
    },
    channel: () => {
      const canal = {
        on: () => canal,
        subscribe: (status: (status: string) => void) => {
          h.status = status;
          return canal;
        },
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Início relê UMA vez quando o canal confirma depois da consulta", () => {
  let raiz: Root;
  let div: HTMLDivElement;

  async function passar(ms: number) {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  }
  async function emitir(status: string) {
    await act(async () => h.status?.(status));
  }
  async function responderPendentes() {
    await act(async () => {
      for (const responder of h.pendentes.splice(0)) responder();
    });
  }
  const estado = () => h.estado as EstadoLido;

  async function montar() {
    const { usePainelInicio } = await import("@/hooks/usePainelInicio");
    function Sonda() {
      const lido = usePainelInicio(true);
      useEffect(() => {
        h.estado = lido;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    h.vendas = 0;
    h.chamadas = 0;
    h.manual = false;
    h.falhar = false;
    h.pendentes = [];
    h.status = null;
    h.estado = null;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    div = document.createElement("div");
    document.body.appendChild(div);
    raiz = createRoot(div);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    div.remove();
    vi.useRealTimers();
  });

  it("venda feita entre o fim da consulta e a confirmação do canal aparece, sem nova ação da lojista", async () => {
    await montar();
    await passar(250);
    expect(estado().painel).toEqual({ total: 0 });
    h.vendas = 1;
    await emitir("SUBSCRIBED");
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 1 });
    expect(estado().desatualizado).toBe(false);
  });

  it("a releitura é silenciosa: sem esqueleto, com os números de antes na tela", async () => {
    await montar();
    await passar(250);
    h.manual = true;
    h.vendas = 1;
    await emitir("SUBSCRIBED");
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().carregando).toBe(false);
    expect(estado().painel).toEqual({ total: 0 });
    await responderPendentes();
    expect(estado().painel).toEqual({ total: 1 });
  });

  it("status repetido não pede outra releitura", async () => {
    await montar();
    await passar(250);
    await emitir("SUBSCRIBED");
    await emitir("SUBSCRIBED");
    await passar(2000);
    await emitir("SUBSCRIBED");
    await passar(5000);
    expect(h.chamadas).toBe(2);
  });

  it("canal que só confirma depois de 30 s (retrato já velho) também relê", async () => {
    await montar();
    await passar(35_000);
    expect(h.chamadas).toBe(1);
    h.vendas = 1;
    await emitir("SUBSCRIBED");
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 1 });
  });

  it("consulta aquecida pelo hover ainda em voo (saiu antes do canal) não dispensa a releitura", async () => {
    h.manual = true;
    const { prefetchPainelInicio } = await import("@/hooks/usePainelInicio");
    prefetchPainelInicio();
    expect(h.chamadas).toBe(1);
    h.vendas = 1;
    await montar();
    await emitir("SUBSCRIBED");
    await responderPendentes();
    await passar(2000);
    h.manual = false;
    await responderPendentes();
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 1 });
  });

  it("retrato fresco do hover (lido antes do canal) não dispensa a releitura", async () => {
    const { prefetchPainelInicio } = await import("@/hooks/usePainelInicio");
    prefetchPainelInicio();
    await passar(10);
    expect(h.chamadas).toBe(1);
    h.vendas = 1;
    await montar();
    await emitir("SUBSCRIBED");
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 1 });
  });

  it("canal que confirma com a consulta ainda em voo: UMA releitura, depois dela", async () => {
    h.manual = true;
    await montar();
    await passar(250);
    expect(h.chamadas).toBe(1);
    // A consulta já saiu (leu 0 vendas) e ainda não voltou.
    h.vendas = 1;
    await emitir("SUBSCRIBED");
    await passar(2000);
    expect(h.chamadas).toBe(1);
    await responderPendentes();
    await passar(100);
    expect(h.chamadas).toBe(2);
    await responderPendentes();
    await passar(5000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 1 });
  });

  it("canal que confirma ANTES de a consulta inicial sair não duplica: ela já lê depois", async () => {
    await montar();
    await emitir("SUBSCRIBED");
    await passar(5000);
    expect(h.chamadas).toBe(1);
    expect(estado().desatualizado).toBe(false);
  });

  it("escondida, espera a tela voltar e então relê", async () => {
    await montar();
    await passar(250);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    h.vendas = 1;
    await emitir("SUBSCRIBED");
    await passar(5000);
    expect(h.chamadas).toBe(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 1 });
  });

  it("releitura que falha mantém os números e tira o Ao vivo, sem faixa de erro", async () => {
    await montar();
    await passar(250);
    h.falhar = true;
    await emitir("SUBSCRIBED");
    await passar(2000);
    expect(h.chamadas).toBe(2);
    expect(estado().painel).toEqual({ total: 0 });
    expect(estado().desatualizado).toBe(true);
  });
});
