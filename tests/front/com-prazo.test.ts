// `comPrazo`: o prazo que impede um envio de foto de segurar a tela para
// sempre. O motivo de existir: o botão Publicar fica desligado enquanto há
// foto subindo, e compressão/upload de celular em rede ruim podem nunca
// responder (cliente pagante, 03/10/2026).
import { PrazoEsgotado, comPrazo } from "@/utils/com-prazo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("comPrazo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("devolve o valor quando a promessa responde antes do prazo", async () => {
    const resultado = comPrazo(Promise.resolve("ok"), 1000);
    await expect(resultado).resolves.toBe("ok");
  });

  it("rejeita com PrazoEsgotado quando a promessa NUNCA responde", async () => {
    const resultado = comPrazo(new Promise<string>(() => {}), 1000);
    const capturado = resultado.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await capturado).toBeInstanceOf(PrazoEsgotado);
  });

  it("não rejeita ANTES do prazo", async () => {
    let rejeitou = false;
    comPrazo(new Promise<string>(() => {}), 1000).catch(() => {
      rejeitou = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(rejeitou).toBe(false);
  });

  it("repassa a falha da própria promessa (não a disfarça de prazo)", async () => {
    const falha = new Error("boom");
    await expect(comPrazo(Promise.reject(falha), 1000)).rejects.toBe(falha);
  });

  it("limpa o relógio quando a promessa responde (nada fica agendado)", async () => {
    await comPrazo(Promise.resolve(1), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("chama onPrazo no instante do estouro, para quem precisa abortar trabalho pendente", async () => {
    const aoEstourar = vi.fn();
    const capturado = comPrazo(
      new Promise<void>(() => {}),
      500,
      aoEstourar,
    ).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(500);
    await capturado;
    expect(aoEstourar).toHaveBeenCalledTimes(1);
  });

  describe("aoChegarDepois (resultado que chega depois do estouro)", () => {
    it("chama com o valor quando a promessa resolve DEPOIS do prazo, e o resultado do comPrazo continua sendo a rejeição", async () => {
      const aoChegarDepois = vi.fn();
      let resolver!: (v: string) => void;
      const lenta = new Promise<string>((r) => {
        resolver = r;
      });
      const capturado = comPrazo(lenta, 500, undefined, aoChegarDepois).catch(
        (e) => e,
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(await capturado).toBeInstanceOf(PrazoEsgotado);
      expect(aoChegarDepois).not.toHaveBeenCalled();

      resolver("tarde");
      await vi.advanceTimersByTimeAsync(0);
      expect(aoChegarDepois).toHaveBeenCalledTimes(1);
      expect(aoChegarDepois).toHaveBeenCalledWith("tarde");
    });

    it("NÃO chama quando a promessa resolve dentro do prazo", async () => {
      const aoChegarDepois = vi.fn();
      let resolver!: (v: string) => void;
      const lenta = new Promise<string>((r) => {
        resolver = r;
      });
      const resultado = comPrazo(lenta, 500, undefined, aoChegarDepois);
      await vi.advanceTimersByTimeAsync(499);
      resolver("a tempo");
      await expect(resultado).resolves.toBe("a tempo");
      await vi.advanceTimersByTimeAsync(5000);
      expect(aoChegarDepois).not.toHaveBeenCalled();
    });

    it("NÃO chama quando a promessa falha depois do prazo (não há valor para tratar)", async () => {
      const aoChegarDepois = vi.fn();
      let rejeitar!: (e: Error) => void;
      const lenta = new Promise<string>((_, r) => {
        rejeitar = r;
      });
      const capturado = comPrazo(lenta, 500, undefined, aoChegarDepois).catch(
        (e) => e,
      );
      await vi.advanceTimersByTimeAsync(500);
      await capturado;
      rejeitar(new Error("tarde e ruim"));
      await vi.advanceTimersByTimeAsync(0);
      expect(aoChegarDepois).not.toHaveBeenCalled();
    });

    it("se aoChegarDepois lança, o erro é engolido (log) -- nunca vira rejeição sem dono", async () => {
      const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
      let resolver!: (v: string) => void;
      const lenta = new Promise<string>((r) => {
        resolver = r;
      });
      const capturado = comPrazo(lenta, 500, undefined, () => {
        throw new Error("limpeza quebrou");
      }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(500);
      await capturado;
      resolver("tarde");
      await vi.advanceTimersByTimeAsync(0);
      expect(erroLog).toHaveBeenCalled();
      erroLog.mockRestore();
    });
  });
});
