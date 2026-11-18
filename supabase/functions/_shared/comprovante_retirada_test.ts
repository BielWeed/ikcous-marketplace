import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { htmlDoPedido } from "./comprovante.ts";

// O comprovante não consulta status no banco. A mesma frase precisa servir
// para pedido recebido, em preparo, pronto, retirado e sem etapa disponível.
for (const status of ["new", "pending", "processing", "shipping", "delivered", undefined]) {
  for (const endereco of ["Rua Ficticia da Loja, 100", ""]) {
    Deno.test(`aviso da retirada: status ${status}, endereço ${endereco ? "presente" : "ausente"} não promete espera nem prontidão`, () => {
      const html = htmlDoPedido({
        pedido: { id: "pedido-teste", status, total: 100, payment_method: "cash" },
        itens: [],
        endereco: "",
        nomeDaLoja: "Loja Teste",
        aguardandoPagamento: false,
        retirada: { endereco },
      });
      assertStringIncludes(html, "Para informações sobre a retirada, consulte seu pedido ou fale com a loja.");
      assertEquals(html.includes("Aguarde a confirmação da loja"), false);
      assertEquals(html.includes("Pronto para retirar"), false);
      assertEquals(html.includes("Retirado"), false);
      if (endereco) assertStringIncludes(html, endereco);
    });
  }
}
