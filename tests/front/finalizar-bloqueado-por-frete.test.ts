import { finalizarBloqueadoPorFrete } from "@/lib/guarda-de-frete";
// Laudo caça-bugs 31/08 (B2): a guarda do Finalizar vivia inline no
// CheckoutView e ignorava a bandeira `freteIndefinido` — provedor de
// cotação com taxa 0 deixava `shipping === 0`, a guarda velha não
// disparava, e o pedido fechava com frete R$ 0 sem cotação nenhuma.
//
// 🔴 REGRA APERTADA em 21/09/2026: o servidor passou a recusar pedido com
// id de entrega AUSENTE (FRETE V2 EMENDA 03/09, o ELSIF do bloco 4 da RPC
// viva — e a migration 20261168000000 aperta de novo ANTES do ramo do
// frete grátis), então o front exige a ESCOLHA, não o número: sem opção
// selecionada o Finalizar fica travado MESMO com `shipping === 0` de frete
// grátis legítimo. A calculadora segue no CartView também com frete grátis
// — escolher a opção não custa a gratuidade.
//
// POR QUE UNIT E NÃO COMPONENTE: a guarda pura discrimina com o PAR exato
// do defeito (sem opção trava / com opção livra) sem precisar de um
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

  it("REGRA NOVA (21/09): frete grátis legítimo SEM opção escolhida -> TRAVADO — o servidor recusa o id ausente", () => {
    // O caso que este arquivo chamava de "controle do B2" e dava LIVRE:
    // `shipping === 0` com frete DEFINIDO (item com freeShipping, limite
    // atingido) e nenhuma opção selecionada. A regra nova aperta: sem id de
    // entrega escolhido o pedido não nasce no servidor (FRETE V2 EMENDA,
    // ELSIF do bloco 4), e o Finalizar do front exige o mesmo. Quem tem
    // frete grátis não perde nada: escolher a opção gratuita no carrinho
    // mantém o preço zero.
    expect(
      finalizarBloqueadoPorFrete({ ...base, freteIndefinido: false }),
    ).toBe(true);
  });

  it("o caso POSITIVO da regra nova: local-delivery GRÁTIS (opção selecionada, price 0) -> LIVRE", () => {
    // A escolha existe e é o que o servidor grava — o preço zero da opção
    // local não trava nada. É o caminho que a regra nova DEIXA aberto.
    expect(
      finalizarBloqueadoPorFrete({
        ...base,
        freteIndefinido: false,
        shipping: 0,
        temOpcaoSelecionada: true,
      }),
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
