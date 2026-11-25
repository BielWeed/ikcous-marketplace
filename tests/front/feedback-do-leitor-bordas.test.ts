// O bip do leitor de código de barras (caça por mutação): o que cada bip é de
// verdade (onda, frequência, volume, duração), qual vibração acompanha cada
// resultado, som desligado, depois de encerrar, contexto suspenso, e as
// falhas do áudio que nunca podem derrubar uma venda.
import { afterEach, describe, expect, it, vi } from "vitest";

import { criarFeedbackDoLeitor } from "@/lib/feedback-do-leitor";

function criarAudio(estado: "running" | "suspended" = "running") {
  const oscilador = {
    type: "",
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const ganho = { gain: { value: 0 }, connect: vi.fn() };
  const destino = { nome: "saida" };
  const resume = vi.fn(() => Promise.resolve());
  const close = vi.fn();
  const contexto = {
    state: estado,
    currentTime: 10,
    destination: destino,
    createOscillator: vi.fn(() => oscilador),
    createGain: vi.fn(() => ganho),
    resume,
    close,
  };
  return {
    oscilador,
    ganho,
    destino,
    resume,
    close,
    contexto,
    ctx: contexto as unknown as AudioContext,
  };
}

function comVibracao() {
  const vibrate = vi.fn();
  vi.stubGlobal("navigator", { vibrate });
  return vibrate;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("feedback do leitor: o que cada bip é", () => {
  it("confirmar: onda quadrada de 1046,5 Hz, volume 0,05, 80 ms, ligado na saída", () => {
    const a = criarAudio();
    const f = criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => a.ctx,
    });
    f.confirmar();
    expect(a.oscilador.type).toBe("square");
    expect(a.oscilador.frequency.value).toBe(1046.5);
    expect(a.ganho.gain.value).toBe(0.05);
    expect(a.oscilador.connect).toHaveBeenCalledWith(a.ganho);
    expect(a.ganho.connect).toHaveBeenCalledWith(a.destino);
    expect(a.oscilador.start).toHaveBeenCalledTimes(1);
    expect(a.oscilador.stop).toHaveBeenCalledTimes(1);
    expect(a.oscilador.stop.mock.calls[0]?.[0]).toBeCloseTo(10.08, 6);
  });

  it("recusar: bip grave de 220 Hz, 250 ms", () => {
    const a = criarAudio();
    const f = criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => a.ctx,
    });
    f.recusar();
    expect(a.oscilador.type).toBe("square");
    expect(a.oscilador.frequency.value).toBe(220);
    expect(a.ganho.gain.value).toBe(0.05);
    expect(a.oscilador.stop.mock.calls[0]?.[0]).toBeCloseTo(10.25, 6);
  });
});

describe("feedback do leitor: vibração de cada resultado", () => {
  it("confirmar vibra curto (10 ms) e recusar vibra o padrão de erro", () => {
    const vibrate = comVibracao();
    const f = criarFeedbackDoLeitor({ som: false });
    f.confirmar();
    expect(vibrate).toHaveBeenLastCalledWith(10);
    f.recusar();
    expect(vibrate).toHaveBeenLastCalledWith([100, 50, 100]);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("vibração desligada não vibra nem em confirmar nem em recusar", () => {
    const vibrate = comVibracao();
    const f = criarFeedbackDoLeitor({ som: false, vibracao: false });
    f.confirmar();
    f.recusar();
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe("feedback do leitor: som desligado e leitor encerrado", () => {
  it("som desligado: nem cria o áudio nem toca", () => {
    const a = criarAudio();
    const criarContexto = vi.fn(() => a.ctx);
    const f = criarFeedbackDoLeitor({
      som: false,
      vibracao: false,
      criarContexto,
    });
    f.confirmar();
    f.recusar();
    expect(criarContexto).not.toHaveBeenCalled();
    expect(a.oscilador.start).not.toHaveBeenCalled();
  });

  it("depois de encerrar, nenhum bip novo toca", () => {
    const a = criarAudio();
    const f = criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => a.ctx,
    });
    f.confirmar();
    expect(a.oscilador.start).toHaveBeenCalledTimes(1);
    f.encerrar();
    f.confirmar();
    f.recusar();
    expect(a.oscilador.start).toHaveBeenCalledTimes(1);
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it("encerrar antes do primeiro bip nunca chega a criar o áudio", () => {
    const a = criarAudio();
    const criarContexto = vi.fn(() => a.ctx);
    const f = criarFeedbackDoLeitor({ vibracao: false, criarContexto });
    f.encerrar();
    f.confirmar();
    expect(criarContexto).not.toHaveBeenCalled();
    expect(a.close).not.toHaveBeenCalled();
  });

  it("close() que lança não propaga o erro", () => {
    const a = criarAudio();
    a.close.mockImplementation(() => {
      throw new Error("falha ao fechar");
    });
    const f = criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => a.ctx,
    });
    f.confirmar();
    expect(() => f.encerrar()).not.toThrow();
  });
});

describe("feedback do leitor: áudio suspenso e falhas", () => {
  it("contexto suspenso é retomado antes do bip; em execução, não", () => {
    const suspenso = criarAudio("suspended");
    criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => suspenso.ctx,
    }).confirmar();
    expect(suspenso.resume).toHaveBeenCalledTimes(1);
    expect(suspenso.oscilador.start).toHaveBeenCalledTimes(1);

    const rodando = criarAudio("running");
    criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => rodando.ctx,
    }).confirmar();
    expect(rodando.resume).not.toHaveBeenCalled();
  });

  it("retomada recusada pelo navegador não gera erro", async () => {
    const a = criarAudio("suspended");
    a.resume.mockImplementation(() => Promise.reject(new Error("autoplay")));
    const f = criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => a.ctx,
    });
    expect(() => f.confirmar()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("navegador sem áudio (criarContexto devolve null) tenta só uma vez e não lança", () => {
    const criarContexto = vi.fn(() => null);
    const f = criarFeedbackDoLeitor({ vibracao: false, criarContexto });
    expect(() => {
      f.confirmar();
      f.recusar();
      f.encerrar();
    }).not.toThrow();
    expect(criarContexto).toHaveBeenCalledTimes(1);
  });

  it("criarContexto que lança é tentado uma vez só", () => {
    const criarContexto = vi.fn(() => {
      throw new Error("sem áudio");
    });
    const f = criarFeedbackDoLeitor({ vibracao: false, criarContexto });
    f.confirmar();
    f.recusar();
    expect(criarContexto).toHaveBeenCalledTimes(1);
  });

  it("createOscillator que lança não derruba a venda, e a vibração ainda sai", () => {
    const vibrate = comVibracao();
    const a = criarAudio();
    a.contexto.createOscillator.mockImplementation(() => {
      throw new Error("sem oscilador");
    });
    const f = criarFeedbackDoLeitor({ criarContexto: () => a.ctx });
    expect(() => f.confirmar()).not.toThrow();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
