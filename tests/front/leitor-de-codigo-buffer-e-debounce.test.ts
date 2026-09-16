// Sem jsdom: as três peças (buffer do leitor físico, debounce de 1,5s e
// feedback de bip/vibração) são puras — nada de `document`/`window`. O
// relógio é SEMPRE injetado (`agora: () => t`), nunca `vi.useFakeTimers`,
// porque é assim que os módulos foram desenhados (tarefa C2.2).
import { criarFeedbackDoLeitor } from "@/lib/feedback-do-leitor";
import {
  type TeclaDoLeitor,
  criarBufferDoLeitorFisico,
  focoEstaEmCampoEditavel,
} from "@/lib/leitor/buffer-do-leitor-fisico";
import { criarDebounceDeLeitura } from "@/lib/leitor/debounce-de-leitura";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("buffer do leitor físico (USB/Bluetooth)", () => {
  let t = 0;
  const agora = () => t;
  let lidos: string[];

  beforeEach(() => {
    t = 0;
    lidos = [];
  });

  function tecla(
    key: string,
    extra: Partial<TeclaDoLeitor> = {},
  ): TeclaDoLeitor {
    return { key, ...extra };
  }

  function digitarRapido(
    buffer: ReturnType<typeof criarBufferDoLeitorFisico>,
    keys: readonly string[],
    passoMs = 10,
    extra: Partial<TeclaDoLeitor> = {},
  ): void {
    for (const key of keys) {
      buffer.aoPressionarTecla(tecla(key, extra));
      t += passoMs;
    }
  }

  it("1. dígitos rápidos (10ms entre teclas) + Enter -> lê o código uma vez", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    digitarRapido(buffer, ["7", "8", "9", "1"]);
    buffer.aoPressionarTecla(tecla("Enter"));
    expect(lidos).toEqual(["7891"]);
  });

  it("2. dígitos com 200ms entre eles reiniciam o buffer a cada tecla; Enter não dispara (1 caractere, abaixo do mínimo)", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    digitarRapido(buffer, ["7", "8", "9", "1"], 200);
    buffer.aoPressionarTecla(tecla("Enter"));
    expect(lidos).toEqual([]);
  });

  it("3. foco em INPUT -> nada é acumulado, o Enter seguinte não dispara", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    const alvo = { tagName: "INPUT" } as unknown as EventTarget;
    digitarRapido(buffer, ["7", "8", "9", "1"], 10, { target: alvo });
    buffer.aoPressionarTecla(tecla("Enter", { target: alvo }));
    expect(lidos).toEqual([]);
  });

  it("4. foco em elemento contentEditable -> nada é acumulado, o Enter seguinte não dispara", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    const alvo = {
      tagName: "DIV",
      isContentEditable: true,
    } as unknown as EventTarget;
    digitarRapido(buffer, ["7", "8", "9", "1"], 10, { target: alvo });
    buffer.aoPressionarTecla(tecla("Enter", { target: alvo }));
    expect(lidos).toEqual([]);
  });

  it("5. alvo é uma DIV comum (não editável) -> lê normalmente", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    const alvo = { tagName: "DIV" } as unknown as EventTarget;
    digitarRapido(buffer, ["7", "8", "9", "1"], 10, { target: alvo });
    buffer.aoPressionarTecla(tecla("Enter", { target: alvo }));
    expect(lidos).toEqual(["7891"]);
  });

  it("6. ctrlKey no meio descarta o que havia acumulado", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    digitarRapido(buffer, ["7", "8"]);
    buffer.aoPressionarTecla(tecla("c", { ctrlKey: true }));
    t += 10;
    digitarRapido(buffer, ["9", "1", "2", "3"]);
    buffer.aoPressionarTecla(tecla("Enter"));
    // Só o que veio DEPOIS do Ctrl é lido — o "78" de antes foi descartado.
    expect(lidos).toEqual(["9123"]);
  });

  it("7. Shift no meio NÃO descarta o buffer (Code 39 usa letra maiúscula)", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    digitarRapido(buffer, ["7", "8"]);
    buffer.aoPressionarTecla(tecla("Shift"));
    t += 10;
    digitarRapido(buffer, ["9", "1"]);
    buffer.aoPressionarTecla(tecla("Enter"));
    expect(lidos).toEqual(["7891"]);
  });

  it("8. 70 caracteres seguidos + Enter -> nada é lido (estourou os 64 do teto)", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    const setenta = Array.from({ length: 70 }, (_, i) => String(i % 10));
    digitarRapido(buffer, setenta, 5);
    buffer.aoPressionarTecla(tecla("Enter"));
    expect(lidos).toEqual([]);
  });

  it("9. Enter com buffer de 2 caracteres -> nada é lido e preventDefault NÃO é chamado", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    digitarRapido(buffer, ["7", "8"]);
    const preventDefault = vi.fn();
    buffer.aoPressionarTecla(tecla("Enter", { preventDefault }));
    expect(lidos).toEqual([]);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("10. Enter com buffer válido -> preventDefault É chamado", () => {
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
    digitarRapido(buffer, ["7", "8", "9", "1"]);
    const preventDefault = vi.fn();
    buffer.aoPressionarTecla(tecla("Enter", { preventDefault }));
    expect(lidos).toEqual(["7891"]);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("11. focoEstaEmCampoEditavel(null | undefined) é false", () => {
    expect(focoEstaEmCampoEditavel(null)).toBe(false);
    expect(focoEstaEmCampoEditavel(undefined)).toBe(false);
  });
});

describe("debounce de leitura (janela de 1,5s)", () => {
  let t = 0;
  const agora = () => t;

  beforeEach(() => {
    t = 0;
  });

  it("12. mesmo código em t=0 (aceita) e t=1499 (recusa)", () => {
    const debounce = criarDebounceDeLeitura({ agora });
    t = 0;
    expect(debounce.aceita("7891000315507")).toBe(true);
    t = 1499;
    expect(debounce.aceita("7891000315507")).toBe(false);
  });

  it("13. em t=1500 aceita de novo (borda: '< janela' recusa, '>= janela' aceita)", () => {
    const debounce = criarDebounceDeLeitura({ agora });
    t = 0;
    expect(debounce.aceita("X")).toBe(true);
    t = 1500;
    expect(debounce.aceita("X")).toBe(true);
  });

  it("14. a recusa NÃO empurra a janela: código parado na frente da câmera é aceito de novo 1,5s depois do PRIMEIRO aceite, não do último quadro", () => {
    const debounce = criarDebounceDeLeitura({ agora });
    t = 0;
    expect(debounce.aceita("X")).toBe(true);
    t = 500;
    expect(debounce.aceita("X")).toBe(false);
    t = 1000;
    expect(debounce.aceita("X")).toBe(false);
    t = 1400;
    expect(debounce.aceita("X")).toBe(false);
    t = 1500;
    // Se cada recusa tivesse empurrado o instante lembrado, este código
    // nunca mais seria aceito — é exatamente o defeito clássico desta peça.
    expect(debounce.aceita("X")).toBe(true);
  });

  it("15. códigos diferentes não se atrapalham", () => {
    const debounce = criarDebounceDeLeitura({ agora });
    t = 0;
    expect(debounce.aceita("A")).toBe(true);
    expect(debounce.aceita("B")).toBe(true);
    t = 500;
    expect(debounce.aceita("A")).toBe(false);
    expect(debounce.aceita("B")).toBe(false);
  });

  it("16. esquecer(codigo) faz o próximo aceitar na hora", () => {
    const debounce = criarDebounceDeLeitura({ agora });
    t = 0;
    expect(debounce.aceita("X")).toBe(true);
    t = 100;
    expect(debounce.aceita("X")).toBe(false);
    debounce.esquecer("X");
    t = 101;
    expect(debounce.aceita("X")).toBe(true);
  });

  it("17. 51 códigos distintos deixam o Map com no máximo 50 entradas; o mais antigo volta a ser aceito na hora", () => {
    const debounce = criarDebounceDeLeitura({ agora });
    for (let i = 0; i < 51; i++) {
      t = i;
      expect(debounce.aceita(`codigo-${i}`)).toBe(true);
    }
    t = 51;
    // Se "codigo-0" ainda estivesse no Map, 51 - 0 = 51ms está BEM dentro
    // da janela de 1500ms e seria recusado. Aceitar de novo prova, pelo
    // comportamento (sem espiar o Map), que o teto de 50 expulsou o mais
    // antigo.
    expect(debounce.aceita("codigo-0")).toBe(true);
  });
});

describe("feedback do leitor (bip + vibração)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function criarContextoDubleFuncional() {
    const oscilador = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const ganho = { gain: { value: 0 }, connect: vi.fn() };
    const contexto = {
      state: "running" as AudioContextState,
      currentTime: 0,
      destination: {},
      createOscillator: () => oscilador,
      createGain: () => ganho,
      resume: () => Promise.resolve(),
      close: vi.fn(),
    };
    return contexto as unknown as AudioContext;
  }

  it("18. sem navigator.vibrate, confirmar() não lança", () => {
    const feedback = criarFeedbackDoLeitor({ som: false });
    expect(() => feedback.confirmar()).not.toThrow();
  });

  it("19. com navigator.vibrate dublê, confirmar() chama vibrate uma vez", () => {
    const vibrate = vi.fn();
    // `vi.stubGlobal` troca `globalThis.navigator` por um dublê; o `vibrate`
    // entra por `Object.defineProperty` em cima dele, no mesmo molde de
    // tests/front/useorders-admin-rele-status-antes-de-avancar.test.tsx:220.
    vi.stubGlobal("navigator", {});
    Object.defineProperty(globalThis.navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    const feedback = criarFeedbackDoLeitor({ som: false });
    feedback.confirmar();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("20. criarContexto só é chamado NA PRIMEIRA chamada de confirmar/recusar, nunca em criarFeedbackDoLeitor", () => {
    const criarContexto = vi.fn(criarContextoDubleFuncional);
    const feedback = criarFeedbackDoLeitor({ vibracao: false, criarContexto });
    expect(criarContexto).not.toHaveBeenCalled();

    feedback.confirmar();
    expect(criarContexto).toHaveBeenCalledTimes(1);

    feedback.recusar();
    // Memoizado no fecho: a segunda chamada reusa o MESMO AudioContext, não
    // cria outro (criar um por bip acordaria o navegador a cada leitura).
    expect(criarContexto).toHaveBeenCalledTimes(1);
  });

  it("21. criarContexto que lança -> confirmar() não lança (som é enfeite, nunca derruba a venda)", () => {
    const criarContexto = vi.fn(() => {
      throw new Error("AudioContext indisponível neste ambiente de teste");
    });
    const feedback = criarFeedbackDoLeitor({ vibracao: false, criarContexto });
    expect(() => feedback.confirmar()).not.toThrow();
  });

  it("22. encerrar() duas vezes chama close() uma vez só", () => {
    const contexto = criarContextoDubleFuncional();
    const feedback = criarFeedbackDoLeitor({
      vibracao: false,
      criarContexto: () => contexto,
    });
    feedback.confirmar();
    feedback.encerrar();
    feedback.encerrar();
    expect(contexto.close).toHaveBeenCalledTimes(1);
  });
});
