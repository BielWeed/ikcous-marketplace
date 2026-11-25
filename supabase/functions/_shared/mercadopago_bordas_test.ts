// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `mercadopago.ts` (linhas 1–700): o que o
 * app MANDA ao Mercado Pago sobre o pagador. Dois limites sem teste:
 *
 *   * o nome do pagador aceita exatamente 100 caracteres (101 vira "sem nome",
 *     nunca um nome cortado por palpite);
 *   * o documento só vale com tipo CPF ou CNPJ — um tipo desconhecido (RG, vazio,
 *     ausente) com 14 dígitos NÃO vira documento do titular;
 *   * a busca de orders do pedido (linhas 1660+, a que decide se a vaga de
 *     cartão pode ser liberada): item `null`/texto/número no meio da lista é
 *     ignorado sem lançar, e só entra order cujo `external_reference` é o pedido.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buscarOrdersDoPedido, dividirNomeDoPagador, normalizarDocumento } from "./mercadopago.ts";

Deno.test("nome do pagador: 100 letras valem (nome único); 101 viram 'sem nome'", () => {
  const cem = "A".repeat(100);
  assertEquals(dividirNomeDoPagador(cem), { first_name: cem });
  assertEquals(dividirNomeDoPagador("A".repeat(101)), {});
});

Deno.test("nome do pagador: 100 caracteres contando o espaço entre primeiro nome e sobrenome ainda valem", () => {
  const nome = `${"A".repeat(49)} ${"B".repeat(50)}`;
  assertEquals(nome.length, 100);
  assertEquals(dividirNomeDoPagador(nome), { first_name: "A".repeat(49), last_name: "B".repeat(50) });
  assertEquals(dividirNomeDoPagador(`${nome}C`), {});
});

Deno.test("documento: tipo diferente de CPF/CNPJ (RG, vazio, minúsculo, ausente) nunca vira documento, mesmo com o número do tamanho de um CNPJ", () => {
  for (const type of ["RG", "", "cpf", undefined, null, 11]) {
    assertEquals(normalizarDocumento({ type, number: "12345678000199" }), null, JSON.stringify(type));
    assertEquals(normalizarDocumento({ type, number: "12345678901" }), null, JSON.stringify(type));
  }
  // O controle: os dois tipos válidos, com máscara.
  assertEquals(normalizarDocumento({ type: "CPF", number: "123.456.789-01" }), { type: "CPF", number: "12345678901" });
  assertEquals(normalizarDocumento({ type: "CNPJ", number: "12.345.678/0001-99" }), { type: "CNPJ", number: "12345678000199" });
});

// ─── busca de orders do pedido ───────────────────────────────────────────────

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

async function buscar(corpo: unknown) {
  const original = console.error;
  console.error = () => {};
  try {
    return await buscarOrdersDoPedido({
      token: "token-de-teste",
      pedidoId: PEDIDO,
      desde: "2026-10-01T00:00:00.000Z",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 })),
    });
  } finally {
    console.error = original;
  }
}

Deno.test("busca de orders: item null, texto ou número na lista é ignorado sem lançar; só entra order DESTE pedido", async () => {
  const minha = { id: "ORD1", external_reference: PEDIDO, status: "processed" };
  const dePouco = { id: "ORD2", external_reference: "outro-pedido", status: "processed" };
  const semRef = { id: "ORD3", status: "processed" };
  for (const embrulho of [(l: unknown[]) => ({ data: l }), (l: unknown[]) => ({ results: l }), (l: unknown[]) => ({ elements: l }), (l: unknown[]) => l]) {
    const r = await buscar(embrulho([null, "texto", 7, minha, dePouco, semRef]));
    assertEquals(r, { ok: true, orders: [minha] });
  }
});

Deno.test("busca de orders: lista incompleta (paging.total maior que a lista) é indecisão, nunca lista completa", async () => {
  const minha = { id: "ORD1", external_reference: PEDIDO };
  assertEquals(await buscar({ data: [minha], paging: { total: 2 } }), { ok: false });
  assertEquals(await buscar({ data: [minha], paging: { total: 1 } }), { ok: true, orders: [minha] });
});
