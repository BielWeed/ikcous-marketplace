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

Deno.test("rotuloDoPagamento devolve vazio para metodo desconhecido", () => {
  // Vazio, e nao "Outro": inventar rotulo e informar o que ninguem sabe.
  assertEquals(rotuloDoPagamento("cripto"), "");
  assertEquals(rotuloDoPagamento(null), "");
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
