// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsAppDaLoja } from "@/components/admin/minha-loja/WhatsAppDaLoja";
import {
  dddBrasileiroValido,
  whatsappParaGravar,
} from "@/components/admin/minha-loja/contato";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mensagem = "Confira o DDD: esse DDD não existe.";

// DDDs que não existem no Brasil (a faixa de cada dezena tem buracos).
const DDDS_INEXISTENTES = [
  "10",
  "20",
  "23",
  "25",
  "26",
  "29",
  "30",
  "36",
  "39",
  "40",
  "50",
  "52",
  "56",
  "57",
  "58",
  "59",
  "60",
  "70",
  "72",
  "76",
  "78",
  "80",
  "90",
];

const DDDS_VALIDOS = [
  "11",
  "21",
  "22",
  "24",
  "27",
  "28",
  "31",
  "34",
  "41",
  "47",
  "51",
  "55",
  "61",
  "71",
  "79",
  "81",
  "85",
  "92",
  "99",
];

describe("Contato da loja — DDD que não existe no Brasil", () => {
  it.each(DDDS_INEXISTENTES)("o DDD %s não vale", (ddd) => {
    expect(dddBrasileiroValido(ddd)).toBe(false);
  });

  it.each(DDDS_VALIDOS)("o DDD %s vale", (ddd) => {
    expect(dddBrasileiroValido(ddd)).toBe(true);
  });

  it.each(DDDS_INEXISTENTES)(
    "recusa gravar celular e fixo com DDD %s, com e sem o 55",
    (ddd) => {
      for (const numero of [
        `${ddd}912345678`,
        `${ddd}32123456`,
        `55${ddd}912345678`,
      ]) {
        expect(whatsappParaGravar(numero)).toEqual({ valido: false });
      }
      expect(whatsappParaGravar(`${ddd}912345678`, true)).toEqual({
        valido: false,
      });
    },
  );

  it("o caso do defeito: (20) 91234-5678 não grava 5520912345678", () => {
    expect(whatsappParaGravar("(20) 91234-5678")).toEqual({ valido: false });
    expect(whatsappParaGravar("5520912345678")).toEqual({ valido: false });
  });

  it.each(DDDS_VALIDOS)("continua gravando com o DDD %s", (ddd) => {
    expect(whatsappParaGravar(`${ddd}912345678`)).toEqual({
      valido: true,
      valor: `55${ddd}912345678`,
    });
    expect(whatsappParaGravar(`${ddd}32123456`, true)).toEqual({
      valido: true,
      valor: `55${ddd}32123456`,
    });
    expect(whatsappParaGravar(`+55${ddd}912345678`)).toEqual({
      valido: true,
      valor: `55${ddd}912345678`,
    });
  });

  it("vazio continua valendo (apaga o número)", () => {
    expect(whatsappParaGravar("")).toEqual({ valido: true, valor: null });
  });

  let raiz: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => raiz?.unmount());
    host?.remove();
  });

  function abrir(valor: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz?.render(<WhatsAppDaLoja valor={valor} onMudar={vi.fn()} />);
    });
    return host.querySelector("input") as HTMLInputElement;
  }

  it.each(["20912345678", "(23) 3212-3456", "+55 70 91234-5678"])(
    "mostra no campo o aviso de DDD inexistente ao digitar %s",
    (numero) => {
      const campo = abrir("");
      act(() => {
        campo.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(campo, numero);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(host?.textContent).toContain(mensagem);
    },
  );

  it.each(["11987654321", "3432221234", ""])(
    "não acusa DDD no número válido ou opcional %s",
    (numero) => {
      const campo = abrir(numero);
      expect(campo.getAttribute("aria-invalid")).not.toBe("true");
      expect(host?.textContent).not.toContain(mensagem);
    },
  );
});
