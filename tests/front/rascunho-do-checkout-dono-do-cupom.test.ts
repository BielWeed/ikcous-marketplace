// De QUEM era o cupom do rascunho do checkout (frente B, 28/09/2026).
//
// O risco: com cupom EXCLUSIVO, o código de uma conta não pode reaparecer na
// tela de outra conta que abra o checkout na mesma aba (o rascunho vive em
// sessionStorage, que é da ABA, não da conta). O rascunho carrega o id de
// quem aplicou o cupom (`contaDoCupom`) para o CheckoutView só restaurar o
// cupom para a MESMA conta. Este arquivo prova o lado do armazenamento: o dono
// vai e volta íntegro, e QUALQUER dúvida lida do storage vira "convidado"
// (`null`) — nunca um id inventado, nunca `undefined`.
import type { ArmazenamentoSimples } from "@/lib/chave-do-pedido";
import {
  lerRascunhoDoCheckout,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import { beforeEach, describe, expect, it } from "vitest";

const CHAVE = "ikcous-rascunho-do-checkout-v1";

function criarStorage(): ArmazenamentoSimples & { mapa: Map<string, string> } {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (k) => mapa.get(k) ?? null,
    setItem: (k, v) => void mapa.set(k, v),
    removeItem: (k) => void mapa.delete(k),
  };
}

let storage: ReturnType<typeof criarStorage>;

beforeEach(() => {
  storage = criarStorage();
});

describe("rascunho-do-checkout — dono do cupom", () => {
  it("rascunho novo nasce sem dono (convidado)", () => {
    expect(rascunhoVazio().contaDoCupom).toBeNull();
  });

  it("o id da conta que aplicou o cupom volta íntegro", () => {
    salvarRascunhoDoCheckout(storage, {
      ...rascunhoVazio(),
      cupom: "VIP15",
      contaDoCupom: "conta-da-ana",
    });
    const lido = lerRascunhoDoCheckout(storage);
    expect(lido?.cupom).toBe("VIP15");
    expect(lido?.contaDoCupom).toBe("conta-da-ana");
  });

  it("cupom aplicado por convidado é lido como convidado (null), não como conta", () => {
    salvarRascunhoDoCheckout(storage, {
      ...rascunhoVazio(),
      cupom: "VITRINE10",
      contaDoCupom: null,
    });
    expect(lerRascunhoDoCheckout(storage)?.contaDoCupom).toBeNull();
  });

  it("rascunho ANTIGO, gravado antes do campo existir, conta como convidado", () => {
    // Já havia gente com rascunho na aba quando o campo nasceu: sem
    // `contaDoCupom`, o valor lido é `null` (e não `undefined`), para o
    // CheckoutView tratar como convidado e nunca como "qualquer conta".
    storage.mapa.set(CHAVE, JSON.stringify({ nome: "Maria", cupom: "VIP15" }));
    const lido = lerRascunhoDoCheckout(storage);
    expect(lido?.cupom).toBe("VIP15");
    expect(lido?.contaDoCupom).toBeNull();
  });

  it.each([
    ["número", 123],
    ["objeto", { id: "conta-da-ana" }],
    ["lista", ["conta-da-ana"]],
    ["booleano", true],
    ["texto vazio", ""],
    ["null", null],
  ])(
    "dono que não é texto útil (%s) vira convidado, não é coagido",
    (_nome, valor) => {
      storage.mapa.set(
        CHAVE,
        JSON.stringify({ cupom: "VIP15", contaDoCupom: valor }),
      );
      expect(lerRascunhoDoCheckout(storage)?.contaDoCupom).toBeNull();
    },
  );

  it("a Bia gravando por cima apaga a marca da Ana (nada de dono misturado)", () => {
    salvarRascunhoDoCheckout(storage, {
      ...rascunhoVazio(),
      cupom: "VIP15",
      contaDoCupom: "conta-da-ana",
    });
    salvarRascunhoDoCheckout(storage, {
      ...rascunhoVazio(),
      cupom: "VITRINE10",
      contaDoCupom: "conta-da-bia",
    });
    const lido = lerRascunhoDoCheckout(storage);
    expect(lido?.contaDoCupom).toBe("conta-da-bia");
    expect(JSON.stringify(lido)).not.toContain("conta-da-ana");
  });

  it("o id da conta é só o id: nada de CPF, e-mail ou nome vai junto com o dono", () => {
    salvarRascunhoDoCheckout(storage, {
      ...rascunhoVazio(),
      cupom: "VIP15",
      contaDoCupom: "conta-da-ana",
    });
    const gravado = storage.mapa.get(CHAVE) ?? "";
    expect(Object.keys(JSON.parse(gravado)).sort()).toEqual(
      [
        "bairro",
        "cep",
        "cidade",
        "complemento",
        "contaDoCupom",
        "cupom",
        "estado",
        "nome",
        "notas",
        "numero",
        "rua",
        "whatsapp",
      ].sort(),
    );
  });
});
