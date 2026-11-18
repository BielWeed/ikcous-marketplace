import { CLAIM_DELAY_WINDOW_MS } from "@/hooks/useLeaderElection";
// @vitest-environment jsdom
//
// useLeaderElection.ts — relógio da máquina que volta (ajuste de hora,
// sincronização). O batimento da líder é gravado com Date.now(); com o relógio
// recuado, `agora - batimento` fica NEGATIVO e passava como liderança válida:
// uma líder morta (aba fechada sem `beforeunload`) era preservada por até
// horas e nenhuma outra aba assumia — todas esperavam um posto vazio, e o
// painel (useOrders, useRealtimeUpdate, contextos) só assina o tempo real na
// aba líder. Agora o batimento só vale com `0 <= idade <= TTL`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanalFalso,
  LEADER_KEY,
  LEADER_TTL,
  armazenamentoQueFunciona,
  avancar,
  criarAbas,
  lider,
} from "./apoio/abas-falsas";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "Ninguém respondeu ao PING": 120ms de espera + o sorteio + folga.
const ORCAMENTO_ASSUMIR_MS = 120 + CLAIM_DELAY_WINDOW_MS + 60;

describe("useLeaderElection — relógio que volta não preserva líder morta", () => {
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

  it("batimento gravado 'no futuro' (relógio recuou) conta como vencido: a aba assume", async () => {
    const armazem = armazenamentoQueFunciona();
    armazem.setItem(
      LEADER_KEY,
      JSON.stringify({ tabId: "aba-morta", ts: Date.now() + 3_600_000 }),
    );
    vi.stubGlobal("localStorage", armazem);
    const aba = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(true);
    expect(JSON.parse(armazem.getItem(LEADER_KEY) ?? "null")?.tabId).toBe(
      aba.tabId,
    );
  });

  it("a líder morre e o relógio recua uma hora: a seguidora assume pelo heartbeat, não fica horas esperando", async () => {
    const armazem = armazenamentoQueFunciona();
    vi.stubGlobal("localStorage", armazem);
    const a = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(a)).toBe(true);
    const b = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(b)).toBe(false);

    abas.travarAba(a);
    // Sincronização de hora joga o relógio uma hora para trás.
    vi.setSystemTime(Date.now() - 3_600_000);

    await avancar(LEADER_TTL + CLAIM_DELAY_WINDOW_MS + 3000);
    expect(lider(b)).toBe(true);
  });

  it("controle: batimento fresco de outra aba (dentro do TTL) continua valendo, e vencido de verdade deixa assumir", async () => {
    const armazem = armazenamentoQueFunciona();
    armazem.setItem(
      LEADER_KEY,
      JSON.stringify({ tabId: "aba-viva", ts: Date.now() }),
    );
    vi.stubGlobal("localStorage", armazem);
    const aba = await abas.montarAba();
    // Aos 120ms do ping o batimento tem 120ms de idade: válido.
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(aba)).toBe(false);
    expect(JSON.parse(armazem.getItem(LEADER_KEY) ?? "null")?.tabId).toBe(
      "aba-viva",
    );
    // Passado o TTL sem ninguém renovar, a vaga é de quem pedir.
    await avancar(LEADER_TTL + 3000);
    expect(lider(aba)).toBe(true);
  });

  it("controle: a líder viva continua líder depois que o relógio recua (regrava o batimento com a hora nova)", async () => {
    const armazem = armazenamentoQueFunciona();
    vi.stubGlobal("localStorage", armazem);
    const a = await abas.montarAba();
    await avancar(ORCAMENTO_ASSUMIR_MS);
    expect(lider(a)).toBe(true);

    vi.setSystemTime(Date.now() - 3_600_000);
    await avancar(LEADER_TTL * 3);
    expect(lider(a)).toBe(true);
    const gravado = JSON.parse(armazem.getItem(LEADER_KEY) ?? "null");
    expect(gravado.tabId).toBe(a.tabId);
    // O batimento foi regravado com a hora nova (não é o de uma hora atrás).
    expect(Math.abs(Date.now() - gravado.ts)).toBeLessThanOrEqual(LEADER_TTL);
  });
});
