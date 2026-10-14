// @vitest-environment jsdom
//
// WhatsApp colado com ZERO na frente virava OUTRO número (14/10/2026):
// "034 99999-1234" aparecia como "(03) 49999-9123" sem erro e gravava
// 5503499999123. DDD brasileiro nunca começa com 0: o zero inicial (prefixo
// de tronco "0", e o "0 + 2 dígitos da operadora") é descartado ao colar, ao
// digitar e ao gravar. Reaproveita `telefone-br` — a regra de "colagem x
// digitação" já decidida lá continua valendo.
import { act } from "react";

import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import {
  numeroParaOCampo,
  whatsappParaGravar,
} from "@/components/admin/minha-loja/contato";
import {
  limparTelefoneBrasileiro,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
} from "@/lib/telefone-br";

describe("limparTelefoneBrasileiro: zero na frente", () => {
  it("colar 034 99999-1234 vira 34999991234", () => {
    expect(limparTelefoneBrasileiro("034 99999-1234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("(034) 99999-1234")).toBe("34999991234");
  });

  it("fixo com zero: 034 3333-1234", () => {
    expect(limparTelefoneBrasileiro("034 3333-1234")).toBe("3433331234");
  });

  it("0 + operadora + DDD (0xx34): descarta o zero e a operadora", () => {
    expect(limparTelefoneBrasileiro("0 14 34 99999-1234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("014 34 3333-1234")).toBe("3433331234");
  });

  it("0 com +55 ou 0055 ainda cai no 55 do país", () => {
    expect(limparTelefoneBrasileiro("0055 34 99999-1234")).toBe("34999991234");
  });

  it("número sem zero fica inalterado", () => {
    expect(limparTelefoneBrasileiro("34999991234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("(34) 99999-1234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("+55 34 99999-1234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("5534999991234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("55999991234")).toBe("55999991234");
  });

  it("estrangeiro com 00 de discagem internacional não perde dígito", () => {
    expect(limparTelefoneBrasileiro("00351912345678")).toBe("351912345678");
  });

  it("digitação: zero na frente é descartado, sem mexer no resto", () => {
    expect(limparTelefoneBrasileiro("0", { colagem: false })).toBe("");
    expect(limparTelefoneBrasileiro("034", { colagem: false })).toBe("34");
    expect(limparTelefoneBrasileiro("559999912345", { colagem: false })).toBe(
      "559999912345",
    );
  });
});

function teclarSeguido(
  mascara: (novo: string, anterior?: string) => string,
  teclas: string[],
) {
  let campo = "";
  for (const t of teclas) campo = mascara(campo + t, campo);
  return campo;
}

describe.each([
  ["checkout/busca de pedido", mascaraWhatsappBr],
  ["cadastro", mascaraTelefoneDoCadastro],
])("máscara real: %s", (_nome, mascara) => {
  it("colar 034 99999-1234 mostra (34) 99999-1234", () => {
    expect(mascara("034 99999-1234", "")).toBe("(34) 99999-1234");
  });

  it("digitar com zero na frente, tecla a tecla, mostra (34) 99999-1234", () => {
    expect(teclarSeguido(mascara, [..."034999991234"])).toBe("(34) 99999-1234");
  });

  it("controle: digitado normalmente, sem zero, como antes", () => {
    expect(teclarSeguido(mascara, [..."34999991234"])).toBe("(34) 99999-1234");
    expect(mascara("+55 34 99999-1234", "")).toBe("(34) 99999-1234");
  });
});

describe("o que vai ao banco (WhatsApp da loja)", () => {
  it("034 99999-1234 grava 5534999991234", () => {
    expect(whatsappParaGravar("034 99999-1234")).toEqual({
      valido: true,
      valor: "5534999991234",
    });
    expect(whatsappParaGravar("034999991234")).toEqual({
      valido: true,
      valor: "5534999991234",
    });
    expect(whatsappParaGravar("0 14 34 99999-1234")).toEqual({
      valido: true,
      valor: "5534999991234",
    });
  });

  it("controle: sem zero, com +55 e 55 já gravado seguem iguais", () => {
    expect(whatsappParaGravar("(34) 99999-1234")).toEqual({
      valido: true,
      valor: "5534999991234",
    });
    expect(whatsappParaGravar("+55 34 99999-1234")).toEqual({
      valido: true,
      valor: "5534999991234",
    });
    expect(whatsappParaGravar("5534999991234")).toEqual({
      valido: true,
      valor: "5534999991234",
    });
    expect(whatsappParaGravar("55991234567")).toEqual({
      valido: true,
      valor: "5555991234567",
    });
    expect(whatsappParaGravar("")).toEqual({ valido: true, valor: null });
    expect(whatsappParaGravar("119876543")).toEqual({ valido: false });
  });

  it("o campo reabre o número com zero na frente sem comer dígito", () => {
    expect(numeroParaOCampo("034999991234")).toBe("34999991234");
    expect(numeroParaOCampo("5534999991234")).toBe("34999991234");
  });
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("LocalBufferedInput mask=phone (campo do WhatsApp da loja)", () => {
  let raiz: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => raiz?.unmount());
    host?.remove();
    raiz = null;
    host = null;
  });

  function colar(valor: string): string {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz?.render(
        <LocalBufferedInput mask="phone" value="" onFlush={() => {}} />,
      );
    });
    const campo = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return campo.value;
  }

  it("colar 034 99999-1234 mostra (34) 99999-1234", () => {
    expect(colar("034 99999-1234")).toBe("(34) 99999-1234");
  });

  it("controle: colar sem zero e com +55 como antes", () => {
    expect(colar("34 99999-1234")).toBe("(34) 99999-1234");
  });
});
