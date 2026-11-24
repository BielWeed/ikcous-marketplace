// Bordas da trava de 2 tentativas que o teste principal não alcança (achadas por
// mutação): a gravação por origem que falha DEPOIS da gravação por alvo deve
// devolver a tentativa do alvo; devolver nunca deixa a contagem negativa; e
// storage que "aceita" a escrita mas não a guarda (cheio, modo privado antigo)
// não pode contar como confirmado.
import {
  CHAVE_DA_TRAVA_DE_ATUALIZACAO,
  CHAVE_DA_TRAVA_POR_ORIGEM,
  devolverTentativa,
  podeTentarAtualizar,
  reservarTentativa,
  tentativasDaOrigem,
  tentativasFeitas,
} from "@/lib/atualizacao/trava-anti-repeticao";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGORA = 1_800_000_000_000;
const ALVO = "1.5.300-sha.alvo";
const ORIGEM = "1.5.299-sha.origem";

const guardado = new Map<string, string>();

/** Storage em memória; `aoGravar` decide o destino de cada escrita. */
function instalarStorage(
  aoGravar: (chave: string, valor: string) => "grava" | "ignora" | "lanca",
) {
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => guardado.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      const destino = aoGravar(chave, valor);
      if (destino === "lanca") throw new Error("QuotaExceededError");
      if (destino === "grava") guardado.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      guardado.delete(chave);
    },
  });
}

function semearAlvo(count: number) {
  guardado.set(
    CHAVE_DA_TRAVA_DE_ATUALIZACAO,
    JSON.stringify({ alvo: ALVO, count, ultimaEm: AGORA - 1000 }),
  );
}

function semearOrigem(count: number) {
  guardado.set(
    CHAVE_DA_TRAVA_POR_ORIGEM,
    JSON.stringify({
      origem: ORIGEM,
      count,
      primeiraEm: AGORA - 1000,
      ultimaEm: AGORA - 1000,
    }),
  );
}

beforeEach(() => {
  guardado.clear();
  vi.unstubAllGlobals();
});

describe("trava anti-repetição — bordas", () => {
  it("falha ao gravar a conta da ORIGEM devolve a tentativa já gasta do alvo e nega", () => {
    instalarStorage((chave) =>
      chave === CHAVE_DA_TRAVA_POR_ORIGEM ? "lanca" : "grava",
    );

    expect(reservarTentativa(ALVO, ORIGEM, AGORA)).toBe(false);

    // A tentativa do alvo foi gravada e depois devolvida: nada ficou gasto.
    expect(tentativasFeitas(ALVO)).toBe(0);
    expect(podeTentarAtualizar(ALVO, undefined, AGORA)).toBe(true);
  });

  it("a conta da origem 'aceita' mas não guardada não vale como confirmada", () => {
    semearOrigem(0);
    instalarStorage((chave) =>
      chave === CHAVE_DA_TRAVA_POR_ORIGEM ? "ignora" : "grava",
    );

    expect(reservarTentativa(ALVO, ORIGEM, AGORA)).toBe(false);

    expect(tentativasDaOrigem(ORIGEM, AGORA)).toBe(0);
    expect(tentativasFeitas(ALVO)).toBe(0);
  });

  it("a conta do alvo 'aceita' mas não guardada também nega, e não gasta a origem", () => {
    semearAlvo(0);
    instalarStorage((chave) =>
      chave === CHAVE_DA_TRAVA_DE_ATUALIZACAO ? "ignora" : "grava",
    );

    expect(reservarTentativa(ALVO, ORIGEM, AGORA)).toBe(false);

    expect(tentativasDaOrigem(ORIGEM, AGORA)).toBe(0);
  });

  it("devolver com a contagem já em zero não deixa número negativo (nem abre vaga extra)", () => {
    semearAlvo(0);
    semearOrigem(0);
    instalarStorage(() => "grava");

    devolverTentativa(ALVO, ORIGEM);

    expect(tentativasFeitas(ALVO)).toBe(0);
    expect(tentativasDaOrigem(ORIGEM, AGORA)).toBe(0);
    const bruto = JSON.parse(
      guardado.get(CHAVE_DA_TRAVA_DE_ATUALIZACAO) ?? "{}",
    ) as { count?: number };
    expect(bruto.count).toBe(0);
  });

  it("devolver sem nada gravado não cria registro", () => {
    instalarStorage(() => "grava");

    devolverTentativa(ALVO, ORIGEM);

    expect(guardado.size).toBe(0);
  });

  it("devolver depois de um 'agora não' libera exatamente uma vaga, nas duas contas", () => {
    instalarStorage(() => "grava");
    expect(reservarTentativa(ALVO, ORIGEM, AGORA)).toBe(true);
    expect(reservarTentativa(ALVO, ORIGEM, AGORA)).toBe(true);
    expect(podeTentarAtualizar(ALVO, ORIGEM, AGORA)).toBe(false);

    devolverTentativa(ALVO, ORIGEM);

    expect(tentativasFeitas(ALVO)).toBe(1);
    expect(tentativasDaOrigem(ORIGEM, AGORA)).toBe(1);
    expect(podeTentarAtualizar(ALVO, ORIGEM, AGORA)).toBe(true);
  });
});
