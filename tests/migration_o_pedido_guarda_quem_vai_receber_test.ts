import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// 20261399997000: o pedido guarda "Quem vai receber". As duas portas de compra (v23 e v24) acrescentam UMA chave,
// a ultima, ao bloco que copia o endereco salvo para customer_data.address; o resto das duas funcoes e identico,
// letra por letra, ao corpo vivo da 20261397000000. Este teste e ESTATICO (le os arquivos); o comportamento no
// Postgres e provado por tests/banco/o-pedido-guarda-quem-vai-receber-viva.cjs.
const require = createRequire(import.meta.url);
const NOME = "20261399997000_o_pedido_guarda_quem_vai_receber.sql";
const ROLLBACK = `rollback-manual-${NOME}`;
const ANTERIOR =
  "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const lerBruto = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url));
const ler = (rel: string) => lerBruto(rel).replace(/\r/g, "");
const lerMig = (nome: string) =>
  Deno.readTextFileSync(new URL(nome, dir)).replace(/\r/g, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const CHAVE = `'recipient_name', NULLIF(btrim(ua.recipient_name), '')`;
const ALVOS = [
  {
    fn: "create_marketplace_order_v23",
    hAntes: "54b591dc09d67f1abbc9ab3ba5f62f5e",
    hDepois: "a20220f6946409590654938f96b12a27",
  },
  {
    fn: "create_marketplace_order_v24",
    hAntes: "541a210e52ea22fe67e35f2bdd9ef444",
    hDepois: "3e711f7cc9c94894a21024b34d0ed3b4",
  },
];

// O corpo de uma funcao: do `AS $function$` ate o `$function$;` que a fecha.
const corpo = (sql: string, fn: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `${fn}: definicao ausente`);
  const ab = sql.indexOf("AS $function$\n", ini) + "AS $function$\n".length;
  const fim = sql.indexOf("\n$function$;", ab);
  assert.ok(fim > ab, `${fn}: fim do corpo ausente`);
  return sql.slice(ab, fim + 1);
};
const cabecalho = (sql: string, fn: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  return sql.slice(ini, sql.indexOf("AS $function$\n", ini));
};

const migration = lerMig(NOME);
const rollback = lerMig(ROLLBACK);
const anterior = lerMig(ANTERIOR);

Deno.test("3997: os corpos de antes sao os da 397 (hash), o novo so ACRESCENTA a chave e o comentario; o rollback devolve o de antes byte a byte", () => {
  for (const a of ALVOS) {
    const vigente = corpo(anterior, a.fn);
    const novo = corpo(migration, a.fn);
    // prosrc = tudo entre os dois $function$ (a quebra de linha depois do primeiro entra)
    assert.equal(md5(`\n${vigente}`), a.hAntes, `${a.fn}: hash do vigente`);
    assert.equal(md5(`\n${novo}`), a.hDepois, `${a.fn}: hash do novo`);
    assert.notEqual(vigente, novo);
    // O novo, sem as linhas acrescentadas, e o vigente: nada mais mudou.
    // A unica diferenca: a virgula depois de 'reference', tres linhas de comentario e a linha da chave nova.
    const semAsNovas = novo.replace(
      /(\n[ \t]*'reference', ua\.reference),\n(?:[ \t]*--[^\n]*\n){3}[ \t]*'recipient_name', NULLIF\(btrim\(ua\.recipient_name\), ''\)/,
      "$1",
    );
    assert.notEqual(
      semAsNovas,
      novo,
      `${a.fn}: o padrao da chave nova nao casou`,
    );
    assert.equal(
      semAsNovas,
      vigente,
      `${a.fn}: alem da chave nova algo mais mudou`,
    );
    assert.equal(novo.split("\n").length - vigente.split("\n").length, 4);
    // O cabecalho (assinatura, atributos, search_path) e identico.
    assert.equal(cabecalho(migration, a.fn), cabecalho(anterior, a.fn));
    // A chave e a ULTIMA do objeto: vem logo depois de 'reference' e fecha o jsonb_build_object.
    const pos = novo.indexOf(CHAVE);
    assert.ok(pos > novo.indexOf("'reference', ua.reference,"));
    assert.match(
      novo.slice(pos + CHAVE.length, pos + CHAVE.length + 40),
      /^\s*\)/,
      `${a.fn}: a chave nova nao fecha o objeto`,
    );
    assert.equal(
      novo.split(CHAVE).length,
      2,
      `${a.fn}: a chave aparece uma vez so`,
    );
    // Rollback: o corpo de antes, byte a byte, e o pre-voo exige o do depois.
    assert.equal(
      corpo(rollback, a.fn),
      vigente,
      `${ROLLBACK}: corpo de ${a.fn}`,
    );
    assert.ok(rollback.includes(`'${a.hDepois}'`));
    assert.ok(rollback.includes(`'${a.hAntes}'`));
  }
});

Deno.test("3997: a copia continua so para quem tem conta, endereco salvo, sem endereco digitado e sem retirada; o nome vem do retrato salvo, vazio vira ausencia", () => {
  for (const a of ALVOS) {
    const novo = corpo(migration, a.fn);
    const bloco = novo.slice(
      novo.indexOf("-- 6-bis."),
      novo.indexOf(CHAVE) + 700,
    );
    // As condicoes do bloco 6-bis sao as de antes (as mesmas do corpo vigente).
    assert.ok(
      /IF v_address_data_sem_cpf IS NULL\s+AND v_user_id IS NOT NULL\s+AND p_address_id IS NOT NULL\s+AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN/.test(
        bloco,
      ),
    );
    assert.ok(/FROM public\.user_addresses ua/.test(bloco));
    assert.ok(
      /WHERE ua\.id = p_address_id AND ua\.user_id = v_user_id/.test(bloco),
    );
    // NULLIF(btrim(..), '') -- "   " e "" nao gravam chave com texto vazio.
    assert.ok(CHAVE.includes("NULLIF(btrim("));
  }
});

Deno.test("3997: sem BEGIN/COMMIT, so CREATE OR REPLACE das duas funcoes; nada de DROP, DELETE, UPDATE, INSERT, GRANT, REVOKE, ALTER nem tabela; tudo em LF", () => {
  for (const [rotulo, sql, bruto] of [
    ["migration", migration, Deno.readTextFileSync(new URL(NOME, dir))],
    ["rollback", rollback, Deno.readTextFileSync(new URL(ROLLBACK, dir))],
  ] as const) {
    assert.ok(!bruto.includes("\r"), `${rotulo}: tem CR`);
    // fora de comentario e fora dos corpos das funcoes (os corpos sao os de sempre e tem INSERT/UPDATE deles)
    let fora = sql;
    for (const a of ALVOS) fora = fora.replace(corpo(sql, a.fn), "");
    const semComentario = fora
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
    assert.ok(
      !/^\s*(BEGIN|COMMIT|START TRANSACTION|ROLLBACK)\s*;/im.test(
        semComentario,
      ),
      `${rotulo}: abre transacao propria`,
    );
    assert.ok(
      !/\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|POLICY|INDEX)\b/i.test(
        semComentario,
      ),
      `${rotulo}: DROP`,
    );
    assert.ok(!/\bDELETE\s+FROM\b/i.test(semComentario), `${rotulo}: DELETE`);
    assert.ok(
      !/\bUPDATE\s+public\./i.test(semComentario),
      `${rotulo}: UPDATE de tabela`,
    );
    assert.ok(!/\bINSERT\s+INTO\b/i.test(semComentario), `${rotulo}: INSERT`);
    assert.ok(
      !/\b(GRANT|REVOKE)\b/.test(semComentario.replace(/'[^']*'/g, "")),
      `${rotulo}: ACL`,
    );
    assert.ok(
      !/\bALTER\s+(TABLE|FUNCTION)\b/i.test(semComentario),
      `${rotulo}: ALTER`,
    );
    assert.ok(!/\bCREATE\s+TABLE\b/i.test(semComentario), `${rotulo}: tabela`);
  }
  // so as duas funcoes sao redefinidas
  assert.equal(
    [...migration.matchAll(/^CREATE OR REPLACE FUNCTION public\.(\w+)\(/gm)]
      .map((m) => m[1])
      .join(","),
    "create_marketplace_order_v23,create_marketplace_order_v24",
  );
  // pre-voo antes do primeiro CREATE; pos-voo depois do ultimo; NOTIFY no fim
  const iPre = migration.indexOf("B1_BASELINE_DIVERGENT");
  const iCreate = migration.indexOf("CREATE OR REPLACE FUNCTION");
  const iPos = migration.indexOf("POSVOO_20261399997000");
  assert.ok(iPre > 0 && iPre < iCreate && iCreate < iPos);
  assert.ok(migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
  // o pre-voo aceita o corpo VIGENTE ou o NOVO (idempotente: aplicar duas vezes nao quebra) e a coluna lida
  for (const a of ALVOS) {
    assert.ok(
      migration.includes(`'${a.hAntes}'`) &&
        migration.includes(`'${a.hDepois}'`),
      a.fn,
    );
  }
  assert.ok(migration.includes("recipient_name"));
  assert.ok(/has_column_privilege/.test(migration));
});

Deno.test("3997: as consultas 150a/150b tem nove linhas fechadas, so catalogo (nenhum pedido, nenhum endereco lido), cada uma com o hash do seu lado", () => {
  const a = ler(
    "scripts/publicacao/consultas/150a-conferir-o-pedido-guarda-quem-vai-receber-aplicado.sql",
  );
  const b = ler(
    "scripts/publicacao/consultas/150b-antes-o-pedido-guarda-quem-vai-receber-base-vigente.sql",
  );
  for (const [rotulo, sql] of [
    ["150a", a],
    ["150b", b],
  ] as const) {
    const sem = sql
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
    assert.ok(
      !/\b(marketplace_orders|user_addresses|profiles|customer_data)\b/i.test(
        sem,
      ),
      `${rotulo}: le dado`,
    );
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i.test(sem),
      `${rotulo}: escreve`,
    );
    assert.equal(
      sem.match(/\bSELECT '([^']+)'/g)?.length,
      9,
      `${rotulo}: rol fechado de 9 linhas`,
    );
  }
  for (const x of ALVOS) {
    assert.ok(
      a.includes(`'${x.hDepois}'`),
      `150a aceita o corpo novo de ${x.fn}`,
    );
    assert.ok(
      !a.includes(`'${x.hAntes}'`),
      `150a nao aceita o corpo de antes de ${x.fn}`,
    );
    assert.ok(
      b.includes(`'${x.hAntes}'`),
      `150b aceita o corpo de antes de ${x.fn}`,
    );
    assert.ok(
      !b.includes(`'${x.hDepois}'`),
      `150b nao aceita o corpo novo de ${x.fn}`,
    );
  }
});

Deno.test("3997: o lote esta registrado em todos os lugares da cadeia (rol fechado, canais, db-apply, workflows, sucessoras da 99, consultas vizinhas)", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A = "150a-conferir-o-pedido-guarda-quem-vai-receber-aplicado";
  const B = "150b-antes-o-pedido-guarda-quem-vai-receber-base-vigente";
  assert.ok(A in ROL_FECHADO_POR_CONSULTA && B in ROL_FECHADO_POR_CONSULTA);
  assert.equal(ROL_FECHADO_POR_CONSULTA[A].length, 9);
  assert.equal(ROL_FECHADO_POR_CONSULTA[B].length, 9);
  assert.ok(CONSULTAS_DE_ROL_FECHADO.has(A) && CONSULTAS_DE_ROL_FECHADO.has(B));
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  assert.equal(
    canais.provasDeObjetos.filter((p: { consulta: string }) => p.consulta === A)
      .length,
    1,
  );
  // db-apply exige o marcador da migration
  const dbApply = ler("scripts/db-apply.cjs");
  assert.ok(dbApply.includes("20261399997000"));
  assert.ok(
    dbApply.includes("POSVOO_20261399997000") ||
      dbApply.includes("recipient_name"),
  );
  // os dois workflows citam as consultas e a prova viva entra uma vez no job do dinheiro
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.equal(
    rpc.split("o-pedido-guarda-quem-vai-receber-viva.cjs").length,
    2,
  );
  assert.ok(
    rpc.includes(`consultas/${A}.sql`) && rpc.includes(`consultas/${B}.sql`),
  );
  assert.ok(
    ler(".github/workflows/conferir-banco-da-loja.yml").includes("150"),
  );
  // as consultas vizinhas aceitam o corpo novo como sucessor, UMA vez cada
  const vizinhas: [string, string[]][] = [
    [
      "31a-conferir-endereco-da-compra-fica-no-pedido",
      ["a20220f6946409590654938f96b12a27", "3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
    [
      "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado",
      ["3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
    [
      "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
      ["a20220f6946409590654938f96b12a27", "3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
    [
      "81a-conferir-compra-online-trava-preco-e-chave-aplicado",
      ["a20220f6946409590654938f96b12a27", "3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
    [
      "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado",
      ["a20220f6946409590654938f96b12a27", "3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
    [
      "106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado",
      ["a20220f6946409590654938f96b12a27", "3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
    [
      "111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado",
      ["a20220f6946409590654938f96b12a27"],
    ],
    [
      "115a-conferir-o-desconto-do-cupom-e-arredondado-ao-centavo-aplicado",
      ["a20220f6946409590654938f96b12a27", "3e711f7cc9c94894a21024b34d0ed3b4"],
    ],
  ];
  for (const [consulta, hashes] of vizinhas) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const h of hashes) {
      assert.ok(sql.includes(`'${h}'`), `${consulta} nao aceita ${h}`);
    }
  }
  // as sucessoras da 99 conhecem a migration, com os dois pares
  const suc = ler("tests/banco/sucessoras-da-99.cjs");
  assert.ok(suc.includes(`"${NOME}"`));
  assert.ok(suc.includes(`["${NOME}", 2]`));
});

Deno.test("3997: pedido antigo NAO ganha o nome: a migration nao le nem escreve linha de pedido, e o rollback deixa os pedidos novos como estao", () => {
  for (const sql of [migration, rollback]) {
    let fora = sql;
    for (const a of ALVOS) fora = fora.replace(corpo(sql, a.fn), "");
    const sem = fora
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
    assert.ok(
      !/marketplace_orders/i.test(sem),
      "fora dos corpos nao toca pedido",
    );
  }
  assert.ok(
    /os pedidos gravados com o nome ficam|pedido(s)? (antigo|gravado)/i.test(
      rollback + migration,
    ),
  );
});
