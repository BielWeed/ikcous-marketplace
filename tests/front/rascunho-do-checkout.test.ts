import type { ArmazenamentoSimples } from "@/lib/chave-do-pedido";
import {
  lerRascunhoDoCheckout,
  limparRascunhoDoCheckout,
  rascunhoTemConteudo,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import { beforeEach, describe, expect, it } from "vitest";

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
    salvarRascunhoDoCheckout(storage, rascunhoCheio);
    expect(lerRascunhoDoCheckout(storage)).toEqual(rascunhoCheio);
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
