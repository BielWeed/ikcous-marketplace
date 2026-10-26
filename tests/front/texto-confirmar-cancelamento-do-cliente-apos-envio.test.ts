import { describe, expect, it } from "vitest";
import { textoConfirmarCancelamento } from "../../src/lib/texto-estorno-do-cliente";

// A pergunta antes de a cliente cancelar o PRÓPRIO pedido pago prometia "o
// dinheiro volta sozinho" sempre que o status não era `shipping`. Mas pedido
// que já SAIU uma vez, foi cancelado e reativado pela loja está em `processing`
// com `cancelled_after_shipping = true`: o servidor não abre devolução
// automática para ele (`NOT v_cancelled_after_shipping` em pedido__mudar_status)
// e só estorna depois que o produto volta à loja. A promessa era falsa para
// esse pedido.
const base = {
  pagamentoJaEntrou: true,
  jaFoiEnviado: false,
};

describe("textoConfirmarCancelamento — pedido que já saiu uma vez e foi reativado", () => {
  it("controle: pago e nunca enviado segue prometendo a devolução automática", () => {
    const texto = textoConfirmarCancelamento({ ...base });
    expect(texto).toContain("o dinheiro volta sozinho");
  });

  it("pago, reativado e o produto ainda fora: não promete devolução automática e manda devolver o produto", () => {
    const texto = textoConfirmarCancelamento({
      ...base,
      cancelladoAposEnvio: true,
      produtoJaVoltou: false,
    });
    expect(texto).not.toContain("sozinho");
    expect(texto).toContain("devolver o produto à loja");
    expect(texto).toContain("depois que o produto chegar de volta");
    expect(texto.endsWith("Tem certeza?")).toBe(true);
  });

  it("pago, reativado e o produto JÁ de volta na loja: a loja cuida do dinheiro, sem mandar devolver produto", () => {
    const texto = textoConfirmarCancelamento({
      ...base,
      cancelladoAposEnvio: true,
      produtoJaVoltou: true,
    });
    expect(texto).not.toContain("sozinho");
    expect(texto).not.toContain("devolver o produto");
    expect(texto).toContain("a loja");
    expect(texto).toContain("devolver o seu dinheiro");
    expect(texto.endsWith("Tem certeza?")).toBe(true);
  });

  it("retirada na loja reativada: nunca manda devolver produto que a cliente não levou", () => {
    const texto = textoConfirmarCancelamento({
      ...base,
      cancelladoAposEnvio: true,
      produtoJaVoltou: false,
      retiradaNaLoja: true,
    });
    expect(texto).not.toContain("sozinho");
    expect(texto).not.toContain("devolver o produto");
    expect(texto).toContain("devolver o seu dinheiro");
  });

  it("pago na entrega continua com o texto de combinar com a loja", () => {
    const texto = textoConfirmarCancelamento({
      ...base,
      pagamentoNaEntrega: true,
      cancelladoAposEnvio: true,
    });
    expect(texto).toContain("combine a devolução do dinheiro");
  });

  it("não pago ignora a marca (o texto de sempre)", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: false,
      jaFoiEnviado: false,
      cancelladoAposEnvio: true,
    });
    expect(texto).toContain("Esta ação não pode ser desfeita");
  });

  it("ainda em trânsito (shipping) vence a marca: é o texto de 'já foi enviado'", () => {
    const texto = textoConfirmarCancelamento({
      ...base,
      jaFoiEnviado: true,
      cancelladoAposEnvio: true,
      produtoJaVoltou: true,
    });
    expect(texto).toContain("Este pedido já foi enviado");
  });
});
