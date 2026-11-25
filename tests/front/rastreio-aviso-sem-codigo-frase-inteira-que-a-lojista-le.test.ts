// Caça por mutação (25/11/2026), aviso de rastreio da ficha do pedido.
// Os testes de corte do código inválido só conferiam um pedaço ("Sem código
// salvo") da frase de quando NÃO há código. Trocar "A caminho" por outra
// palavra, ou tirar a orientação "salve antes de avançar", passava sem teste
// reclamar. É essa frase que diz à lojista o que a cliente vai ver e o que ela
// deve fazer, então ela fica fixada inteira.
import { avisoDeRastreio } from "@/components/admin/orders/aviso-de-rastreio";
import { describe, expect, it } from "vitest";

const SEM_CODIGO =
  "Sem código salvo, a cliente vê “A caminho”, mas não consegue rastrear. Se já tem o código, salve antes de avançar.";

describe("avisoDeRastreio: pedido sem código salvo", () => {
  it.each([
    ["texto vazio", ""],
    ["nulo", null],
    ["ausente", undefined],
    ["só espaços e quebra de linha", " \n\t "],
  ])("%s => frase inteira de 'sem código salvo'", (_nome, codigo) => {
    expect(avisoDeRastreio(codigo)).toBe(SEM_CODIGO);
  });
});
