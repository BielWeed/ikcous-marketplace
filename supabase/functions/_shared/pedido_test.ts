import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  escaparHtml,
  formatarBRL,
  montarEndereco,
  numeroDoPedido,
  rotuloDoPagamento,
} from "./pedido.ts";

Deno.test("numeroDoPedido usa os 6 ultimos caracteres, em maiuscula", () => {
  assertEquals(
    numeroDoPedido("d77c6616-c389-4caa-b5c1-9a8d7af77f72"),
    "#F77F72",
  );
});

Deno.test("formatarBRL escreve em pt-BR e SEM espaco nao separavel", () => {
  const saida = formatarBRL(1234.5);
  assertEquals(saida, "R$ 1.234,50");
  // A ancora que impede o teste de passar por acidente: se o `replace` do NBSP
  // sumir, a string continua PARECENDO certa na tela e esta comparacao falha.
  assertEquals(saida.includes(" "), false);
});

Deno.test("formatarBRL nao propaga lixo: valor invalido vira R$ 0,00", () => {
  assertEquals(formatarBRL("abc"), "R$ 0,00");
  assertEquals(formatarBRL(null), "R$ 0,00");
  assertEquals(formatarBRL(undefined), "R$ 0,00");
  assertEquals(formatarBRL(Number.POSITIVE_INFINITY), "R$ 0,00");
});

Deno.test("escaparHtml neutraliza marcacao vinda de texto digitado", () => {
  const saida = escaparHtml('<b>Camisa</b> "P" & Cia');
  assertEquals(saida, "&lt;b&gt;Camisa&lt;/b&gt; &quot;P&quot; &amp; Cia");
  assertEquals(saida.includes("<b>"), false);
});

Deno.test("escaparHtml escapa o & ANTES do resto, sem duplicar entidade", () => {
  // Se a ordem invertesse, `<` viraria `&lt;` e o `&` seguinte reescaparia o
  // proprio escape, saindo `&amp;lt;` na tela de quem le.
  assertEquals(escaparHtml("<"), "&lt;");
});

Deno.test("rotuloDoPagamento fala PIX no online, e nao promete cartao", () => {
  assertEquals(rotuloDoPagamento("online"), "PIX pelo site");
  assertEquals(rotuloDoPagamento("online").toLowerCase().includes("cart"), false);
  assertEquals(rotuloDoPagamento("pix"), "PIX na entrega");
  assertEquals(rotuloDoPagamento("card"), "Cartao na entrega");
  assertEquals(rotuloDoPagamento("cash"), "Dinheiro na entrega");
});

Deno.test("rotuloDoPagamento: online + metodo_online diz a forma de verdade (Fase 3.5); sem metodo_online continua PIX (pedido antigo)", () => {
  assertEquals(rotuloDoPagamento("online", "pix"), "PIX pelo site");
  assertEquals(rotuloDoPagamento("online", "credito"), "Cartao de credito pelo site");
  assertEquals(rotuloDoPagamento("online", "debito"), "Cartao de debito pelo site");
  assertEquals(rotuloDoPagamento("online", "CREDITO"), "Cartao de credito pelo site");
  // Pedido de antes do cartao: metodo_online NULL — foi PIX, nao palpite.
  assertEquals(rotuloDoPagamento("online", null), "PIX pelo site");
  assertEquals(rotuloDoPagamento("online", undefined), "PIX pelo site");
  assertEquals(rotuloDoPagamento("online", ""), "PIX pelo site");
  // Valor fora do conjunto: verdade sem inventar a forma.
  assertEquals(rotuloDoPagamento("online", "boleto"), "Pagamento pelo site");
  // O segundo argumento so vale para `online`: venda na entrega nao muda.
  assertEquals(rotuloDoPagamento("card", "credito"), "Cartao na entrega");
  assertEquals(rotuloDoPagamento("cash", "pix"), "Dinheiro na entrega");
});

Deno.test("rotuloDoPagamento devolve vazio para metodo desconhecido", () => {
  // Vazio, e nao "Outro": inventar rotulo e informar o que ninguem sabe.
  assertEquals(rotuloDoPagamento("cripto"), "");
  assertEquals(rotuloDoPagamento(null), "");
});

Deno.test("rotuloDoPagamento: venda de BALCAO diz a forma real paga na loja, sem 'na entrega' (D3)", () => {
  // O balcao nao entrega nada: o cliente pagou ali, na hora.
  assertEquals(rotuloDoPagamento("cash", null, "presencial"), "Dinheiro");
  assertEquals(rotuloDoPagamento("pix", null, "presencial"), "PIX");
  assertEquals(rotuloDoPagamento("card", null, "presencial"), "Cartao na maquininha");
  for (const metodo of ["cash", "pix", "card"]) {
    assertEquals(
      rotuloDoPagamento(metodo, null, "presencial").toLowerCase().includes("entrega"),
      false,
      `${metodo} no balcao nao pode falar de entrega`,
    );
  }
  // O segundo argumento continua irrelevante para quem nao e' `online`.
  assertEquals(rotuloDoPagamento("card", "credito", "presencial"), "Cartao na maquininha");
});

Deno.test("rotuloDoPagamento: pedido do SITE nao muda de texto (nao-regressao do D3)", () => {
  // Sem canal (chamadores antigos, cache), com canal 'online' e com lixo no
  // canal: tudo isso e' o caminho de sempre.
  // "nao-presencial" e "presencial-x" contem a palavra e NAO sao o valor exato:
  // so a igualdade estrita muda o texto (um `includes` os confundiria).
  for (const canal of [
    undefined,
    null,
    "",
    "online",
    "balcao",
    "PRESENCIAL ",
    "nao-presencial",
    "presencial-x",
  ]) {
    assertEquals(rotuloDoPagamento("pix", null, canal), "PIX na entrega");
    assertEquals(rotuloDoPagamento("card", null, canal), "Cartao na entrega");
    assertEquals(rotuloDoPagamento("cash", null, canal), "Dinheiro na entrega");
    assertEquals(rotuloDoPagamento("online", "pix", canal), "PIX pelo site");
    assertEquals(
      rotuloDoPagamento("online", "credito", canal),
      "Cartao de credito pelo site",
    );
    assertEquals(rotuloDoPagamento("online", null, canal), "PIX pelo site");
  }
  // Forma desconhecida no balcao continua sem palpite.
  assertEquals(rotuloDoPagamento("cripto", null, "presencial"), "");
  assertEquals(rotuloDoPagamento(null, null, "presencial"), "");
});

Deno.test("montarEndereco monta a partir do customer_data do convidado", () => {
  const saida = montarEndereco({
    address: "Rua das Flores",
    number: "42",
    neighborhood: "Centro",
    destination_cep: "38500-000",
  });
  assertStringIncludes(saida, "Rua das Flores, 42");
  assertStringIncludes(saida, "Centro");
  assertStringIncludes(saida, "38500-000");
});

Deno.test("montarEndereco monta a partir da linha de user_addresses", () => {
  const saida = montarEndereco({
    street: "Av. Brasil",
    number: "100",
    complement: "apto 3",
    neighborhood: "Jardins",
    city: "Uberlandia",
    state: "MG",
    cep: "38400-000",
  });
  assertStringIncludes(saida, "Av. Brasil, 100");
  assertStringIncludes(saida, "apto 3");
  assertStringIncludes(saida, "Uberlandia - MG");
});

Deno.test("montarEndereco NAO inventa campo que falta", () => {
  // O defeito do PR #231, do outro lado: sem cidade no dado, nao aparece
  // cidade nenhuma no comprovante — e nao sobra separador orfao.
  const saida = montarEndereco({ address: "Rua A", number: "1" });
  assertEquals(saida, "Rua A, 1");
  assertEquals(saida.includes("undefined"), false);
  assertEquals(saida.includes("null"), false);
  assertEquals(saida.trim().endsWith("·"), false);
});

Deno.test("montarEndereco devolve vazio quando nao ha fonte", () => {
  assertEquals(montarEndereco(null), "");
  assertEquals(montarEndereco(undefined), "");
  assertEquals(montarEndereco({}), "");
});
