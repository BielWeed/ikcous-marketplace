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
});
