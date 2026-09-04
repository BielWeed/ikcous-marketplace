// @ts-nocheck
/**
 * scripts/db-check-objetos-do-codigo.mjs — o detector de "objeto que o código
 * usa e o banco não tem" (BANCO-080, issue #139, frente blindagem-banco-0409).
 *
 * Este arquivo cobre as partes PURAS (extração e avaliação) com catálogo
 * SEMEADO — nada aqui abre conexão: `test:unit` roda em Deno sem `pg` (mesma
 * razão dos irmãos db_apply_*_test.ts; o módulo só requer `pg` dentro de
 * lerCatalogo, que não é chamado aqui).
 *
 * O caso semeado principal é O CASO REAL da issue: em 05/08/2026
 * `vw_produtos_admin` não existia em nenhum schema do banco enquanto o front a
 * chamava — cadastrar produto quebrado em produção, escondido pelo fallback
 * de StoreContext. O detector existe para reprovar o PR ANTES disso.
 *
 * A segunda família de casos prova a DISTINÇÃO que a issue exige entre os
 * dois defeitos de correções diferentes:
 *   AUSENTE      — o objeto não está no banco;
 *   INALCANÇÁVEL — está, mas nenhum papel da origem tem SELECT/EXECUTE.
 */
import {
  extrairDeConteudo,
  avaliar,
  formatar,
} from "../scripts/db-check-objetos-do-codigo.mjs";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const CATÁLOGO = () => ({
  relacoes: new Map([
    ["vw_produtos_public", new Set(["anon", "authenticated", "service_role"])],
    ["produtos", new Set(["service_role"])],
  ]),
  funcoes: new Map([
    ["confirmar_pagamento", new Set(["service_role"])],
    ["get_admin_analytics_v2", new Set(["authenticated", "service_role"])],
  ]),
  buckets: new Set(["products"]),
});

Deno.test("extrai .from com o nome na LINHA SEGUINTE (varredura por arquivo, não por linha)", () => {
  const codigo = `const { data } = await supabase
    .from(
      "marketplace_orders"
    ).select("*");`;
  const achados = extrairDeConteudo(codigo, "src/x.ts");
  assertEquals(achados.from.length, 1);
  assertEquals(achados.from[0].nome, "marketplace_orders");
  // A linha reportada é a do `.from(` (linha 2 do trecho), não a da string.
  assertEquals(achados.from[0].onde, "src/x.ts:2");
});

Deno.test(".storage.from é BUCKET, não tabela (o falso positivo real de 04/09: o bucket products de imagens)", () => {
  const codigo = `const u = supabase.storage
  .from("products")
  .getPublicUrl(p);
const t = await supabase.from("produtos").select("*");`;
  const achados = extrairDeConteudo(codigo, "src/y.ts");
  assertEquals(achados.bucket.length, 1);
  assertEquals(achados.bucket[0].nome, "products");
  assertEquals(achados.from.length, 1);
  assertEquals(achados.from[0].nome, "produtos");
});

Deno.test("CASO DA ISSUE semeado: view usada pelo código e ausente do banco vira AUSENTE", () => {
  const refs = [
    { tipo: "from", nome: "vw_produtos_admin", onde: "src/hooks/useProducts.ts:228", papeis: ["anon", "authenticated"] },
    { tipo: "from", nome: "vw_produtos_public", onde: "src/contexts/StoreContext.tsx:398", papeis: ["anon", "authenticated"] },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 1);
  assertEquals(r.ausentes[0].nome, "vw_produtos_admin");
  assertEquals(r.ausentes[0].objeto, "tabela/view");
  assertEquals(r.ok.length, 1); // a pública segue ok
  assertStringIncludes(formatar(r), "AUSENTE");
  assertStringIncludes(formatar(r), "vw_produtos_admin");
});

Deno.test("DISTINÇÃO: existe no banco mas papel da origem não alcança vira INALCANÇÁVEL (não AUSENTE)", () => {
  const refs = [
    { tipo: "from", nome: "produtos", onde: "src/hooks/useProducts.ts:166", papeis: ["anon", "authenticated"] },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 0);
  assertEquals(r.inalcançaveis.length, 1);
  assertEquals(r.inalcançaveis[0].nome, "produtos");
  assertStringIncludes(r.inalcançaveis[0].detalhe, "SELECT");
  assertStringIncludes(formatar(r), "INALCANÇÁVEL");
});

Deno.test("RPC ausente, RPC inalcançável pela origem e RPC ok são separados", () => {
  const refs = [
    { tipo: "rpc", nome: "create_marketplace_order_v25", onde: "src/hooks/useOrders.ts:10", papeis: ["anon", "authenticated"] },
    { tipo: "rpc", nome: "confirmar_pagamento", onde: "supabase/functions/webhook-mercadopago/index.ts:20", papeis: ["service_role"] },
    { tipo: "rpc", nome: "get_admin_analytics_v2", onde: "src/hooks/useAnalytics.ts:336", papeis: ["anon", "authenticated"] },
    // A MESMA RPC do webhook, chamada de src: service_role não vale para src.
    { tipo: "rpc", nome: "confirmar_pagamento", onde: "src/hooks/useX.ts:1", papeis: ["anon", "authenticated"] },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 1);
  assertEquals(r.ausentes[0].nome, "create_marketplace_order_v25");
  assertEquals(r.ausentes[0].objeto, "função");
  assertEquals(r.inalcançaveis.length, 1);
  assertEquals(r.inalcançaveis[0].nome, "confirmar_pagamento");
  assert(r.inalcançaveis[0].onde.startsWith("src/"));
  assertEquals(r.ok.length, 2);
});

Deno.test("bucket ausente do storage é AUSENTE; bucket presente é ok (sem análise de permissão)", () => {
  const refs = [
    { tipo: "bucket", nome: "products", onde: "src/hooks/useProducts.ts:35", papeis: ["anon", "authenticated"] },
    { tipo: "bucket", nome: "banners-velhos", onde: "src/x.ts:1", papeis: ["anon", "authenticated"] },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 1);
  assertEquals(r.ausentes[0].nome, "banners-velhos");
  assertEquals(r.ausentes[0].objeto, "bucket de storage");
  assertEquals(r.ok.length, 1);
});

Deno.test("catálogo limpo com tudo presente: zero ausentes, zero inalcançáveis (o verde de hoje)", () => {
  const refs = [
    { tipo: "from", nome: "vw_produtos_public", onde: "a:1", papeis: ["anon", "authenticated"] },
    { tipo: "rpc", nome: "get_admin_analytics_v2", onde: "b:1", papeis: ["anon", "authenticated"] },
    { tipo: "bucket", nome: "products", onde: "c:1", papeis: ["anon", "authenticated"] },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 0);
  assertEquals(r.inalcançaveis.length, 0);
  assertEquals(r.ok.length, 3);
  assertEquals(formatar(r), "");
});

Deno.test("CASO REAL do dinheiro: .rpc com nome em VARIÁVEL é reportado como fora da auditoria (não some em silêncio)", () => {
  // O ternário de useOrders.ts elege create_marketplace_order_v23/v24 para a
  // variável `rpc` — o caminho do dinheiro. O detector não faz análise de
  // fluxo; o que ele PROMETE é declarar a lacuna (lição da revisão de 04/09).
  const codigo = `const rpc = opts?.comPagamentoOnline
    ? "create_marketplace_order_v24"
    : "create_marketplace_order_v23";
const { data } = await (supabase as any).rpc(rpc, { p_items: [] });`;
  const achados = extrairDeConteudo(codigo, "src/hooks/useOrders.ts");
  assertEquals(achados.rpc.length, 0); // não vira conferência literal
  assertEquals(achados.dinamicas.length, 1);
  assertEquals(achados.dinamicas[0].nome, "rpc");
  assertEquals(achados.dinamicas[0].chamada, "rpc");
  assertStringIncludes(achados.dinamicas[0].onde, "useOrders.ts:4");
});

Deno.test("edge function consulta com service_role alcança o que src não alcançaria", () => {
  // A MESMA tabela, duas origens: src (anon/auth → inalcançável) e edge
  // (service_role → ok). O detector decide por ORIGEM, não por objeto.
  const refs = [
    { tipo: "from", nome: "produtos", onde: "src/a.ts:1", papeis: ["anon", "authenticated"] },
    { tipo: "from", nome: "produtos", onde: "supabase/functions/calculate-shipping/index.ts:706", papeis: ["service_role"] },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.inalcançaveis.length, 1);
  assertEquals(r.ok.length, 1);
  assert(r.inalcançaveis[0].onde.startsWith("src/"));
  assert(r.ok[0].onde.includes("functions"));
});
