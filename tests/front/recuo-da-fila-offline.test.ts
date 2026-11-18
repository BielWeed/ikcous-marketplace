// A fila offline do painel (pedidos e produtos) só tentava de novo em quatro
// gatilhos: o evento `online`, a montagem da tela, a troca de usuário e o
// religador (token renovado). Se o servidor respondia 500 ou estourava o
// tempo com a rede estável, o item voltava à fila e NADA o reenviava até a
// página recarregar -- um tablet aberto o dia todo deixava o pedido no status
// antigo no servidor e o produto com o preço antigo, até o item vencer (72 h).
//
// `criarRecuoDaFila` é o relógio dessa nova tentativa: ao fim de uma passada
// que deixou item na fila por falha PASSAGEIRA, espera 30 s, depois 2 min,
// depois 10 min (teto) e chama `retomar` -- que só AGENDA a passada, que passa
// pelas mesmas guardas de sempre. Este arquivo testa só o relógio; os
// testes dos hooks provam que ele está ligado nas duas filas.
import {
  ESPERAS_DO_RECUO_MS,
  criarRecuoDaFila,
} from "@/lib/recuo-da-fila-offline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("recuo da fila offline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("as esperas são 30 s, 2 min e 10 min", () => {
    expect([...ESPERAS_DO_RECUO_MS]).toEqual([30_000, 120_000, 600_000]);
  });

  it("falha passageira: retoma depois de 30 s, e não antes", () => {
    const retomar = vi.fn();
    const recuo = criarRecuoDaFila(retomar);

    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(29_999);
    expect(retomar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("falhas seguidas esperam cada vez mais, até o teto de 10 min", () => {
    const retomar = vi.fn();
    const recuo = criarRecuoDaFila(retomar);
    const esperaAte = (ms: number) => {
      const antes = retomar.mock.calls.length;
      vi.advanceTimersByTime(ms - 1);
      expect(retomar.mock.calls.length).toBe(antes);
      vi.advanceTimersByTime(1);
      expect(retomar.mock.calls.length).toBe(antes + 1);
    };

    recuo.aoFimDaPassada(true);
    esperaAte(30_000);
    recuo.aoFimDaPassada(true);
    esperaAte(120_000);
    recuo.aoFimDaPassada(true);
    esperaAte(600_000);
    // Do quarto em diante o teto segura em 10 min.
    recuo.aoFimDaPassada(true);
    esperaAte(600_000);
    recuo.aoFimDaPassada(true);
    esperaAte(600_000);
  });

  it("passada sem falha passageira NÃO agenda nada, e zera o recuo", () => {
    const retomar = vi.fn();
    const recuo = criarRecuoDaFila(retomar);

    recuo.aoFimDaPassada(false);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(retomar).not.toHaveBeenCalled();

    // Depois de uma falha e de uma passada limpa, a próxima falha volta a 30 s.
    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(30_000);
    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(120_000);
    expect(retomar).toHaveBeenCalledTimes(2);
    recuo.aoFimDaPassada(false);
    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(30_000);
    expect(retomar).toHaveBeenCalledTimes(3);
  });

  it("a fila que esvaziou (passada limpa) cancela a espera que estava marcada", () => {
    const retomar = vi.fn();
    const recuo = criarRecuoDaFila(retomar);

    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(10_000);
    recuo.aoFimDaPassada(false);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(retomar).not.toHaveBeenCalled();
  });

  it("nunca há duas esperas: uma nova falha troca a espera marcada", () => {
    const retomar = vi.fn();
    const recuo = criarRecuoDaFila(retomar);

    recuo.aoFimDaPassada(true);
    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(60 * 60 * 1000);
    // A segunda substituiu a primeira: uma retomada só, nunca duas.
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("encerrar cancela a espera marcada, e uma passada que termina DEPOIS não marca outra", () => {
    const retomar = vi.fn();
    const recuo = criarRecuoDaFila(retomar);

    recuo.aoFimDaPassada(true);
    recuo.encerrar();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(retomar).not.toHaveBeenCalled();

    // A passada em voo no desmonte termina depois: não pode rearmar.
    recuo.aoFimDaPassada(true);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(retomar).not.toHaveBeenCalled();
  });
});
