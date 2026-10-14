// De QUEM são o nome e o WhatsApp do rascunho do checkout (dado de cliente):
// só voltam para a mesma conta; o de convidado vale para quem entrar no meio
// da compra; rascunho de antes do campo NÃO conta como convidado.
import { describe, expect, it } from "vitest";

import {
  dadosDoRascunhoValemPara,
  lerRascunhoDoCheckout,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";

function armazem(inicial?: Record<string, unknown>) {
  const mapa = new Map<string, string>();
  const chave = "ikcous-rascunho-do-checkout-v1";
  if (inicial) mapa.set(chave, JSON.stringify(inicial));
  return {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
  };
}

const BASE = {
  nome: "Maria",
  whatsapp: "(34) 98888-7777",
  cep: "",
  numero: "",
  rua: "",
  bairro: "",
  cidade: "",
  estado: "",
  complemento: "",
  notas: "",
  cupom: null,
};

describe("dadosDoRascunhoValemPara", () => {
  it.each([
    ["mesma conta", "user-1", "user-1", true],
    ["outra conta", "user-1", "user-2", false],
    ["conta → convidado", "user-1", null, false],
    ["convidado → conta (entrou no meio da compra)", null, "user-2", true],
    ["convidado → convidado", null, null, true],
    ["sem dono → conta", undefined, "user-1", false],
    ["sem dono → convidado", undefined, null, true],
  ])("%s", (_nome, dono, agora, esperado) => {
    expect(dadosDoRascunhoValemPara(dono, agora)).toBe(esperado);
  });
});

describe("rascunho guarda o dono dos dados", () => {
  it("conta: grava e lê o id", () => {
    const a = armazem();
    salvarRascunhoDoCheckout(a, { ...BASE, contaDosDados: "user-1" });
    expect(lerRascunhoDoCheckout(a)?.contaDosDados).toBe("user-1");
  });

  it("convidado: `null` explícito se mantém `null`", () => {
    const a = armazem();
    salvarRascunhoDoCheckout(a, { ...BASE, contaDosDados: null });
    expect(lerRascunhoDoCheckout(a)?.contaDosDados).toBeNull();
  });

  it("rascunho de antes do campo e valor ilegível ficam `undefined` (desconhecido)", () => {
    expect(
      lerRascunhoDoCheckout(armazem({ ...BASE }))?.contaDosDados,
    ).toBeUndefined();
    expect(
      lerRascunhoDoCheckout(armazem({ ...BASE, contaDosDados: 42 }))
        ?.contaDosDados,
    ).toBeUndefined();
    expect(
      lerRascunhoDoCheckout(armazem({ ...BASE, contaDosDados: "" }))
        ?.contaDosDados,
    ).toBeUndefined();
  });
});
