// @ts-nocheck
// DESFAZER O RECEBIMENTO RECUSA PEDIDO COM DEVOLUÇÃO — prova offline do par 20261243000000 + rollback
// (dinheiro; 15/10/2026). O COMPORTAMENTO (as cinco situações de devolução viva que recusam, as três
// mortas que liberam, o Financeiro que mantém a venda, a corrida nos dois sentidos com duas conexões
// reais, o rollback aplicado e os mutantes) é provado em tests/banco/desfazer-recebimento-viva.cjs; aqui
// fica o que se prova só lendo o texto, no `npm run test:unit`.
//
// Riscos amarrados: corpo que não é o vigente (o da 20261197000000, com os dois gates de admin e a recusa
// de NULL) apaga uma guarda em silêncio; trocar mais do que o UM bloco declarado muda outra regra do
// recebimento; a checagem fora do ramo que escreve (recusaria o desfazer que já é no-op) ou antes da
// trava do pedido (abre a corrida com a devolução); critério de "devolução viva" diferente do da
// anulação do balcão; hash de preflight que não é o md5 real; rollback que não volta byte a byte;
// GRANT/REVOKE/COMMENT/BEGIN/COMMIT escondido; as consultas e as provas vivas que fixam o corpo da
// 20261197000000 e que precisam saber da sucessora.
//
// Asserções por `node:assert/strict` (embutido no Deno): roda sem rede.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME = "20261243000000_desfazer_recebimento_recusa_com_devolucao.sql";
const NOVENTA_E_SETE = "20261197000000_dinheiro_exige_admin_atual.sql";
const ANULACAO = "20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";
const HASH_VIGENTE = "6584d62da7815a913b1e0cb86c108b0f";
const ASSINATURA = "public.registrar_pagamento_recebido(uuid, boolean)";
const MENSAGEM =
  "Este pedido tem devolução em andamento ou concluída. O recebimento só pode ser desfeito se a devolução for recusada, cancelada ou reprovada na inspeção; devolução concluída não permite desfazer.";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função num arquivo, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
/** O que o Postgres grava em prosrc: entre `AS $$` e `$$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $$") + "AS $$".length,
    texto.length - "$$;".length,
  );
const cabecalho = (texto) => texto.slice(0, texto.indexOf("AS $$"));

const antes = funcao(ler(NOVENTA_E_SETE), "registrar_pagamento_recebido");
const depois = funcao(migration, "registrar_pagamento_recebido");
const desfeito = funcao(rollback, "registrar_pagamento_recebido");
const HASH_NOVO = md5(corpo(depois));

const INICIO_DO_BLOCO = "            -- Devolução viva (20261243000000):";
const FIM_DO_BLOCO = "            v_depois := NULL;\n";

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("só registrar_pagamento_recebido é redefinida, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, ["registrar_pagamento_recebido"]);
  }
});

Deno.test("o ponto de partida é a ÚLTIMA definição antes desta migration (a 20261197000000), com o md5 citado", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const com = nomes.filter((n) =>
    /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.)registrar_pagamento_recebido"?\(/m.test(
      ler(n),
    ),
  );
  assert.equal(com.at(-1), NOVENTA_E_SETE);
  assert.equal(md5(corpo(antes)), HASH_VIGENTE);
});

Deno.test("o corpo novo é o da 20261197000000 byte a byte MAIS UM bloco: a recusa por devolução viva, dentro do ramo que escreve o desfazer", () => {
  const c = corpo(depois);
  const i = c.indexOf(INICIO_DO_BLOCO);
  const j = c.indexOf(FIM_DO_BLOCO, i);
  assert.ok(i > 0 && j > i, "o bloco da recusa não foi achado");
  assert.equal(c.indexOf(INICIO_DO_BLOCO, i + 1), -1, "o bloco aparece 2x");
  // O bloco entra logo depois do ELSE do desfazer: tirado ele (e a linha em branco que o separa do resto),
  // sobra EXATAMENTE o corpo da 97.
  const semBloco = c.slice(0, i) + c.slice(j);
  assert.equal(semBloco, corpo(antes));
  // O bloco é comentário + UM IF EXISTS com UM RAISE, nada além.
  const bloco = semComentarios(c.slice(i, j)).replace(/\s+/g, " ").trim();
  assert.equal(
    bloco,
    `IF EXISTS ( SELECT 1 FROM public.devolucoes d WHERE d.order_id = p_order_id AND d.status NOT IN ('recusada', 'cancelada', 'reprovada') ) THEN RAISE EXCEPTION '${MENSAGEM}'; END IF;`,
  );
  assert.ok(!c.includes("$$"), "$$ dentro do corpo");
});

Deno.test("a checagem vem DEPOIS da trava do pedido, DENTRO do ELSE do desfazer (o no-op não é afetado) e ANTES de qualquer escrita", () => {
  const c = corpo(depois);
  const NOOP_E_ELSE =
    "        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN\n" +
    "            v_ja_estava := TRUE;\n" +
    "            v_depois := v_payment_status;\n" +
    "        ELSE\n";
  // O bloco é a PRIMEIRA coisa do ELSE do desfazer, colado nele.
  assert.ok(
    c.includes(NOOP_E_ELSE + INICIO_DO_BLOCO),
    "a checagem tem de abrir o ELSE do desfazer (o ramo que escreve)",
  );
  const posGate1 = c.indexOf("IF NOT public.is_admin() THEN");
  const posGate2 = c.indexOf("IF NOT public.is_admin_atual() THEN");
  const posNulo = c.indexOf("IF p_recebido IS NULL THEN");
  const posTrava = c.indexOf("     WHERE id = p_order_id\n     FOR UPDATE;");
  const posRecebi = c.indexOf("    IF p_recebido THEN\n");
  const posChecagem = c.indexOf(INICIO_DO_BLOCO);
  const posUpdate = c.indexOf("SET payment_status = NULL");
  const posHistorico = c.indexOf(
    "INSERT INTO public.marketplace_order_payment_history",
  );
  // gates -> NULL -> trava do pedido -> "Recebi" -> (ELSE) checagem -> UPDATE que desfaz -> histórico
  assert.ok(posGate1 > 0 && posGate2 > posGate1 && posNulo > posGate2);
  assert.ok(
    posTrava > posNulo,
    "a trava do pedido vem depois das recusas rápidas",
  );
  assert.ok(posRecebi > posTrava && posChecagem > posRecebi);
  assert.ok(
    posUpdate > posChecagem,
    "a checagem vem ANTES do UPDATE que desfaz",
  );
  assert.ok(posHistorico > posUpdate);
  // Só há UMA recusa nova no corpo: a frase da devolução.
  assert.equal(c.split(MENSAGEM).length - 1, 1);
  assert.equal(
    corpo(antes).split("RAISE EXCEPTION").length + 1,
    c.split("RAISE EXCEPTION").length,
  );
  // A trava do pedido é a mesma de antes (FOR UPDATE, sem NOWAIT/SKIP LOCKED que mudariam a espera).
  assert.ok(!/NOWAIT|SKIP LOCKED/.test(c));
});

Deno.test("o critério de devolução viva é o MESMO da anulação do balcão (20261204000000, item 8)", () => {
  const criterio = "d.status NOT IN ('recusada', 'cancelada', 'reprovada')";
  const anulacao = ler(ANULACAO);
  assert.ok(
    anulacao.includes(`AND ${criterio}`),
    "a anulação do balcão deixou de usar o critério citado: reveja esta migration",
  );
  assert.ok(corpo(depois).includes(`AND ${criterio}`));
  // A mesma lista de status que solicitar_devolucao trata como "devolução que já morreu".
  const solicitar = ler("20261175000000_a_devolucao_nasce_no_pedido.sql");
  assert.ok(solicitar.includes(`${criterio}`));
});

Deno.test("o rollback devolve o corpo da 20261197000000 byte a byte (md5 vigente), com o mesmo cabeçalho", () => {
  assert.equal(corpo(desfeito), corpo(antes));
  assert.equal(md5(corpo(desfeito)), HASH_VIGENTE);
  assert.equal(cabecalho(desfeito), cabecalho(depois));
  assert.equal(cabecalho(depois), cabecalho(antes));
  assert.ok(cabecalho(depois).includes("SECURITY DEFINER"));
  assert.ok(cabecalho(depois).includes("SET search_path = public"));
  assert.ok(cabecalho(depois).includes("RETURNS jsonb"));
  assert.ok(!cabecalho(depois).includes("STABLE"));
});

Deno.test("os preflights e as conferências finais citam o md5 REAL dos dois corpos e recusam com B1_BASELINE_DIVERGENT", () => {
  assert.notEqual(HASH_NOVO, HASH_VIGENTE);
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261243$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261243$"),
  );
  for (const sql of [preflight, preflightRb]) {
    assert.ok(
      sql.includes(`('${ASSINATURA}', '${HASH_VIGENTE}', '${HASH_NOVO}')`),
      "o par (vigente, desta) tem de estar no preflight",
    );
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql));
  }
  const posvoo = migration.slice(migration.indexOf("DO $posvoo_20261243$"));
  assert.ok(posvoo.includes(`IS DISTINCT FROM '${HASH_NOVO}'`));
  const posvooRb = rollback.slice(
    rollback.indexOf("DO $posvoo_rollback_20261243$"),
  );
  assert.ok(posvooRb.includes(`IS DISTINCT FROM '${HASH_VIGENTE}'`));
  // Nenhum hash em lugar nenhum que não seja um dos dois.
  for (const sql of [migration, rollback]) {
    const hashes = new Set(
      [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]),
    );
    for (const h of hashes)
      assert.ok([HASH_VIGENTE, HASH_NOVO].includes(h), `hash estranho ${h}`);
  }
  // O hash do cabeçalho (pré-voo e ficha de verificação) é o do corpo novo.
  assert.ok(migration.includes(`esperado: ${HASH_NOVO}`));
  assert.ok(migration.includes(HASH_VIGENTE));
});

Deno.test("o pré-voo e o pós-voo olham atributos, ACL (EXECUTE só para authenticated e service_role), sobrecarga e existência", () => {
  for (const sql of [
    migration.slice(0, migration.indexOf("END $preflight_20261243$")),
    migration.slice(migration.indexOf("DO $posvoo_20261243$")),
    rollback.slice(0, rollback.indexOf("END $preflight_rollback_20261243$")),
    rollback.slice(rollback.indexOf("DO $posvoo_rollback_20261243$")),
  ]) {
    assert.ok(sql.includes("p.prosecdef"));
    assert.ok(
      sql.includes("p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(sql.includes("p.pronargs = 2"));
    assert.ok(sql.includes("pg_get_function_result(p.oid) = 'jsonb'"));
  }
  assert.ok(migration.includes("tem sobrecarga em public"));
  assert.ok(rollback.includes("tem sobrecarga em public"));
  // O pré-voo confere do que o corpo depende.
  for (const dep of [
    "'public.is_admin()'",
    "'public.is_admin_atual()'",
    "'public.devolucoes'",
    "'public.marketplace_order_payment_history'",
    "('devolucoes', 'status')",
    "('devolucoes', 'order_id')",
  ])
    assert.ok(migration.includes(dep), `o pré-voo não confere ${dep}`);
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/COMMENT/DROP/ALTER/gatilho/DML no par fora da função", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261243$"],
    [rollback, "DO $preflight_rollback_20261243$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert.ok(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert.ok(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    // fora do corpo da função (o corpo grava o pagamento por dentro, como sempre)
    const c = semComentarios(
      sql.replace(funcao(sql, "registrar_pagamento_recebido"), ""),
    );
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /^\s*COMMENT\s+ON\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
      /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im,
    ]) {
      assert.ok(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("os cabeçalhos apontam a prova viva e o rollback, e dizem o que acontece com os dados que já existem", () => {
  assert.ok(migration.includes("tests/banco/desfazer-recebimento-viva.cjs"));
  assert.ok(migration.includes(`rollback-manual-${NOME}`));
  assert.ok(migration.includes("5. DADOS EXISTENTES"));
  assert.ok(migration.includes("7. IDEMPOTÊNCIA E TRANSAÇÃO"));
  assert.ok(rollback.includes("COM ELE VOLTA O DEFEITO"));
  assert.ok(rollback.includes("DADOS:"));
});

Deno.test("as consultas e as provas vivas que fixam o corpo da 20261197000000 conhecem esta sucessora", () => {
  // 8e: o corpo final da 97 segue sendo o `final`, e o desta migration é aceito como sucessora.
  const c8e = lerArquivo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(`('registrar_pagamento_recebido', '${HASH_VIGENTE}')`),
    "a 8e continua tendo o corpo da 20261197000000 como o `final`",
  );
  assert.ok(
    c8e.includes(
      `('registrar_pagamento_recebido', '${HASH_NOVO}', '20261243000000')`,
    ),
    "a 8e tem de aceitar o corpo novo como sucessora",
  );
  // As duas provas vivas que desfazem a 97 dentro da transação desfazem esta antes.
  const modulo = lerArquivo("tests/banco/desfazer-recebimento-posterior.cjs");
  assert.ok(modulo.includes(`nome: "${NOME}"`), "o módulo cita a migration");
  assert.ok(
    modulo.includes("Este pedido tem devolução em andamento ou concluída"),
    "o módulo mede 'no ar' pela frase da recusa (só o corpo desta migration a tem)",
  );
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = lerArquivo(arq);
    assert.ok(
      t.includes('require("./desfazer-recebimento-posterior.cjs")'),
      `${arq}: tem de importar o módulo`,
    );
    const lista = t.slice(t.indexOf("const POSTERIORES_A_97 = ["));
    assert.ok(
      lista.slice(0, lista.indexOf("\n];")).includes("DESFAZER_RECEBIMENTO,"),
      `${arq}: a migration tem de estar em POSTERIORES_A_97 (senão o rollback da 20261197000000 recusa)`,
    );
  }
  // A prova do admin atual (reaplica e desfaz a 97) também tira esta antes dos passos que partem do corpo da 97.
  const admin = lerArquivo("tests/banco/admin-atual-viva.cjs");
  assert.ok(
    admin.split("desfazerDesfazerRecebimentoNaTransacao(cliente)").length - 1 >=
      2,
    "admin-atual-viva: desfazer98NaTransacao e a pilha da prova (6b) tiram a 20261243000000 antes",
  );
  // O CI roda a prova viva.
  const ci = lerArquivo(".github/workflows/rpc-ci.yml");
  assert.ok(
    ci.includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/desfazer-recebimento-viva.cjs",
    ),
  );
});

// ---------------------------------------------------------------------------
// O PORTÃO DA RELEASE (consultas 46a/46b, db-apply, canais-de-backend): o que se prova só lendo o texto.
// O que as consultas DECIDEM (um negativo por linha, mutantes, o portão) é de
// tests/banco/desfazer-recebimento-portao-viva.cjs; o que o lote declara para o portão (ordem, ledger, apply) é de
// tests/frota_publicar_release_test.ts.
// ---------------------------------------------------------------------------
const CONF = require("../scripts/publicacao/conferir-banco.cjs");
const A46 = "46a-conferir-desfazer-recebimento-aplicado";
const B46 = "46b-antes-desfazer-recebimento-base-vigente";
const consulta = (n) => lerArquivo(`scripts/publicacao/consultas/${n}.sql`);

Deno.test("46a/46b — no menu e no rpc-ci, rol fechado de 6 e 6 itens no código, UM statement só de leitura, e cada item do rol está no .sql", () => {
  const yaml = lerArquivo(".github/workflows/conferir-banco-da-loja.yml");
  const rpc = lerArquivo(".github/workflows/rpc-ci.yml");
  for (const n of [A46, B46]) {
    assert.ok(yaml.includes(`- ${n}\n`), `${n}: no menu`);
    assert.equal(
      rpc.split(`scripts/publicacao/consultas/${n}.sql`).length - 1,
      2,
      `${n}: nos dois gatilhos de path do rpc-ci`,
    );
    const sql = consulta(n);
    assert.equal(CONF.contarStatements(sql), 1, `${n}: UM statement`);
    const limpo = removerRuido(sql);
    assert.ok(/^\s*WITH\b/i.test(limpo), `${n}: começa por WITH`);
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|LOCK)\b/i.test(
        limpo.replace(/'(?:[^']|'')*'/g, "''"),
      ),
      `${n}: palavra de escrita`,
    );
    // só catálogo: nenhuma tabela de dado é lida
    assert.ok(
      !/\b(FROM|JOIN)\s+(public\.)?(marketplace_orders|devolucoes|marketplace_order_payment_history)\b/i.test(
        limpo,
      ),
      `${n}: leu uma tabela de dado`,
    );
  }
  assert.equal(CONF.ROL_DA_46A.length, 6);
  assert.equal(CONF.ROL_DA_46B.length, 6);
  assert.equal(new Set(CONF.ROL_DA_46A).size, 6);
  assert.equal(new Set(CONF.ROL_DA_46B).size, 6);
  assert.equal(
    CONF.ROL_FECHADO_POR_CONSULTA["46a-conferir-desfazer-recebimento-aplicado"],
    CONF.ROL_DA_46A,
  );
  assert.equal(
    CONF.ROL_FECHADO_POR_CONSULTA[
      "46b-antes-desfazer-recebimento-base-vigente"
    ],
    CONF.ROL_DA_46B,
  );
  for (const [n, rol] of [
    [A46, CONF.ROL_DA_46A],
    [B46, CONF.ROL_DA_46B],
  ])
    for (const item of rol)
      assert.ok(
        consulta(n).includes(`'${item}'`),
        `${n}: "${item}" fora do .sql`,
      );
  // ASCII só (a consulta viaja pela API de gerenciamento): a única exceção é o travessão do cabeçalho, como nas outras
  for (const n of [A46, B46]) {
    const fora = consulta(n)
      .split("\n")
      .slice(1)
      .filter((l) => [...l].some((ch) => ch.charCodeAt(0) > 127));
    assert.deepEqual(fora, [], `${n}: acento ou símbolo fora do cabeçalho`);
  }
});

Deno.test("46a/46b — os md5 citados são os dos ARQUIVOS: a 46a o corpo desta migration, a 46b o da 20261197000000; nenhuma cita o do outro", () => {
  const a = consulta(A46);
  const b = consulta(B46);
  assert.ok(a.includes(`'${HASH_NOVO}'`), "a 46a cita o corpo novo");
  assert.ok(!a.includes(HASH_VIGENTE), "a 46a não cita o vigente");
  assert.ok(b.includes(`'${HASH_VIGENTE}'`), "a 46b cita o vigente");
  assert.ok(!b.includes(HASH_NOVO), "a 46b não cita o corpo novo");
  // e o vigente da 46b é o md5 real do corpo que a 20261197000000 deixa
  assert.equal(md5(corpo(antes)), HASH_VIGENTE);
});

Deno.test("46a — a frase e o critério que ela procura são os do corpo REAL, e a ordem da trava vale no corpo novo e NÃO vale no antigo", () => {
  const a = consulta(A46);
  const corpoNovo = corpo(depois);
  // os três pedaços ASCII da frase estão no RAISE do corpo novo
  for (const pedaco of [
    "Este pedido tem devolu",
    " em andamento ou conclu",
    "ser desfeito se a devolu",
    "permite desfazer",
  ]) {
    assert.ok(a.includes(`'${pedaco}'`), `a 46a procura "${pedaco}"`);
    assert.ok(MENSAGEM.includes(pedaco), `"${pedaco}" é pedaço da mensagem`);
    assert.ok(corpoNovo.includes(pedaco), `o corpo novo tem "${pedaco}"`);
    assert.ok(
      !corpo(antes).includes(pedaco),
      `o corpo antigo não tem "${pedaco}"`,
    );
  }
  // o critério que a 46a procura está, igual, no corpo novo
  const criterio = "d.status NOT IN ('recusada', 'cancelada', 'reprovada')";
  assert.ok(
    a.includes(criterio.replace(/'/g, "''")),
    "a 46a procura o critério",
  );
  assert.ok(corpoNovo.includes(criterio));
  assert.ok(!corpo(antes).includes(criterio));
  // a ordem: o `FOR UPDATE;` do SELECT (o do comentário não tem `;`) < a checagem < o UPDATE que desfaz
  const pos = (t, s) => t.indexOf(s);
  assert.ok(
    pos(corpoNovo, "FOR UPDATE;") > 0 &&
      pos(corpoNovo, "FOR UPDATE;") <
        pos(corpoNovo, "FROM public.devolucoes d") &&
      pos(corpoNovo, "FROM public.devolucoes d") <
        pos(corpoNovo, "SET payment_status = NULL"),
    "no corpo novo: trava, checagem, UPDATE",
  );
  assert.equal(
    pos(corpo(antes), "FROM public.devolucoes d"),
    -1,
    "o corpo antigo não tem a checagem",
  );
  assert.ok(a.includes("position('FOR UPDATE;' IN f.prosrc)"));
  assert.ok(a.includes("position('FROM public.devolucoes d' IN f.prosrc)"));
  assert.ok(a.includes("position('SET payment_status = NULL' IN f.prosrc)"));
});

Deno.test("46a/46b — a ACL e os atributos que as consultas medem são os que o pré-voo e o pós-voo da migration exigem", () => {
  for (const n of [A46, B46]) {
    const c = consulta(n);
    for (const trecho of [
      "p.prosecdef",
      "l.lanname = 'plpgsql'",
      "p.provolatile = 'v'",
      "p.pronargs = 2",
      "ARRAY['search_path=public']::text[]",
      "pg_get_function_result(p.oid) = 'jsonb'",
      "a.grantee = 0 AND a.privilege_type = 'EXECUTE'",
      "has_function_privilege('anon'",
      "has_function_privilege('authenticated'",
      "has_function_privilege('service_role'",
      "'PUBLIC=nao anon=nao authenticated=sim service_role=sim'",
    ])
      assert.ok(c.includes(trecho), `${n}: falta ${trecho}`);
  }
  // o pré-voo da migration exige a MESMA ACL
  assert.ok(
    migration.includes(
      "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    ),
  );
  assert.ok(
    migration.includes(
      "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    ),
  );
  assert.ok(
    migration.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"),
  );
  // e as 14 colunas da 46b são as que o pré-voo e o corpo citam
  const b = consulta(B46);
  for (const col of [
    "'id', 'status', 'payment_status', 'payment_method', 'pagamento_recebido_em', 'pagamento_recebido_por', 'updated_at'",
    "'order_id', 'acao', 'payment_status_antes', 'payment_status_depois', 'created_by'",
    "'order_id', 'status'",
  ])
    assert.ok(b.includes(col), `46b: falta a lista ${col}`);
});

Deno.test("db-apply.cjs — a migration TEM entrada em VERIFICACOES (sem ela o apply sai PULADA) e cada marcador aparece o número certo de vezes no corpo da migration", () => {
  const { VERIFICACOES, conferirMarcador } = require("../scripts/db-apply.cjs");
  const entrada = Object.entries(VERIFICACOES).find(
    ([nome]) => nome === NOME,
  )?.[1];
  assert.ok(entrada, "a migration não tem entrada em VERIFICACOES");
  const checagens = Array.isArray(entrada) ? entrada : [entrada];
  assert.equal(checagens.length, 1);
  assert.equal(checagens[0].funcao, "registrar_pagamento_recebido");
  const definicao = depois;
  assert.ok(checagens[0].esperado.length >= 6, "marcadores a menos");
  for (const marcador of checagens[0].esperado) {
    const r = conferirMarcador(definicao, marcador);
    assert.ok(
      r.ok,
      `${JSON.stringify(marcador)}: ${r.achou}x (esperado ${r.esperado}x)`,
    );
  }
  // e a frase e o critério da entrada são os do corpo (a entrada não pode ficar velha)
  const textos = JSON.stringify(checagens[0].esperado);
  assert.ok(textos.includes(MENSAGEM));
  assert.ok(textos.includes("'recusada', 'cancelada', 'reprovada'"));
  // o corpo ANTIGO reprovaria pelo menos o marcador da frase
  const reprovados = checagens[0].esperado.filter(
    (m) => !conferirMarcador(antes, m).ok,
  );
  assert.ok(
    reprovados.length >= 3,
    "o corpo antigo tinha de reprovar os marcadores novos",
  );
});

Deno.test("canais-de-backend.json e runbook — o lote da 20261243000000 está registrado com a consulta, a ausência e a versão; o rollback e o front estão declarados", () => {
  const canais = JSON.parse(lerArquivo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.find((p) => p.consulta === A46);
  assert.ok(lote, "lote 46a ausente");
  assert.deepEqual(lote.versoes, ["20261243000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, B46);
  assert.equal(
    canais.provasDeObjetos.filter((p) =>
      (p.versoes ?? []).includes("20261243000000"),
    ).length,
    1,
    "a versão está em UM lote só",
  );
  const rb = new URL(
    `../supabase/migrations/rollback-manual-${NOME}`,
    import.meta.url,
  );
  assert.ok(Deno.statSync(rb).isFile);
  const release = lerArquivo("scripts/frota/publicar-release.mjs");
  assert.ok(release.includes(`"${A46}",`) && release.includes(`"${B46}",`));
});
