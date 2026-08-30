import { classificarRecusaDoPedido } from "@/lib/recusaDoPedido";
import { describe, expect, it } from "vitest";

const p0001 = (message: string) => ({ code: "P0001", message });

describe("classificarRecusaDoPedido", () => {
  it("os valores mudaram -> reconferir o carrinho", () => {
    const r = classificarRecusaDoPedido(
      p0001(
        "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
      ),
    );
    expect(r.acao).toBe("reconferir_carrinho");
    expect(r.mensagem).toContain("Os valores do pedido mudaram");
  });

  it("cotacao de frete expirada -> recotar o frete", () => {
    const r = classificarRecusaDoPedido(
      p0001(
        "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
      ),
    );
    expect(r.acao).toBe("recotar_frete");
  });

  it("estoque insuficiente com numero -> ajustar, e diz quanto ha", () => {
    const r = classificarRecusaDoPedido(
      p0001(
        "Estoque insuficiente para o produto Camiseta Azul (Disponível: 2, Solicitado: 5)",
      ),
    );
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("Camiseta Azul");
    expect(r.disponivel).toBe(2);
  });

  it("estoque insuficiente SEM numero (corrida no debito) -> ajustar, sem quantidade", () => {
    const r = classificarRecusaDoPedido(
      p0001("Estoque insuficiente para o produto Caneca"),
    );
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("Caneca");
    expect(r.disponivel).toBeUndefined();
  });

  it("produto indisponivel -> remover do carrinho, nomeando o produto", () => {
    const r = classificarRecusaDoPedido(
      p0001("Produto Caneca Branca não disponível."),
    );
    expect(r.acao).toBe("remover_item");
    expect(r.produto).toBe("Caneca Branca");
  });

  it("variacao nao escolhida -> escolher variacao", () => {
    const r = classificarRecusaDoPedido(
      p0001("Escolha uma variação para o produto Tênis."),
    );
    expect(r.acao).toBe("escolher_variacao");
    expect(r.produto).toBe("Tênis");
  });

  it("cupom invalido -> remover o cupom", () => {
    const r = classificarRecusaDoPedido(
      p0001("Cupom BEMVINDO10 inválido ou expirado."),
    );
    expect(r.acao).toBe("remover_cupom");
  });

  // Item 16 do laudo de 29/08: a recusa final do pedido diz o MOTIVO real
  // (migration 20261025000000, nas funções v23 e v24). Cada frase nova tem
  // de continuar oferecendo a mesma ação: remover o cupom.
  it("cupom inexistente -> remover o cupom, preservando a frase do banco", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom BEMVINDO10 não existe. Confira o código."),
    );
    expect(r.acao).toBe("remover_cupom");
    expect(r.mensagem).toBe("O cupom BEMVINDO10 não existe. Confira o código.");
  });

  it("cupom desativado pela loja -> remover o cupom", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom INVERNO está desativado pela loja."),
    );
    expect(r.acao).toBe("remover_cupom");
  });

  it("cupom expirado com data -> remover o cupom", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom INVERNO expirou em 01/08/2026 23:59."),
    );
    expect(r.acao).toBe("remover_cupom");
  });

  it("cupom com limite de usos atingido -> remover o cupom", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom PRIMEIRA já atingiu o limite de usos."),
    );
    expect(r.acao).toBe("remover_cupom");
  });

  it("cupom com compra mínima não atingida -> remover o cupom, e a frase diz o valor", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom LOJA10 exige uma compra mínima de R$ 150,00."),
    );
    expect(r.acao).toBe("remover_cupom");
    expect(r.mensagem).toContain("R$ 150,00");
  });

  it("nome de cupom com quebra de linha NAO perde a acao", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom BEM\nVINDO não existe. Confira o código."),
    );
    expect(r.acao).toBe("remover_cupom");
  });

  it("entrega local fora da faixa -> trocar a entrega", () => {
    const r = classificarRecusaDoPedido(
      p0001("Entrega local não disponível para o CEP informado."),
    );
    expect(r.acao).toBe("trocar_entrega");
  });

  it("endereco invalido -> trocar endereco", () => {
    const r = classificarRecusaDoPedido(
      p0001("Endereço inválido ou não pertence ao usuário."),
    );
    expect(r.acao).toBe("trocar_endereco");
  });

  it("quantidade invalida -> reconferir o carrinho", () => {
    const r = classificarRecusaDoPedido(
      p0001("Quantidade inválida para um dos itens."),
    );
    expect(r.acao).toBe("reconferir_carrinho");
  });

  // As duas saidas que NAO sao recusa de regra. `mensagemAmigavelErroPedido` ja
  // distingue as duas, e perder a distincao aqui faria a tela oferecer "tente de
  // novo" para um pedido que PODE ter sido criado -- que e' como se duplica pedido.
  it("erro de SQLSTATE generico -> tentar de novo", () => {
    const r = classificarRecusaDoPedido({
      code: "40P01",
      message: "deadlock detected",
    });
    expect(r.acao).toBe("tentar_de_novo");
  });

  it("erro SEM code (rede/gateway) -> conferir antes, NUNCA tentar de novo", () => {
    const r = classificarRecusaDoPedido({ message: "Failed to fetch" });
    expect(r.acao).toBe("conferir_antes");
  });

  it("P0001 com texto desconhecido -> conferir antes, e preserva o texto do banco", () => {
    const r = classificarRecusaDoPedido(
      p0001("Uma recusa que ainda nao existe."),
    );
    expect(r.acao).toBe("conferir_antes");
    expect(r.mensagem).toBe("Uma recusa que ainda nao existe.");
  });

  // 🔴 Achados da revisao de contexto limpo, 28/08/2026. Os tres primeiros sao o
  // achado que BLOQUEOU a primeira versao: sem eles, o painel dizia "confira se o
  // pedido apareceu" enquanto o toast, do lado, dizia "tente novamente" -- duas
  // instrucoes opostas para a MESMA falha, na MESMA tela.
  it.each(["PGRST202", "PGRST301", "PGRST302"])(
    "%s prova que a chamada nem chegou ao banco -> tentar de novo, igual ao toast",
    (code) => {
      const r = classificarRecusaDoPedido({ code, message: "qualquer" });
      expect(r.acao).toBe("tentar_de_novo");
    },
  );

  it("nome de produto com quebra de linha NAO perde a acao", () => {
    const r = classificarRecusaDoPedido(
      p0001(
        "Estoque insuficiente para o produto Caneca\nAzul (Disponível: 2, Solicitado: 5)",
      ),
    );
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("Caneca\nAzul");
    expect(r.disponivel).toBe(2);
  });

  it("nome de produto vazio NAO perde a acao", () => {
    const r = classificarRecusaDoPedido(
      p0001("Estoque insuficiente para o produto "),
    );
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("");
  });

  it("o nome guloso continua resolvendo parenteses dentro do nome", () => {
    // Provado pela revisao: o `.+` guloso ja acertava isto, e trocar para
    // `[\s\S]*` nao pode ter quebrado. Nome do produto contendo o proprio
    // formato da mensagem.
    const r = classificarRecusaDoPedido(
      p0001(
        "Estoque insuficiente para o produto Kit (Disponível: 9, Solicitado: 1) (Disponível: 2, Solicitado: 5)",
      ),
    );
    expect(r.produto).toBe("Kit (Disponível: 9, Solicitado: 1)");
    expect(r.disponivel).toBe(2);
  });
});
