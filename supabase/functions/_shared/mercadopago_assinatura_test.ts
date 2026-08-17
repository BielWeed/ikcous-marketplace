// @ts-nocheck
/**
 * Testes de `validarAssinatura` — a UNICA autenticacao do webhook do
 * Mercado Pago (Fase 3). A function roda com verify_jwt = false porque o MP
 * nao manda JWT; se esta validacao passar so nos casos felizes, quem
 * descobrir a URL forja um "aprovado" e leva produto de graca.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { construirCandidatosManifesto, validarAssinatura } from "./mercadopago.ts";

const SEGREDO = "segredo-de-teste";
const TS = 1700000000;
const DATA_ID = "12345";
const REQUEST_ID = "abc-123";
// Gerado pelo crypto do Node em 07/08/2026, com o manifesto
// `id:12345;request-id:abc-123;ts:1700000000;`. Se este hex for recalculado
// pela propria funcao, o teste deixa de provar qualquer coisa.
//
// Confirmado contra a documentacao do MP (context7, 09/08/2026): formato do
// header, unidade do `ts` (segundos) e omissao do `request-id` batem com o
// que o plano assumiu. A revisao de 09/08/2026 achou que a doc ERRA no
// casing do `data.id` — ver o comentario de `validarAssinatura` em
// mercadopago.ts e os dois testes de vetor abaixo, que fecham essa lacuna.
const V1_VALIDO =
  "5bad78f1f0f10eb98d20496b6b8330f24a7469884503659db81991a37b30de40";

const agoraOk = (TS + 10) * 1000;

Deno.test("aceita assinatura valida", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa segredo errado", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: "outro-segredo",
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa corpo adulterado com assinatura antiga", async () => {
  // Mesmo ts, mesmo v1, OUTRO pagamento: e' o ataque que a assinatura existe
  // para barrar — reaproveitar um header legitimo apontando para outro id.
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: "99999",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa ts fora da tolerancia", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: (TS + 60 * 60) * 1000,
  });
  assertEquals(ok, false);
});

// Os dois testes abaixo existem porque a prova por mutacao da revisao de
// 09/08/2026 mostrou que a suite NAO pegava nem o casing do dataId nem o ramo
// condicional do request-id — as duas decisoes que o manifesto realmente toma.
// Sem eles, trocar toLowerCase por toUpperCase deixava os 5 testes verdes.
Deno.test("preserva o casing do dataId no manifesto", async () => {
  // Vetor gerado no Node sobre `id:AbC12;request-id:abc-123;ts:1700000000;`.
  //
  // O id e' MISTO de proposito. Um id todo maiusculo ("ABC12") nao serve
  // aqui: `"ABC12".toUpperCase()` e' ele mesmo, entao a mutacao que forca
  // maiusculas passaria despercebida e o teste so provaria metade do que
  // promete. Com "AbC12", QUALQUER normalizacao de caixa — toLowerCase ou
  // toUpperCase — muda o manifesto e derruba o teste. Medido em 09/08/2026,
  // depois de a primeira versao deste teste falhar exatamente por isso.
  const V1_MISTO =
    "eb23df430623adc6ed3593f4a4a5f0b2e275750ee790ab1bae37af4d2f5e9c78";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_MISTO}`,
    xRequestId: REQUEST_ID,
    dataId: "AbC12",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok, "id com caixa mista tem de validar com o casing preservado");
});

Deno.test("omite o segmento request-id quando o header nao veio", async () => {
  // Vetor gerado no Node sobre `id:12345;ts:1700000000;` — SEM request-id.
  const V1_SEM_REQUEST_ID =
    "0ada36b4ecda6b0e1d969a628e11b8a70430c3f77bc510fe9ad37fd2a713250c";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_SEM_REQUEST_ID}`,
    xRequestId: null,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa header ausente ou malformado", async () => {
  for (const xSignature of [null, "", "v1=semtimestamp", "ts=abc,v1=xyz", "lixo"]) {
    const ok = await validarAssinatura({
      xSignature,
      xRequestId: REQUEST_ID,
      dataId: DATA_ID,
      segredo: SEGREDO,
      agora: agoraOk,
    });
    assertEquals(ok, false, `deveria recusar: ${JSON.stringify(xSignature)}`);
  }
});

// --- Doc oficial x SDK divergem no casing do data.id (medido 16/08/2026) ---
//
// Com `data.id` NUMÉRICO as duas regras (casing original e minúsculas)
// produzem HMAC IDÊNTICO — por isso o simulador do painel do MP nunca
// detectou a divergência. Com um `data.id` "ORD…" (ULID da Orders API) elas
// divergem, e a produção mediu 16/08/2026: o MP assinou em MINÚSCULAS
// (`ord01m05wbhxhm88rmbj1w0sb9wxf`), este código só aceitava o casing
// ORIGINAL, e recusou com 401 100% das notificações reais — um PIX de R$
// 1,00 pago ficou "aguardando" para sempre.
//
// Os dois vetores abaixo são hex LITERAL, calculados no Node
// (`crypto.createHmac`) fora desta implementação — gerar o vetor com o
// próprio código testado não prova nada (foi exatamente esse o defeito da
// suíte antes desta correção: `assinar()` em index_test.ts reconstrói o
// manifesto igual à implementação, então até um teste com id maiúsculo era
// tautológico).

Deno.test("aceita a grafia MINÚSCULA do dataId — o MP assina 'ORD…' em minúsculas na Orders API", async () => {
  // Vetor gerado no Node sobre `id:ord01m05wbhxhm88rmbj1w0sb9wxf;request-id:abc-123;ts:1700000000;`
  // (data.id em minúsculas), com o dataId ORIGINAL (todo maiúsculo, como
  // chega no corpo do webhook) passado para `validarAssinatura`.
  const ID_ORD_REAL = "ORD01M05WBHXHM88RMBJ1W0SB9WXF";
  const V1_MINUSCULO =
    "a293250b399efcd4adf8f6393d9ef7072d7b3e02e462127fda0f2e3c513ef24e";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_MINUSCULO}`,
    xRequestId: REQUEST_ID,
    dataId: ID_ORD_REAL,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok, "deveria aceitar quando o MP assinou o data.id em minúsculas");
});

Deno.test("aceita a grafia MINÚSCULA com dataId de caixa MISTA (não só maiúscula)", async () => {
  // Com um id TODO maiúsculo (teste anterior), uma mutação `.toUpperCase()`
  // no lugar da normalização certa seria NO-OP e passaria disfarçada — o
  // teste só provaria metade do contrato. Caixa mista ("OrD01AbC") faz
  // QUALQUER normalização diferente de minúsculas genuínas derrubar o teste.
  //
  // Vetor gerado no Node sobre `id:ord01abc;request-id:abc-123;ts:1700000000;`.
  const ID_MISTO = "OrD01AbC";
  const V1_MISTO_MINUSCULO =
    "a8434918fa1207b804734d6351e9dde31e291650f705f1d64ccb03972e939d04";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_MISTO_MINUSCULO}`,
    xRequestId: REQUEST_ID,
    dataId: ID_MISTO,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok, "deveria aceitar o dataId de caixa mista pela grafia minúscula");
});

// --- construirCandidatosManifesto: a deduplicação (item 5 do plano) --------
//
// Só duas fontes possíveis desde 16/08/2026 (achado BLOQUEANTE de revisão
// removeu a query string): "corpo-original" e "corpo-minusculo", os dois
// derivados do MESMO `data.id` do corpo.

Deno.test("dataId numérico produz UM ÚNICO candidato de manifesto (original e minúsculo colapsam)", () => {
  const candidatos = construirCandidatosManifesto({
    dataId: "999",
    xRequestId: REQUEST_ID,
    ts: String(TS),
  });
  assertEquals(candidatos.length, 1);
  assertEquals(candidatos[0].manifesto, `id:999;request-id:${REQUEST_ID};ts:${TS};`);
});

Deno.test("dataId 'ORD…' produz DOIS candidatos (original e minúsculo divergem)", () => {
  const candidatos = construirCandidatosManifesto({
    dataId: "ORD01M05WBHXHM88RMBJ1W0SB9WXF",
    xRequestId: REQUEST_ID,
    ts: String(TS),
  });
  assertEquals(candidatos.length, 2);
  const rotulos = candidatos.map((c) => c.rotulo).sort();
  assertEquals(rotulos, ["corpo-minusculo", "corpo-original"]);
});

// --- A FRONTEIRA: o conjunto aceito nao pode CRESCER ----------------------
//
// Achado de revisao (16/08/2026). Os testes acima prendem "estes dois
// candidatos sao aceitos" e nunca "e mais nenhum" — um terceiro entra sem
// derrubar nada. E' exatamente o modo de falha que produziu esta branch: o
// commit e2e22bd alargou o conjunto de 1 para 4 manifestos aceitos e a suite
// ficou VERDE; quem pegou foi revisao humana, nao teste.
//
// O caso tem de ser de CAIXA MISTA. Com um ULID ja maiusculo
// ("ORD01M05…"), um candidato `.toUpperCase()` colapsa na deduplicacao e o
// teste acima passaria mesmo com ele adicionado — medido na revisao. So com
// "OrD01AbC" as tres grafias sao strings distintas, e a fronteira aparece.
const ID_MISTO = "OrD01AbC";

Deno.test("dataId de caixa MISTA produz EXATAMENTE dois candidatos — o conjunto nao pode crescer", () => {
  const candidatos = construirCandidatosManifesto({
    dataId: ID_MISTO,
    xRequestId: REQUEST_ID,
    ts: String(TS),
  });
  // Trava o conjunto INTEIRO — rotulo e texto — nao so o tamanho: um
  // candidato novo derruba isto, um candidato renomeado tambem.
  assertEquals(
    candidatos.map((c) => `${c.rotulo}=${c.manifesto}`).sort(),
    [
      `corpo-minusculo=id:${ID_MISTO.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`,
      `corpo-original=id:${ID_MISTO};request-id:${REQUEST_ID};ts:${TS};`,
    ],
  );
});

// Gerado pelo crypto do Node em 16/08/2026, FORA da implementacao, com o
// manifesto `id:ORD01ABC;request-id:abc-123;ts:1700000000;` — a grafia
// MAIUSCULA de ID_MISTO. Nenhuma das duas grafias aceitas produz este hex.
const V1_MAIUSCULO =
  "dd38168260917dfd3ff916471541ff11b882f6e3925f1ef7b37cebd8f001faed";

Deno.test("RECUSA assinatura calculada sobre a grafia MAIUSCULA — so corpo-original e corpo-minusculo valem", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_MAIUSCULO}`,
    xRequestId: REQUEST_ID,
    dataId: ID_MISTO,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  // Este e' o caso NEGATIVO que encosta na fronteira: a assinatura e'
  // legitima (mesmo segredo, mesmo ts, mesmo id — so a grafia difere), e
  // ainda assim tem de ser recusada. Adicionar um candidato `.toUpperCase()`
  // faz este teste cair; e' a trava contra a proxima edicao alargar a
  // superficie de autenticacao em silencio.
  assertEquals(ok, false);
});
