import type { ArmazenamentoSimples } from "@/lib/chave-do-pedido";
import {
  lerRascunhoDoCheckout,
  limparRascunhoDoCheckout,
  rascunhoTemConteudo,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Armazenamento de teste: Map com o contrato de sessionStorage (mesma
// injeção dos testes de chave-do-pedido).
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

const rascunhoCheio = {
  ...rascunhoVazio(),
  nome: "Maria",
  whatsapp: "34999999999",
  cep: "38500-000",
  numero: "123",
  rua: "Rua da Prova",
  bairro: "Centro",
  cidade: "Araxá",
  estado: "MG",
  notas: "deixar na portaria",
  cupom: "CUPOM10",
};

describe("rascunho-do-checkout", () => {
  it("salva e relê o rascunho inteiro", () => {
    const rascunho = {
      ...rascunhoCheio,
      contaDosDados: null,
      dadosDoVisitanteAlteradosEm: Date.now(),
    };
    salvarRascunhoDoCheckout(storage, rascunho);
    expect(lerRascunhoDoCheckout(storage)).toEqual(rascunho);
  });

  describe("validade dos dados pessoais do visitante", () => {
    const agora = Date.UTC(2026, 10, 19, 12);
    const hora = 60 * 60 * 1000;
    const chave = "ikcous-rascunho-do-checkout-v1";
    const visitante = {
      ...rascunhoCheio,
      contaDosDados: null,
      complemento: "Casa",
      email: "teste@example.invalid",
    };

    beforeEach(() => {
      vi.spyOn(Date, "now").mockReturnValue(agora);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ["mais de 2 horas", agora - 3 * hora],
      ["2 horas e um milissegundo", agora - 2 * hora - 1],
      ["sem carimbo", undefined],
      ["carimbo inválido", "ontem"],
      ["carimbo futuro", agora + hora],
    ])("descarta só os dados pessoais do visitante: %s", (_caso, carimbo) => {
      storage.setItem(
        chave,
        JSON.stringify({ ...visitante, dadosDoVisitanteAlteradosEm: carimbo }),
      );

      const semDados = {
        ...rascunhoVazio(),
        contaDosDados: null,
        cupom: "CUPOM10",
      };
      expect(lerRascunhoDoCheckout(storage)).toEqual(semDados);
      expect(JSON.parse(storage.getItem(chave) ?? "null")).toEqual(semDados);
    });

    it.each([1, 2])("restaura o visitante com dados de %s h atrás", (horas) => {
      storage.setItem(
        chave,
        JSON.stringify({
          ...visitante,
          dadosDoVisitanteAlteradosEm: agora - horas * hora,
        }),
      );

      expect(lerRascunhoDoCheckout(storage)).toMatchObject({
        nome: visitante.nome,
        whatsapp: visitante.whatsapp,
        rua: visitante.rua,
        notas: visitante.notas,
        cupom: visitante.cupom,
      });
    });

    it("não restaura dados antigos sem dono, mas preserva o cupom", () => {
      storage.setItem(chave, JSON.stringify(rascunhoCheio));

      expect(lerRascunhoDoCheckout(storage)).toEqual({
        ...rascunhoVazio(),
        cupom: "CUPOM10",
      });
    });

    it("mantém o rascunho antigo que pertence a uma conta", () => {
      const daConta = { ...rascunhoCheio, contaDosDados: "user-1" };
      storage.setItem(chave, JSON.stringify(daConta));

      expect(lerRascunhoDoCheckout(storage)).toEqual(daConta);
      expect(storage.getItem(chave)).toBe(JSON.stringify(daConta));
    });
  });

  it("sem rascunho gravado, lê null (não objeto vazio)", () => {
    expect(lerRascunhoDoCheckout(storage)).toBeNull();
  });

  it("JSON estragado no storage vira null em vez de derrubar o checkout", () => {
    storage.setItem("ikcous-rascunho-do-checkout-v1", "{quebrado");
    expect(lerRascunhoDoCheckout(storage)).toBeNull();
  });

  it("higieniza: campo que não é string vira vazio e cupom vazio vira null", () => {
    storage.mapa.set(
      "ikcous-rascunho-do-checkout-v1",
      JSON.stringify({ nome: 42, cupom: "" }),
    );
    const lido = lerRascunhoDoCheckout(storage);
    expect(lido).not.toBeNull();
    expect(lido?.nome).toBe("");
    expect(lido?.cupom).toBeNull();
  });

  it("limpar apaga o rascunho (o sucesso esquece)", () => {
    salvarRascunhoDoCheckout(storage, rascunhoCheio);
    limparRascunhoDoCheckout(storage);
    expect(lerRascunhoDoCheckout(storage)).toBeNull();
  });

  it("rascunhoTemConteudo separa rascunho vazio de rascunho com qualquer campo", () => {
    expect(rascunhoTemConteudo(rascunhoVazio())).toBe(false);
    expect(rascunhoTemConteudo({ ...rascunhoVazio(), cupom: "X" })).toBe(true);
    expect(rascunhoTemConteudo({ ...rascunhoVazio(), numero: "12" })).toBe(
      true,
    );
  });

  it.each(["   ", "\u{200B}\u{2800}\u{3164}"])(
    "notas ou complemento só com espaço/invisível %j não são conteúdo",
    (texto) => {
      expect(rascunhoTemConteudo({ ...rascunhoVazio(), notas: texto })).toBe(
        false,
      );
      expect(
        rascunhoTemConteudo({ ...rascunhoVazio(), complemento: texto }),
      ).toBe(false);
      expect(
        rascunhoTemConteudo({
          ...rascunhoVazio(),
          notas: "  Deixar na portaria  ",
        }),
      ).toBe(true);
      expect(
        rascunhoTemConteudo({ ...rascunhoVazio(), complemento: "Casa" }),
      ).toBe(true);
    },
  );

  it("escrever falhado (storage cheio) não derruba a compra", () => {
    const storageCheio: ArmazenamentoSimples = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() =>
      salvarRascunhoDoCheckout(storageCheio, rascunhoCheio),
    ).not.toThrow();
  });
});
