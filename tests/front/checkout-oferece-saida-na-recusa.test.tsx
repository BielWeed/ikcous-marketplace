// A garantia do item 3, presa por teste: NENHUMA das recusas que a função viva
// do banco escreve pode cair no caso genérico "confira antes de tentar de novo".
//
// O teste exercita a função pura exportada pela view, não a view inteira — ela
// arrasta useAuth, useOrders, useCoupons, confetti e Supabase, e nada disso é o
// que esta tarefa muda.
import { decidirSaidaDoCheckout } from "@/views/customer/CheckoutView";
import { describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase` de "@/lib/supabase" (para o fluxo real de
// pedido), e aquele módulo valida variável de ambiente na própria avaliação
// (`src/lib/env.ts`, via `src/lib/supabase.ts:6`). Esta máquina tem `.env`;
// o CI não tem nenhum, e o import explode antes do primeiro teste rodar —
// mesmo padrão de `checkout-view-erro-de-pedido-traduzido.test.tsx:93`. O
// teste aqui só usa a função pura `decidirSaidaDoCheckout`, então o valor
// mockado nunca é chamado; ele existe só para o módulo carregar sem `.env`.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// As frases vêm das migrations que criam `create_marketplace_order_v23/v24` —
// não são inventadas aqui. A âncora que impede elas de mudarem no SQL sem
// ninguém ver é `tests/front/recusa-do-pedido-ancora-nas-migrations.test.ts`.
const RECUSAS_REAIS_DO_BANCO = [
  "Endereço inválido ou não pertence ao usuário.",
  "Quantidade inválida para um dos itens.",
  "Escolha uma variação para o produto Tênis.",
  "Produto Caneca não disponível.",
  "Estoque insuficiente para o produto Caneca (Disponível: 2, Solicitado: 5)",
  "Estoque insuficiente para o produto Caneca",
  "Entrega local não disponível para o CEP informado.",
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
  "Cupom X inválido ou expirado.",
  "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
];

describe("nenhuma recusa real do banco cai no caso genérico", () => {
  for (const mensagem of RECUSAS_REAIS_DO_BANCO) {
    it(`tem ação própria: ${mensagem.slice(0, 42)}`, () => {
      const r = decidirSaidaDoCheckout({ code: "P0001", message: mensagem });
      expect(r.acao).not.toBe("conferir_antes");
    });
  }

  it("a frase do banco é preservada, não reescrita", () => {
    const mensagem = "Cupom X inválido ou expirado.";
    expect(
      decidirSaidaDoCheckout({ code: "P0001", message: mensagem }).mensagem,
    ).toBe(mensagem);
  });
});

describe("controles — o teste acima precisa poder falhar", () => {
  it("um P0001 que ninguém previu AINDA cai em conferir_antes", () => {
    // Controle negativo: se tudo virasse ação própria, o teste de cima passaria
    // por vacuidade. O caso desconhecido continua sendo o caso desconhecido.
    const r = decidirSaidaDoCheckout({
      code: "P0001",
      message: "Recusa que ninguém escreveu ainda.",
    });
    expect(r.acao).toBe("conferir_antes");
  });

  it("erro sem código nenhum falha FECHADO, nunca em 'tente de novo'", () => {
    // Repetir um pedido que pode ter nascido debita estoque duas vezes e queima
    // cupom de uso único. Este é o caso que mais dói e o mais fácil de errar.
    const r = decidirSaidaDoCheckout(new Error("rede caiu"));
    expect(r.acao).toBe("conferir_antes");
  });

  it("os três códigos do PostgREST viram 'tentar de novo'", () => {
    // Eles provam que a chamada nem chegou ao Postgres: não há pedido para
    // conferir, e mandar procurar um mandaria a pessoa atrás de nada.
    for (const code of ["PGRST202", "PGRST301", "PGRST302"]) {
      expect(decidirSaidaDoCheckout({ code }).acao, code).toBe(
        "tentar_de_novo",
      );
    }
  });
});
