// @vitest-environment jsdom
//
// O "Hoje" do Início não pode ficar preso em ontem. O app (PWA) fica aberto, ou
// congelado em segundo plano no celular, de um dia para o outro: ao reabrir de
// manhã, o Início tem de buscar os números de novo — não esperar um pedido
// novo chegar — e a data/coluna "Hoje" têm de andar junto.
//
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadasPainel: 0,
  falhar: false,
  adiar: false,
  pendentes: [] as Array<() => void>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } } }),
}));

vi.mock("@/lib/crm", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/crm")>()),
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: (_e: unknown, o: string) => `erro ao ${o}`,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      if (nome !== "painel_inicio")
        return Promise.resolve({ data: null, error: null });
      h.chamadasPainel += 1;
      const resposta = h.falhar
        ? { data: null, error: { message: "falhou" } }
        : { data: { leitura: h.chamadasPainel }, error: null };
      if (!h.adiar) return Promise.resolve(resposta);
      return new Promise((resolve) => {
        h.pendentes.push(() => resolve(resposta));
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

// 13/10/2026 23:59:50 em São Paulo.
const ANTES_DA_MEIA_NOITE = "2026-10-14T02:59:50Z";
// 14/10/2026 12:00:00 em São Paulo — longe de qualquer virada de dia.
const MEIO_DIA = "2026-10-14T15:00:00Z";

function definirVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function irPara(instante: string) {
  await act(async () => {
    vi.setSystemTime(new Date(instante));
  });
}

describe("usePainelInicio — o Hoje de ontem não fica na tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    h.chamadasPainel = 0;
    h.falhar = false;
    h.adiar = false;
    h.pendentes.length = 0;
    definirVisibilidade("visible");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  async function montar(ativo = true, inicio = ANTES_DA_MEIA_NOITE) {
    vi.setSystemTime(new Date(inicio));
    const mod = await import("@/hooks/usePainelInicio");
    const saida: {
      atual: ReturnType<typeof mod.usePainelInicio> | null;
      /** O `painel` de CADA desenho, na ordem — o primeiro também conta. */
      desenhos: unknown[];
    } = { atual: null, desenhos: [] };
    function Sonda({ ativa }: Readonly<{ ativa: boolean }>) {
      const estado = mod.usePainelInicio(ativa);
      saida.desenhos.push(estado.painel);
      useEffect(() => {
        saida.atual = estado;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda ativa={ativo} />));
    // A abertura espera 200 ms antes de ir à rede.
    await avancar(250);
    const redesenhar = (ativa: boolean) =>
      act(async () => raiz.render(<Sonda ativa={ativa} />));
    return { saida, redesenhar };
  }

  function voltarAVer(evento: "visibilitychange" | "focus" | "pageshow") {
    act(() => {
      if (evento === "visibilitychange") {
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.dispatchEvent(new Event(evento));
      }
    });
  }

  it("a abertura busca uma vez (ponto de partida dos outros casos)", async () => {
    const { saida } = await montar();
    expect(h.chamadasPainel).toBe(1);
    expect(saida.atual?.painel).toEqual({ leitura: 1 });
  });

  it("controle: voltar a ver o app em 20 s, no MESMO dia, não busca de novo", async () => {
    await montar(true, MEIO_DIA);
    await irPara("2026-10-14T15:00:20Z"); // 20 s depois, mesmo dia
    voltarAVer("visibilitychange");
    await avancar(10);
    expect(h.chamadasPainel).toBe(1);
  });

  it("voltar a ver o app DEPOIS da meia-noite busca de novo, mesmo com menos de 30 s de idade", async () => {
    const { saida } = await montar();
    // Lido às 23:59:50 do dia 13; às 00:00:10 do dia 14 só passaram 20 s.
    await irPara("2026-10-14T03:00:10Z");
    voltarAVer("visibilitychange");
    await avancar(10);
    expect(h.chamadasPainel).toBe(2);
    expect(saida.atual?.painel).toEqual({ leitura: 2 });
  });

  it.each(["visibilitychange", "focus", "pageshow"] as const)(
    "voltar a ver o app (%s) depois de mais de 30 s, no mesmo dia, busca de novo",
    async (evento) => {
      await montar(true, MEIO_DIA);
      await irPara("2026-10-14T15:00:45Z"); // 45 s depois, mesmo dia
      voltarAVer(evento);
      await avancar(10);
      expect(h.chamadasPainel).toBe(2);
    },
  );

  it("com o app escondido, nada busca (só quando volta a ficar visível)", async () => {
    await montar();
    definirVisibilidade("hidden");
    await irPara("2026-10-14T03:00:10Z");
    voltarAVer("visibilitychange");
    await avancar(10);
    expect(h.chamadasPainel).toBe(1);
    definirVisibilidade("visible");
    voltarAVer("visibilitychange");
    await avancar(10);
    expect(h.chamadasPainel).toBe(2);
  });

  it("a meia-noite com a tela aberta e ninguém mexendo recarrega sozinha", async () => {
    const { saida } = await montar();
    expect(h.chamadasPainel).toBe(1);
    await avancar(12_000); // 23:59:50 → 00:00:02
    expect(h.chamadasPainel).toBe(2);
    expect(saida.atual?.painel).toEqual({ leitura: 2 });
  });

  it("enquanto a recarga da manhã não chega, o Hoje de ontem não aparece (esqueleto)", async () => {
    const { saida } = await montar();
    expect(saida.atual?.painel).toEqual({ leitura: 1 });
    h.adiar = true;
    await avancar(12_000); // virou o dia; a busca está no ar
    expect(h.chamadasPainel).toBe(2);
    expect(saida.atual?.painel).toBeNull();
    expect(saida.atual?.carregando).toBe(true);
    await act(async () => {
      for (const resolver of h.pendentes) resolver();
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(saida.atual?.painel).toEqual({ leitura: 2 });
    expect(saida.atual?.carregando).toBe(false);
  });

  it("se a recarga da manhã FALHAR, os números de ontem não ficam como se fossem de hoje", async () => {
    const { saida } = await montar();
    expect(saida.atual?.painel).toEqual({ leitura: 1 });
    h.falhar = true;
    await avancar(12_000);
    expect(h.chamadasPainel).toBe(2);
    expect(saida.atual?.painel).toBeNull();
    expect(saida.atual?.erro).toBe("erro ao carregar os números da loja");
  });

  it("controle: falha NO MESMO dia mantém os números anteriores com o aviso", async () => {
    const { saida } = await montar();
    h.falhar = true;
    await irPara("2026-10-14T02:59:55Z");
    await act(async () => {
      await saida.atual?.atualizar();
    });
    expect(h.chamadasPainel).toBe(2);
    expect(saida.atual?.painel).toEqual({ leitura: 1 });
    expect(saida.atual?.erro).toBe("erro ao carregar os números da loja");
  });

  it("desmontar tira os ouvintes e o temporizador (nada busca depois)", async () => {
    await montar();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await irPara("2026-10-14T03:00:10Z");
    voltarAVer("visibilitychange");
    voltarAVer("focus");
    voltarAVer("pageshow");
    await avancar(2 * 3_600_000);
    expect(h.chamadasPainel).toBe(1);
  });

  it("Início inativo a noite toda e ativado de manhã: o PRIMEIRO desenho já sai em esqueleto, nunca com o número de ontem", async () => {
    const { saida, redesenhar } = await montar(true, MEIO_DIA);
    expect(saida.atual?.painel).toEqual({ leitura: 1 });
    // A lojista sai do Início e deixa o app parado a noite toda.
    await redesenhar(false);
    await irPara("2026-10-15T11:00:00Z"); // 15/10, 08:00 em São Paulo
    h.adiar = true; // a busca da manhã fica no ar: o que aparece é o que havia
    const antes = saida.desenhos.length;
    await redesenhar(true);
    const desenhosDaAtivacao = saida.desenhos.slice(antes);
    expect(desenhosDaAtivacao.length).toBeGreaterThan(0);
    // Nenhum desenho da ativação — nem o primeiro — traz a leitura de ontem.
    expect(desenhosDaAtivacao).not.toContainEqual({ leitura: 1 });
    expect(desenhosDaAtivacao[0]).toBeNull();
  });

  // `lidoEm` é o INSTANTE EM QUE A BUSCA COMEÇOU: uma busca que sai às 23:59:59
  // e volta depois da meia-noite traz números de ontem; carimbada com a hora
  // do FIM ela passaria por fresca de hoje e o "Hoje" ficaria com eles.
  it("busca que começa antes da meia-noite e termina depois: o retrato é de ontem e a busca se refaz", async () => {
    h.adiar = true;
    const { saida } = await montar(true, "2026-10-14T02:59:59.500Z");
    expect(h.chamadasPainel).toBe(1); // saiu às 23:59:59.7 de 13/10
    await avancar(2000); // meia-noite passa com a busca ainda no ar
    expect(h.chamadasPainel).toBe(1); // o gatilho da virada pegou a busca em voo
    await act(async () => {
      h.pendentes[0]();
      await vi.advanceTimersByTimeAsync(1);
    });
    // A resposta 1 é de ontem: não vale como "Hoje" e uma busca nova sai.
    expect(h.chamadasPainel).toBe(2);
    expect(saida.atual?.painel).toBeNull();
    await act(async () => {
      h.pendentes[1]();
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(saida.atual?.painel).toEqual({ leitura: 2 });
    expect(saida.atual?.carregando).toBe(false);
    expect(h.chamadasPainel).toBe(2);
  });

  it("controle: busca que começa e termina no mesmo dia não se repete", async () => {
    h.adiar = true;
    const { saida } = await montar(true, MEIO_DIA);
    await act(async () => {
      h.pendentes[0]();
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(h.chamadasPainel).toBe(1);
    expect(saida.atual?.painel).toEqual({ leitura: 1 });
  });

  it("tela inativa (atrás de outra aba) não registra nada", async () => {
    await montar(false);
    voltarAVer("visibilitychange");
    voltarAVer("focus");
    await avancar(2 * 3_600_000);
    expect(h.chamadasPainel).toBe(0);
  });
});
