// Achado por mutação, 25/11/2026: tirar a guarda `selecionadoId ? ... : undefined`
// de `enderecoDeEntregaEfetivo` deixava a suíte verde. Sem a guarda, "ninguém
// escolheu" (`null`, `undefined` ou texto vazio) era comparado com o `id` de
// cada endereço: uma linha de cache velho ou rascunho local sem `id` (ou com
// `id` vazio) passava a ser tratada como "o endereço escolhido" e o frete era
// cotado para ela, em vez de para o endereço principal. Só endereços fictícios.
import { enderecoDeEntregaEfetivo } from "@/lib/endereco-de-entrega";
import type { Address } from "@/types";
import { describe, expect, it } from "vitest";

function endereco(id: string | undefined, extra: Partial<Address> = {}) {
  return {
    id,
    user_id: "conta-1",
    name: "Casa",
    recipient_name: "Fulana de Tal",
    cep: "38500000",
    street: "Rua Exemplo",
    number: "10",
    neighborhood: "Centro",
    city: "Cidade Exemplo",
    state: "MG",
    is_default: false,
    ...extra,
  } as Address;
}

describe("enderecoDeEntregaEfetivo — sem escolha não casa com endereço sem id", () => {
  it("escolha vazia não pega o endereço de id vazio: vale o principal", () => {
    const semId = endereco("");
    const principal = endereco("b", { is_default: true });
    expect(enderecoDeEntregaEfetivo([semId, principal], "")).toBe(principal);
    expect(enderecoDeEntregaEfetivo([semId, principal], null)).toBe(principal);
  });

  it("escolha ausente não pega o endereço sem a chave id: vale o principal", () => {
    const semId = endereco(undefined);
    const principal = endereco("b", { is_default: true });
    expect(enderecoDeEntregaEfetivo([semId, principal], undefined)).toBe(
      principal,
    );
    expect(enderecoDeEntregaEfetivo([semId, principal], null)).toBe(principal);
  });

  it("sem escolha e sem principal marcado, o primeiro da lista, não o de id vazio", () => {
    const primeiro = endereco("a");
    const semId = endereco("");
    expect(enderecoDeEntregaEfetivo([primeiro, semId], "")).toBe(primeiro);
  });
});
