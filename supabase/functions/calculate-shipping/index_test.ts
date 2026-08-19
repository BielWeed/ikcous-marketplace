// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  calculateSmartFallback,
  flatFeeConfigurada,
  getCartHash,
  isLocalCep,
  precoDeContingenciaDoTopo,
  validarOrigemEFrete,
} from "./index.ts";

Deno.test("calculateSmartFallback - same region", () => {
  // Test same region: starts with same character
  const fee = calculateSmartFallback("38500000", "35000000", 10);
  assertEquals(fee, 15); // max of 15 and baseFee (10)
});

Deno.test("calculateSmartFallback - neighboring region group", () => {
  // Test neighboring region group (e.g., 2 and 3)
  const fee = calculateSmartFallback("20000000", "30000000", 10);
  assertEquals(fee, 22); // max of 22 and baseFee + 7 (17)
});

Deno.test("calculateSmartFallback - remote regions", () => {
  // Test remote regions (e.g., 0 and 8)
  const fee = calculateSmartFallback("01000000", "80000000", 10);
  assertEquals(fee, 38); // max of 38 and baseFee + 20 (30)
});

Deno.test("getCartHash - empty cart", () => {
  assertEquals(getCartHash([]), "");
});

Deno.test("getCartHash - null or invalid cart", () => {
  assertEquals(getCartHash(null as any), "empty");
  assertEquals(getCartHash(undefined as any), "empty");
});

Deno.test("getCartHash - stable sorting and hashing", () => {
  const cart1 = [
    { product: { id: "prod-a" }, quantity: 2, variantId: "v1" },
    { product: { id: "prod-b" }, quantity: 1, variantId: "v2" },
  ];
  const cart2 = [
    { product: { id: "prod-b" }, quantity: 1, variantId: "v2" },
    { product: { id: "prod-a" }, quantity: 2, variantId: "v1" },
  ];
  assertEquals(getCartHash(cart1), getCartHash(cart2));
  assertEquals(getCartHash(cart1), "prod-a:v1:2,prod-b:v2:1");
});

Deno.test("isLocalCep - default fallback", () => {
  // Same first 5 digits
  assertEquals(isLocalCep("38500-000", "38500-120"), true);
  // Different first 5 digits
  assertEquals(isLocalCep("38500-000", "38400-000"), false);
});

Deno.test("isLocalCep - custom prefix list", () => {
  // Custom prefix list
  assertEquals(isLocalCep("38500-000", "38400-123", "38500, 38400"), true);
  assertEquals(isLocalCep("38500-000", "38200-123", "38500, 38400"), false);
});

Deno.test("isLocalCep - custom range", () => {
  // Custom range
  assertEquals(isLocalCep("38500-000", "38502000", "38500000-38505000"), true);
  assertEquals(isLocalCep("38500-000", "38506000", "38500000-38505000"), false);
});

Deno.test("isLocalCep - formato do placeholder do admin (dois CEPs formatados)", () => {
  // O placeholder do AdminShippingView ensina "Ex: 38500-000, 38500-999".
  // Antes, o hífen do CEP era lido como separador de faixa e nada casava.
  const range = "38500-000, 38500-999";
  assertEquals(isLocalCep("38500-000", "38500-123", range), true);
  assertEquals(isLocalCep("38500-000", "38500-000", range), true);
  assertEquals(isLocalCep("38500-000", "38500-999", range), true);
  // Fora da faixa
  assertEquals(isLocalCep("38500-000", "38501-000", range), false);
  assertEquals(isLocalCep("38500-000", "38400-123", range), false);
});

Deno.test("isLocalCep - CEP completo isolado casa exato, prefixo curto casa por início", () => {
  assertEquals(isLocalCep("38500-000", "38500-123", "38500-123"), true);
  assertEquals(isLocalCep("38500-000", "38500-124", "38500-123"), false);
  // Três ou mais itens continuam valendo como lista, não como faixa
  assertEquals(isLocalCep("38500-000", "38400-123", "38500, 38400, 38300"), true);
  assertEquals(isLocalCep("38500-000", "38100-123", "38500, 38400, 38300"), false);
});

Deno.test("isLocalCep - faixa invertida e espaços extras", () => {
  // Lojista digita o maior primeiro: deve continuar funcionando
  assertEquals(isLocalCep("38500-000", "38500-500", "38500-999 ,  38500-000"), true);
  // Campo vazio ou só pontuação cai no fallback dos 5 primeiros dígitos
  assertEquals(isLocalCep("38500-000", "38500-120", "   "), true);
  assertEquals(isLocalCep("38500-000", "38400-120", "   "), false);
});

// --- Contingência do topo: o R$ 15 fixo que a lojista pagava ---------------
//
// Até 18/08/2026, quando a função inteira estourava (erro antes ou depois da
// cotação), o `catch` de topo devolvia `price: 15` cravado no código — para
// qualquer destino do Brasil. A escada por região (15 / 22 / 38) já existia
// logo acima, em `calculateSmartFallback`, e essa contingência não a usava:
// uma blusa de Monte Carmelo (38xxx) para Manaus (69xxx) saía por R$ 15 e a
// diferença ficava com a lojista, sem aparecer em lugar nenhum.
//
// `precoDeContingenciaDoTopo` é a decisão de preço desse `catch`, isolada para
// poder ser medida. Devolver `null` significa "não dá para cotar honestamente"
// — e aí a função responde erro em vez de inventar preço barato.

Deno.test("contingência do topo - mesma região usa o piso de 15, não o 15 cravado", () => {
  assertEquals(precoDeContingenciaDoTopo("38500000", "35000000", 10), 15);
});

Deno.test("contingência do topo - região vizinha cobra 22, não 15", () => {
  assertEquals(precoDeContingenciaDoTopo("20000000", "30000000", 10), 22);
});

Deno.test("contingência do topo - Monte Carmelo para Manaus cobra 38, não 15", () => {
  // 38xxx (MG) -> 69xxx (AM): regiões remotas. É o caso que custava dinheiro
  // da lojista a cada cotação falha.
  assertEquals(precoDeContingenciaDoTopo("38500000", "69000000", 10), 38);
});

Deno.test("contingência do topo - respeita a taxa da loja quando ela é maior que o piso", () => {
  // A escada é PISO, não teto: quem configurou frete de R$ 50 não passa a
  // cobrar 38 por causa de uma falha nossa.
  assertEquals(precoDeContingenciaDoTopo("38500000", "69000000", 50), 70);
});

Deno.test("contingência do topo - sem CEP de destino não inventa preço", () => {
  // Erro antes de ler o corpo do pedido: não se sabe para onde vai. Preço
  // nenhum é honesto aqui, e o barato é o pior de todos.
  assertEquals(precoDeContingenciaDoTopo("38500000", "", 10), null);
  assertEquals(precoDeContingenciaDoTopo("", "69000000", 10), null);
  assertEquals(precoDeContingenciaDoTopo(undefined, undefined, undefined), null);
});

Deno.test("contingência do topo - sem taxa da loja conhecida, a escada ainda vale", () => {
  // `flatFee` só existe depois de ler store_config. Se o erro veio antes
  // disso, a escada continua aplicável: ela só precisa dos dois CEPs.
  assertEquals(precoDeContingenciaDoTopo("38500000", "69000000", undefined), 38);
});

// --- Origem e taxa fixa: falhar fechado, nunca assumir Monte Carmelo -------
//
// Mesmo defeito que a 1.4.0 corrigiu na contingência do topo, um andar
// acima: até 18/08/2026, `storeConfig.origin_cep || '38500-000'` e
// `Number(storeConfig.shipping_fee || 15)` calculavam frete a partir de
// Monte Carmelo e de R$ 15 sempre que a loja nunca configurou nada.
// `Number(null)` é `0` e `null || 15` é `15`: os dois caminhos estavam
// errados. `validarOrigemEFrete` é a decisão isolada — string de erro
// quando falta o que é preciso para cotar honestamente, `null` quando pode
// seguir.

Deno.test("sem CEP de origem configurado, nao devolve opcao de frete", () => {
  const erro = validarOrigemEFrete(null, 15, "flat_fee");
  assertEquals(typeof erro, "string");
});

Deno.test("CEP de origem vazio conta como ausente, nao so' null", () => {
  const erro = validarOrigemEFrete("", 15, "flat_fee");
  assertEquals(typeof erro, "string");
});

Deno.test("sem taxa configurada, nao inventa R$ 15 (provedor flat_fee)", () => {
  const erro = validarOrigemEFrete("38500-000", null, "flat_fee");
  assertEquals(typeof erro, "string");
});

Deno.test("com CEP de origem e taxa configurados, permite cotar", () => {
  const erro = validarOrigemEFrete("38500-000", 15, "flat_fee");
  assertEquals(erro, null);
});

Deno.test("sem taxa configurada mas provedor nao e flat_fee, ainda permite cotar", () => {
  // Quem decide o preco e' a API do transportador; o piso fixo da loja nao
  // entra nessa conta.
  const erro = validarOrigemEFrete("38500-000", null, "melhor_envio");
  assertEquals(erro, null);
});

// --- flatFeeConfigurada: o zero de ausencia nao pode virar frete gratis ----
//
// `validarOrigemEFrete` so exige `shipping_fee` quando `provider ===
// 'flat_fee'` -- de proposito, porque nos demais provedores quem cota e a
// API do transportador. Mas `getFlatFeeResponse` (dentro do handler HTTP)
// cai na taxa fixa mesmo assim quando faltam credenciais do transportador,
// e ate 18/08/2026 isso usava `Number(storeConfig.shipping_fee || 15)`,
// depois trocado para `Number(storeConfig.shipping_fee)` pela Tarefa 7.
// `Number(null)` e `0`: loja com Melhor Envio ou Frenet sem credencial
// cadastrada E sem taxa configurada cotava frete GRATIS para o Brasil
// inteiro em vez de recusar -- pior que o R$ 15 inventado que existia antes.
// `flatFeeConfigurada` e a checagem isolada que fecha esse buraco.

Deno.test("flatFeeConfigurada - taxa nula (nunca configurada) nao e utilizavel", () => {
  assertEquals(flatFeeConfigurada(null), false);
});

Deno.test("flatFeeConfigurada - taxa indefinida nao e utilizavel", () => {
  assertEquals(flatFeeConfigurada(undefined), false);
});

Deno.test("flatFeeConfigurada - taxa nao numerica (NaN) nao e utilizavel", () => {
  assertEquals(flatFeeConfigurada(Number("abc")), false);
});

Deno.test("flatFeeConfigurada - zero CONFIGURADO pela loja e utilizavel (frete gratis de verdade)", () => {
  // Loja pode legitimamente escolher taxa fixa R$ 0. Isso e diferente do
  // zero que nasce de `Number(null)` -- e por isso a checagem olha o valor
  // original, nao o numero ja convertido.
  assertEquals(flatFeeConfigurada(0), true);
});

Deno.test("flatFeeConfigurada - taxa positiva e utilizavel", () => {
  assertEquals(flatFeeConfigurada(15), true);
});
