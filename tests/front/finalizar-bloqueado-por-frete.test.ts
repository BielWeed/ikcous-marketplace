import { finalizarBloqueadoPorFrete } from "@/lib/guarda-de-frete";
// Laudo caça-bugs 31/08 (B2): a guarda do Finalizar vivia inline no
// CheckoutView e ignorava a bandeira `freteIndefinido` — provedor de
// cotação com taxa 0 deixava `shipping === 0`, a guarda velha não
// disparava, e o pedido fechava com frete R$ 0 sem cotação nenhuma.
//
// POR QUE UNIT E NÃO COMPONENTE: a guarda pura discrimina com o PAR exato
// do defeito (indefinido+0 trava / definido+0 livra) sem precisar de um
// formulário de convidado inteiro válido dentro do jsdom — no componente,
// `isValid` do react-hook-form não sobe de forma confiável nesse harness e
// o par testado ali passava pelo motivo errado (formulário invalido trava
// nos dois cenários). A cadeia completa fica: CartContext prova a bandeira
// (frete-indefinido-sem-cep-de-origem.test.tsx) → esta suíte prova a
// guarda → o CheckoutView a consome com 1 linha visível no diff.
import { describe, expect, it } from "vitest";

const base = {
  carrinhoVazio: false,
  freteIndefinido: false,
  shipping: 0,
  temOpcaoSelecionada: false,
};

describe("finalizarBloqueadoPorFrete — a guarda do dinheiro de frete", () => {
  it("O DEFEITO B2: frete indefinido com shipping R$ 0 -> TRAVADO", () => {
    // Na guarda velha (`shipping > 0 && !opcao`): shipping 0 -> LIVRE — o
    // pedido fechava sem cotação nenhuma. É o mutante que este teste mata.
    expect(finalizarBloqueadoPorFrete({ ...base, freteIndefinido: true })).toBe(
      true,
    );
  });

  it("controle do B2: frete definido com shipping R$ 0 (taxa 0 de propósito) -> LIVRE", () => {
    expect(
      finalizarBloqueadoPorFrete({ ...base, freteIndefinido: false }),
    ).toBe(false);
  });

  it("o defeito ORIGINAL de 18/08: frete positivo sem opção escolhida -> TRAVADO (continua)", () => {
    expect(
      finalizarBloqueadoPorFrete({
        ...base,
        shipping: 15,
        temOpcaoSelecionada: false,
      }),
    ).toBe(true);
  });

  it("frete positivo COM opção escolhida -> LIVRE", () => {
    expect(
      finalizarBloqueadoPorFrete({
        ...base,
        shipping: 15,
        temOpcaoSelecionada: true,
      }),
    ).toBe(false);
  });

  it("carrinho vazio -> LIVRE (a tela nem mostra o botão)", () => {
    expect(
      finalizarBloqueadoPorFrete({
        carrinhoVazio: true,
        freteIndefinido: true,
        shipping: 15,
        temOpcaoSelecionada: false,
      }),
    ).toBe(false);
  });

  it("frete indefinido com opção selecionada -> LIVRE (escolher opção define o frete)", () => {
    expect(
      finalizarBloqueadoPorFrete({
        ...base,
        freteIndefinido: true,
        temOpcaoSelecionada: true,
      }),
    ).toBe(false);
  });
});
