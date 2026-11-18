import { CLAIM_DELAY_WINDOW_MS } from "@/hooks/useLeaderElection";
// @vitest-environment jsdom
//
// useLeaderElection.ts — armazenamento do site bloqueado ou cheio. A
// leitura/gravação da chave de liderança lançava, e o tratamento forçava
// `isLeader = false` sem alternativa: nenhuma aba conseguia assumir, e o
// painel (useOrders, useRealtimeUpdate, contextos) só assina o tempo real na
// aba líder — os pedidos novos paravam de chegar sozinhos na tela.
//
// Agora, sem armazenamento utilizável, a eleição se faz só pelo canal entre
// abas (PING / ALIVE / RESIGNED), com desempate por tabId; e a aba que não tem
// canal nenhum (BroadcastChannel ausente) já assume sozinha — esse caso é
// coberto em vetos-de-atualizacao/sem-broadcastchannel.test.tsx.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanalFalso,
  LEADER_KEY,
  LEADER_TTL,
  armazenamentoBloqueado,
  armazenamentoCheio,
  armazenamentoQueFunciona,
  avancar,
  criarAbas,
  lider,
} from "./apoio/abas-falsas";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "Ninguém respondeu ao PING": 120ms de espera + (até) duas esperas sorteadas
// (a reivindicação pelo armazenamento que falha na gravação e, depois dela, a
// do canal) + folga.
const ORCAMENTO_ASSUMIR_MS = 120 + CLAIM_DELAY_WINDOW_MS * 2 + 60;
// Detecção de líder morta pelo canal: até dois batimentos sem resposta (5s) +
// o sorteio + folga larga.
const ORCAMENTO_LIDER_MORTA_MS = LEADER_TTL * 2 + CLAIM_DELAY_WINDOW_MS + 1000;

describe("useLeaderElection — sem armazenamento a eleição vale pelo canal entre abas", () => {
  const abas = criarAbas();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    CanalFalso.reiniciar();
    vi.stubGlobal("BroadcastChannel", CanalFalso);
  });

  afterEach(() => {
    abas.limpar();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("armazenamento bloqueado: a aba sozinha assume a liderança pelo canal", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const aba = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(true);
  });

  it("armazenamento cheio (lê, mas não grava): a aba sozinha assume e continua líder por vários batimentos, sem piscar", async () => {
    vi.stubGlobal("localStorage", armazenamentoCheio());
    const aba = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(true);
    const quandoAssumiu = aba.estados.length;
    await avancar(LEADER_TTL * 4);
    // Nenhum render depois de assumir devolveu `false`: não houve
    // perde-e-reassume (cada piscada derruba e reabre o websocket).
    expect(aba.estados.slice(quandoAssumiu - 1).every(Boolean)).toBe(true);
  });

  it("duas abas, armazenamento bloqueado: exatamente uma líder (a outra segue), e continua uma só", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const a = await abas.montarAba();
    const b = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS + 300);
    expect([a, b].filter(lider).length).toBe(1);
    await avancar(LEADER_TTL * 3);
    expect([a, b].filter(lider).length).toBe(1);
  });

  it("duas abas montadas juntas: a que perde o sorteio ouve a outra se anunciar e NÃO chega nem a liderar por um instante", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const a = await abas.montarAba();
    const b = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS + 300);
    // Quem liderou nunca perdeu o posto (a troca para `false` só é registrada
    // se antes houve `true`): liderar por um instante e ceder derrubaria e
    // reabriria o websocket à toa. O render
    // pode agrupar as duas trocas, então a prova é o registro de cada troca
    // de estado (o log do próprio hook), não só o último render.
    const trocas = (tabId: string) =>
      vi
        .mocked(console.log)
        .mock.calls.filter(
          (c) => String(c[0]).startsWith("[LeaderElection]") && c[1] === tabId,
        )
        .map((c) => c[2]);
    expect(trocas(a.tabId)).not.toContain(false);
    expect(trocas(b.tabId)).not.toContain(false);
    expect([a, b].filter(lider).length).toBe(1);
  });

  it("um batimento só sem resposta (mensagem perdida) não faz a seguidora usurpar uma líder viva", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const a = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(a)).toBe(true);
    const b = await abas.montarAba();
    // Antes do primeiro batimento da seguidora (2,5s depois de montar).
    await avancar(2400);
    expect(lider(b)).toBe(false);

    // A líder fica muda (não ouve nem fala) justo no batimento da seguidora.
    const ouvir = a.canal.entregar.bind(a.canal);
    const falar = a.canal.postMessage.bind(a.canal);
    a.canal.entregar = () => {};
    a.canal.postMessage = () => {};
    await avancar(200);
    a.canal.entregar = ouvir;
    a.canal.postMessage = falar;

    await avancar(LEADER_TTL * 3);
    expect(b.estados.includes(true)).toBe(false);
    expect(lider(a)).toBe(true);
  });

  it("uma seguidora (aba que já ouviu a líder) não usurpa enquanto a líder responde, e assume quando ela cai sem renunciar", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const a = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(a)).toBe(true);
    const b = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(b)).toBe(false);

    // Controle: com a líder viva, a seguidora NÃO usurpa ao longo de muitos
    // batimentos (a resposta ao PING zera a contagem).
    await avancar(LEADER_TTL * 4);
    expect(lider(a)).toBe(true);
    expect(lider(b)).toBe(false);

    abas.travarAba(a);
    await avancar(ORCAMENTO_LIDER_MORTA_MS);
    expect(lider(b)).toBe(true);
  });

  it("a líder renuncia ao fechar (beforeunload): a seguidora assume logo, sem esperar os batimentos", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const a = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    const b = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(a)).toBe(true);
    expect(lider(b)).toBe(false);

    avisarQueVaiFechar();
    abas.travarAba(a);
    await avancar(CLAIM_DELAY_WINDOW_MS + 60);
    expect(lider(b)).toBe(true);
  });

  it("desempate: duas líderes pelo canal, a de tabId menor fica e reafirma, a maior cede (nunca zero líderes)", async () => {
    vi.stubGlobal("localStorage", armazenamentoBloqueado());
    const a = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(a)).toBe(true);

    // Outra aba, de id MAIOR que qualquer um possível, também se diz líder:
    // a daqui mantém o posto e reafirma (para a outra ceder já).
    const antes = CanalFalso.enviadas.length;
    await entregar(a, { type: "LEADER_ALIVE", tabId: "zzzzzzz" });
    expect(lider(a)).toBe(true);
    const respostas = CanalFalso.enviadas
      .slice(antes)
      .filter((m) => m.type === "LEADER_ALIVE" && m.tabId === a.tabId);
    expect(respostas.length).toBeGreaterThan(0);

    // Outra aba, de id MENOR que qualquer um possível: esta cede.
    await entregar(a, { type: "LEADER_ALIVE", tabId: "0" });
    expect(lider(a)).toBe(false);
  });

  it("armazenamento volta a funcionar: a líder pelo canal passa a guardar o batimento e segue líder", async () => {
    // Começa cheio (lê, não grava) e "libera espaço" depois.
    const cheio = armazenamentoCheio();
    const base = armazenamentoQueFunciona();
    let aindaCheio = true;
    vi.stubGlobal("localStorage", {
      getItem: base.getItem,
      removeItem: base.removeItem,
      setItem: (chave: string, valor: string) => {
        if (aindaCheio) return cheio.setItem();
        base.setItem(chave, valor);
      },
    });
    const aba = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(true);
    expect(base.getItem(LEADER_KEY)).toBeNull();

    aindaCheio = false;
    await avancar(LEADER_TTL);
    expect(lider(aba)).toBe(true);
    expect(JSON.parse(base.getItem(LEADER_KEY) ?? "null")?.tabId).toBe(
      aba.tabId,
    );
  });

  it("caminho normal intacto: com armazenamento funcionando a líder grava a chave, e nenhum LEADER_ALIVE sai sem PING", async () => {
    const armazem = armazenamentoQueFunciona();
    vi.stubGlobal("localStorage", armazem);
    const aba = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(true);
    expect(JSON.parse(armazem.getItem(LEADER_KEY) ?? "null")?.tabId).toBe(
      aba.tabId,
    );
    await avancar(LEADER_TTL * 3);
    expect(lider(aba)).toBe(true);
    // Só o PING do mount saiu; o batimento é pelo armazenamento, não pelo
    // canal.
    expect(CanalFalso.enviadas.map((m) => m.type)).toEqual(["LEADER_PING"]);
  });

  it("caminho normal intacto: líder de outra aba com batimento fresco no armazenamento segue sendo respeitada", async () => {
    const armazem = armazenamentoQueFunciona();
    armazem.setItem(
      LEADER_KEY,
      JSON.stringify({ tabId: "outra-aba", ts: Date.now() - 1000 }),
    );
    vi.stubGlobal("localStorage", armazem);
    const aba = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(false);
    expect(JSON.parse(armazem.getItem(LEADER_KEY) ?? "null")?.tabId).toBe(
      "outra-aba",
    );
  });
});

function avisarQueVaiFechar() {
  act(() => {
    window.dispatchEvent(new Event("beforeunload"));
  });
}

async function entregar(
  aba: { canal: CanalFalso },
  mensagem: { type: string; tabId: string },
) {
  await act(async () => {
    aba.canal.entregar(mensagem);
  });
}
