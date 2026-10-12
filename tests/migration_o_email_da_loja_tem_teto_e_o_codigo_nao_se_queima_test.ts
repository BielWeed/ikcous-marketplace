// @ts-nocheck
// O E-MAIL DA LOJA TEM TETO E O CODIGO DO CONVIDADO NAO SE QUEIMA — prova offline do par
// 20261217000000 + rollback (auditoria de 12/10/2026, lote L1). O COMPORTAMENTO (tetos, corrida,
// pedido pago, v1/v2, reaplicar, pre-voo e rollback no banco) e' provado em
// tests/banco/teto-de-email-viva.cjs; o portao (21a/21b) em tests/banco/teto-de-email-portao-viva.cjs.
// Aqui fica o que se prova so lendo o texto, no `npm run test:unit`.
//
// Cada assercao esta amarrada a um risco: transacao propria grava meia mudanca; hash de pre-voo que
// nao e' o md5 real recusa num banco correto (ou aceita corpo errado); corpo novo que perde um trecho
// do vigente apaga em silencio uma correcao antiga; rollback que nao volta byte a byte deixa o teto
// preso depois de "revertido"; motivo novo na resposta muda o contrato da edge; parametro com DEFAULT
// na v2 cria sobrecarga ambigua no PostgREST; a ordem dos tetos errada gasta vaga de quem nao confere.
/* eslint-disable security/detect-object-injection --
 * As chaves vem das listas fechadas TROCADAS/NOVAS deste arquivo, nunca de entrada externa. */
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
const NOME =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
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

/** Texto da funcao num arquivo, do CREATE ate o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} nao encontrada`);
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

const TROCADAS = [
  {
    nome: "generate_order_otp_v2",
    assinatura: "public.generate_order_otp_v2(text,text,text)",
    origem: "20260820000000_otp_v2_devolve_o_codigo.sql",
  },
  {
    nome: "reivindicar_email_de_confirmacao",
    assinatura: "public.reivindicar_email_de_confirmacao(uuid)",
    origem: "20260821000000_confirmacao_de_pedido_uma_vez.sql",
  },
  {
    nome: "get_orders_by_otp_v1",
    assinatura: "public.get_orders_by_otp_v1(text,text)",
    origem: "20261181000000_pedido_por_whatsapp_fecha_para_anon.sql",
  },
];
const NOVAS = [
  {
    nome: "get_orders_by_otp_v2",
    assinatura: "public.get_orders_by_otp_v2(text,text,text,text)",
  },
  {
    nome: "reservar_vaga_de_email",
    assinatura: "public.reservar_vaga_de_email(text,integer)",
  },
  {
    nome: "chave_do_destinatario",
    assinatura: "public.chave_do_destinatario(text)",
  },
];
const antes = Object.fromEntries(
  TROCADAS.map((f) => [f.nome, funcao(ler(f.origem), f.nome)]),
);
const depois = Object.fromEntries(
  [...TROCADAS, ...NOVAS].map((f) => [f.nome, funcao(migration, f.nome)]),
);
const desfeito = Object.fromEntries(
  TROCADAS.map((f) => [f.nome, funcao(rollback, f.nome)]),
);

/** `a` e' subsequencia de linhas de `b` (cada linha de `a`, na ordem, aparece em `b`). */
function linhasEmOrdem(a, b) {
  const lb = b.split("\n");
  let j = 0;
  for (const linha of a.split("\n")) {
    while (j < lb.length && lb[j] !== linha) j++;
    if (j === lb.length) return linha;
    j++;
  }
  return null;
}

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
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

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("so as seis funcoes do lote sao definidas na migration, e so as tres trocadas no rollback", () => {
  const nomes = (sql) =>
    [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ]
      .map((m) => m[1])
      .sort();
  assert.deepEqual(
    nomes(migration),
    [...TROCADAS, ...NOVAS].map((f) => f.nome).sort(),
  );
  assert.deepEqual(nomes(rollback), TROCADAS.map((f) => f.nome).sort());
});

Deno.test("o pre-voo cita o md5 REAL de cada corpo (vigente e desta); o do rollback exige o desta", () => {
  for (const f of TROCADAS) {
    const v = md5(corpo(antes[f.nome]));
    const d = md5(corpo(depois[f.nome]));
    assert.notEqual(v, d, `${f.nome}: o corpo nao muda`);
    assert.ok(
      migration.includes(`('${f.assinatura}', '${v}', '${d}')`),
      `${f.nome}: pre-voo`,
    );
    assert.ok(
      rollback.includes(`('${f.assinatura}', '${d}')`),
      `${f.nome}: pre-voo do rollback`,
    );
  }
  for (const f of NOVAS)
    assert.ok(
      migration.includes(
        `('${f.assinatura}', NULL, '${md5(corpo(depois[f.nome]))}')`,
      ),
      `${f.nome}: pre-voo (nova)`,
    );
  assert.ok(migration.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(rollback.includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("o rollback devolve o corpo E o cabecalho de antes, byte a byte, e nao apaga nada", () => {
  for (const f of TROCADAS) {
    assert.equal(
      corpo(desfeito[f.nome]),
      corpo(antes[f.nome]),
      `${f.nome}: corpo`,
    );
    assert.equal(
      cabecalho(desfeito[f.nome]),
      cabecalho(antes[f.nome]),
      `${f.nome}: cabecalho`,
    );
  }
  assert.doesNotMatch(semComentarios(rollback), /\bDROP\b/i);
  assert.doesNotMatch(semComentarios(rollback), /\b(GRANT|REVOKE)\b/i);
});

Deno.test("os corpos trocados preservam o vigente: nenhuma linha antiga some (a v1 so perde `restantes`)", () => {
  for (const nome of [
    "generate_order_otp_v2",
    "reivindicar_email_de_confirmacao",
  ]) {
    assert.equal(
      linhasEmOrdem(corpo(antes[nome]), corpo(depois[nome])),
      null,
      nome,
    );
    assert.equal(
      cabecalho(depois[nome]),
      cabecalho(antes[nome]),
      `${nome}: cabecalho`,
    );
  }
  const v1Antes = corpo(antes.get_orders_by_otp_v1);
  const v1Depois = corpo(depois.get_orders_by_otp_v1);
  assert.ok(
    v1Antes.includes("'restantes'"),
    "o controle: a v1 de antes devolvia restantes",
  );
  assert.ok(
    !v1Depois.includes("restantes"),
    "a v1 nova ainda devolve restantes",
  );
  // a UNICA diferenca: sai a linha de `restantes` (e a virgula da linha de cima)
  const trecho =
    "            'error', 'Código inválido ou expirado.',\n" +
    "            'restantes', v_max_tentativas - (v_rec.attempts + 1)\n";
  assert.equal(
    v1Antes.split(trecho).length,
    2,
    "o trecho de antes aparece uma vez",
  );
  assert.equal(
    v1Depois,
    v1Antes.replace(
      trecho,
      "            'error', 'Código inválido ou expirado.'\n",
    ),
  );
  assert.equal(
    cabecalho(depois.get_orders_by_otp_v1),
    cabecalho(antes.get_orders_by_otp_v1),
  );
});

Deno.test("generate: tetos nomeados (5, 10, 60) e na ordem trio -> 60 s -> pedido -> destinatario -> loja -> INSERT", () => {
  const g = corpo(depois.generate_order_otp_v2);
  assert.match(g, /v_teto_por_pedido\s+CONSTANT integer := 5;/);
  assert.match(g, /v_teto_por_destinatario\s+CONSTANT integer := 10;/);
  assert.match(g, /v_teto_do_codigo_na_loja\s+CONSTANT integer := 60;/);
  const pos = [
    g.indexOf("^[0-9a-fA-F-]{6,}$"),
    g.indexOf("'muito_recente'"),
    g.indexOf("'codigo:pedido:'"),
    g.indexOf("'destinatario:'"),
    g.indexOf("'codigo:loja'"),
    g.indexOf("INSERT INTO public.otp_verifications"),
  ];
  assert.ok(
    pos.every((p) => p > 0),
    JSON.stringify(pos),
  );
  assert.deepEqual(
    [...pos].sort((a, b) => a - b),
    pos,
    "ordem dos passos",
  );
  // estourou = erro generico, sem dado do cliente na mensagem e sem motivo novo
  for (const m of g.matchAll(/RAISE EXCEPTION '([^']*)'/g))
    assert.doesNotMatch(m[1], /%/);
  const motivos = (s) =>
    [
      ...new Set([...s.matchAll(/'motivo', '([a-z_]+)'/g)].map((m) => m[1])),
    ].sort();
  assert.deepEqual(motivos(g), motivos(corpo(antes.generate_order_otp_v2)));
});

Deno.test("reivindicar: tetos nomeados (10, 120), pedido pago conta sem recusar, e o contador do comprovante e' separado", () => {
  const r = corpo(depois.reivindicar_email_de_confirmacao);
  assert.match(r, /v_teto_por_destinatario\s+CONSTANT integer := 10;/);
  assert.match(r, /v_teto_do_comprovante_na_loja\s+CONSTANT integer := 120;/);
  assert.ok(r.includes("'comprovante:loja'"));
  assert.ok(
    !r.includes("'codigo:loja'"),
    "o comprovante nao pode gastar a vaga do codigo",
  );
  assert.ok(
    r.includes("'destinatario:'"),
    "o destinatario e' o mesmo contador do codigo",
  );
  assert.match(r, /'pago', 'pago_apos_expirar', 'recebido_na_entrega'/);
  assert.match(r, /CASE WHEN v_pago THEN NULL ELSE/);
  assert.match(r, /WHEN OTHERS THEN/);
});

Deno.test("v2: sem DEFAULT (nenhuma sobrecarga ambigua no PostgREST) e so ela tem esse nome na arvore", () => {
  assert.doesNotMatch(cabecalho(depois.get_orders_by_otp_v2), /\bDEFAULT\b/i);
  let definicoes = 0;
  for (const e of Deno.readDirSync(new URL("supabase/migrations/", DIR))) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const t = ler(e.name);
    definicoes += [
      ...semComentarios(t).matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION public\.get_orders_by_otp_v2\(/g,
      ),
    ].length;
  }
  assert.equal(definicoes, 1);
});

Deno.test("privilegios: tabela fechada, apoio so do servidor, v2 para o convidado, e a conferencia final aborta se errar", () => {
  const m = semComentarios(migration);
  assert.ok(
    m.includes(
      "ALTER TABLE public.email_da_loja_contadores ENABLE ROW LEVEL SECURITY;",
    ),
  );
  for (const papel of ["PUBLIC", "anon", "authenticated"]) {
    assert.ok(
      m.includes(
        `REVOKE ALL ON TABLE public.email_da_loja_contadores FROM ${papel};`,
      ),
    );
    for (const f of [
      "chave_do_destinatario(text)",
      "reservar_vaga_de_email(text, integer)",
    ])
      assert.ok(
        m.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM ${papel};`),
        `${f} ${papel}`,
      );
  }
  assert.ok(
    m.includes(
      "REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v2(text, text, text, text) FROM PUBLIC;",
    ),
  );
  assert.ok(m.includes("DO $conferencia_20261217$"));
  assert.match(
    m,
    /RAISE EXCEPTION 'conferencia 20261217: % alcancavel por PUBLIC, anon ou authenticated'/,
  );
  // ADITIVA: nada e' apagado (fora dos literais; o unico DELETE e' a limpeza dos proprios contadores)
  const semLiterais = m.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(semLiterais, /\b(DROP|TRUNCATE)\b/i);
  // os DELETE: a limpeza dos contadores (nova) e a dos codigos vencidos, que ja estava no corpo vigente
  const deletes = [...semLiterais.matchAll(/\bDELETE FROM (public\.\w+)/gi)]
    .map((x) => x[1])
    .sort();
  assert.deepEqual(deletes, [
    "public.email_da_loja_contadores",
    "public.otp_verifications",
  ]);
  assert.ok(
    corpo(antes.generate_order_otp_v2).includes(
      "DELETE FROM public.otp_verifications WHERE expires_at < NOW();",
    ),
  );
});
