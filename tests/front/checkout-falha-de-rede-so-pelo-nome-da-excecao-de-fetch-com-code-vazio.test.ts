// A decisão "isto foi falha de REDE" do checkout (`ehFalhaDeRedeAntesDoEnvio`,
// alcançada por `decidirSaidaDoCheckout`) vale por UMA assinatura exata: o
// `code` vazio E a mensagem começando pelo NOME de uma exceção do fetch. Os
// testes de tela cobrem `TypeError: Failed to fetch`; sobravam três buracos
// que deixariam a compra errada passar:
//
//  1. Os outros três nomes de exceção que o navegador/ambiente lança
//     (`AbortError`, `NetworkError`, `FetchError`): perder qualquer um deles
//     devolveria à cliente o conselho errado ("confira seus pedidos", botão
//     travado) numa falha que PROVADAMENTE não saiu do aparelho.
//  2. O inverso, que é o perigoso: a MESMA frase com um `code` preenchido é
//     uma resposta do servidor (o pedido pode ter nascido). Tratar isso como
//     rede faria a convidada reenviar uma compra que o banco já recusou, e a
//     cliente com conta ouvir "sem conexão" quando houve resposta.
//  3. Uma mensagem que só CONTÉM o nome da exceção no meio (uma frase do
//     servidor citando "TypeError:") não é a assinatura: ela só vale no começo.
//
// `navigator.onLine` não é lido aqui de propósito (ambiente node, sem
// `onLine`): o que se prova é só a assinatura do erro.
import { decidirSaidaDoCheckout } from "@/views/customer/CheckoutView";
import { describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase`, que valida variável de ambiente ao carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const EXCECOES_DE_FETCH = [
  "TypeError",
  "FetchError",
  "AbortError",
  "NetworkError",
] as const;

describe("decidirSaidaDoCheckout — a assinatura de falha de rede", () => {
  it.each(EXCECOES_DE_FETCH)(
    "code vazio + '%s: ...' com conta: tentar_de_novo e a frase de 'sem conexão'",
    (nome) => {
      const saida = decidirSaidaDoCheckout({
        code: "",
        message: `${nome}: o aparelho não conseguiu enviar`,
      });

      expect(saida.acao).toBe("tentar_de_novo");
      expect(saida.mensagem).toContain("Sem conexão");
    },
  );

  it.each(EXCECOES_DE_FETCH)(
    "code vazio + '%s: ...' como convidada: reenvia a MESMA compra",
    (nome) => {
      const saida = decidirSaidaDoCheckout(
        { code: "", message: `${nome}: o aparelho não conseguiu enviar` },
        { semConta: true },
      );

      expect(saida.acao).toBe("reenviar_mesma_compra");
    },
  );

  it("a mesma frase com code PREENCHIDO é resposta do servidor, não rede (com conta)", () => {
    const saida = decidirSaidaDoCheckout({
      code: "XX000",
      message: "TypeError: resposta inesperada do servidor",
    });

    expect(saida.mensagem).not.toContain("Sem conexão");
  });

  it("a mesma frase com code PREENCHIDO não faz a convidada reenviar", () => {
    const saida = decidirSaidaDoCheckout(
      { code: "XX000", message: "TypeError: resposta inesperada do servidor" },
      { semConta: true },
    );

    expect(saida.acao).not.toBe("reenviar_mesma_compra");
  });

  it("nome de exceção no MEIO da mensagem não é a assinatura (com conta)", () => {
    const saida = decidirSaidaDoCheckout({
      code: "",
      message: "falha no servidor: TypeError: x",
    });

    expect(saida.mensagem).not.toContain("Sem conexão");
  });
});
