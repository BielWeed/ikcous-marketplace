"use strict";

/**
 * Prova VIVA da migration 20261645000000 (o aviso do vale-troca diz que a loja combina) num Postgres EFEMERO, com os
 * papeis de verdade e o fluxo REAL do painel (`admin_devolucao_concluir`). O clone (rodar-isolado.cjs) e' a arvore
 * migrada: a 20261645000000 ja esta no ar. Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  CONTROLE   com o corpo da 20261241000000 (o rollback-manual aplicado), a conclusao com vale grava "foi emitido" (o
 *             defeito: o app nao emite vale).
 *  DEPOIS     a conclusao com vale pelo painel grava o texto novo, com o mesmo titulo e o mesmo tipo; reembolso, troca e
 *             reprovada seguem iguais; o aviso gravado ANTES do apply fica byte a byte (nenhuma linha reescrita).
 *  MIGRATION  reaplicar 2x e em CRLF = mesmo corpo e mesmo catalogo; rollback devolve o md5 da 1241 e e' idempotente; ida e
 *             volta igual; o pre-voo recusa SEM escrever (corpo estranho, gatilho desligado, EXECUTE aberto ao logado).
 *  MUTANTE    o comportamento DEPOIS rodado sobre um corpo com a frase antiga fica VERMELHO.
 *  CONSULTAS  205a POSITIVA depois e negativa so na linha do corpo antes; 205b POSITIVA nos dois estados e negativa com corpo
 *             estranho; 28a e 43a seguem POSITIVAS com o corpo desta (sucessora).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-aviso-do-vale-troca-diz-que-a-loja-combina-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (migrations e consultas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const ARQ = "20261645000000_o_aviso_do_vale_troca_diz_que_a_loja_combina.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const lerConsulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const C205A = lerConsulta(
  "205a-conferir-o-aviso-do-vale-troca-diz-que-a-loja-combina-aplicado",
);
const C205B = lerConsulta(
  "205b-antes-o-aviso-do-vale-troca-diz-que-a-loja-combina-base-vigente",
);
const C28A = lerConsulta(
  "28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro",
);
const C43A = lerConsulta("43a-conferir-reembolso-em-duvida-aplicado");
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

const SIG = "public.devolucao_avisa_o_cliente()";
const H_ANTES = "56502b960dcf3e136c1d0d5c41091c20";
const H_NOVO = "68792e520aa47e6e62330718430d82a8";
const corpoDoArquivo = (sql) => {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
  );
  const a =
    sql.indexOf("AS $avisa_o_cliente$", i) + "AS $avisa_o_cliente$".length;
  return sql.slice(a, sql.indexOf("$avisa_o_cliente$;", a));
};
assert.equal(md5(corpoDoArquivo(MIGRATION)), H_NOVO, "o arquivo mudou");
assert.equal(md5(corpoDoArquivo(ROLLBACK)), H_ANTES, "o rollback mudou");

const FRASE_ANTIGA = (p) => `O vale-troca da devolução ${p} foi emitido.`;
const FRASE_NOVA = (p) =>
  `A devolução ${p} foi resolvida com vale-troca. A loja combina com você o valor e como usar. Se não tiver notícia, fale com a loja.`;

const U = {
  cliente: "7e7e2645-0000-4000-8000-0000000000c1",
  admin: "7e7e2645-0000-4000-8000-0000000000a1",
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
let SEQ = 0;
const idDe = (prefixo) =>
  `7e7e2645-${prefixo}-4000-8000-${String(++SEQ).padStart(12, "0")}`;

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0]?.h ?? null;
/** Tudo que a funcao e' no catalogo, menos o corpo (OID, dono, ACL, atributos). */
const catalogo = async () =>
  (
    await C.query(
      "SELECT (to_jsonb(p) - 'prosrc')::text AS j FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0]?.j ?? null;

/** Aplica um texto dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** Uma transacao por caso, sempre desfeita, no estado DEPOIS (o clone) ou ANTES (o rollback-manual aplicado). */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await C.query("BEGIN");
  try {
    assert.equal(
      await hashVivo(),
      H_NOVO,
      "o clone tem de estar com a 20261645000000 no ar",
    );
    if (estado === "antes") {
      assert.equal(await aplicar(ROLLBACK), null, "o rollback nao aplicou");
      assert.equal(await hashVivo(), H_ANTES, "o estado ANTES nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

async function como(papel, sql, params = [], { uid = "", claims = "" } = {}) {
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Fixtures: pessoas, pedido entregue e pago pelo app, devolucao 'recebida'
// ---------------------------------------------------------------------------

async function semearPessoas() {
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.admin, '{"role":"admin"}'],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@45.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 45', 'customer'), ($2, 'Admin 45', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U.cliente, U.admin],
  );
}

async function pedido() {
  const id = idDe("0001");
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
        payment_method, payment_status, paid_at, pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Cliente 45', '{"whatsapp":"5534999990000"}'::jsonb, 300, 300, 0, 'delivered', 'online',
             'online', 'pago', now() - interval '3 days', now() - interval '3 days', $3, 0)`,
    [id, U.cliente, `ORD45-AUTO-${SEQ}`],
  );
  return id;
}

async function devolucaoRecebida(orderId) {
  const id = idDe("0002");
  await C.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno,
        status, valor_itens, valor_frete_ida, prazo_ate, politica)
     VALUES ($1::uuid, 'DEV-45-' || substr($1::text, 31), $2::uuid, $3::uuid, 'arrependimento', 'desisti', 'vale', 'nacional',
             'envio_proprio', 'recebida', 100, 0, current_date + 7, '{}'::jsonb)`,
    [id, orderId, U.cliente],
  );
  const p = (
    await C.query("SELECT protocolo FROM public.devolucoes WHERE id = $1", [id])
  ).rows[0].protocolo;
  return { id, protocolo: p };
}

/** O lojista conclui pelo painel (RPC real), com a resolucao pedida. */
const concluirPeloPainel = (devolucaoId, resolucao) =>
  como(
    "authenticated",
    "SELECT public.admin_devolucao_concluir($1::uuid, $2, '[]'::jsonb, NULL, NULL) AS r",
    [devolucaoId, resolucao],
    { uid: U.admin, claims: JWT_ADMIN },
  );

const avisos = async (dev) =>
  (
    await C.query(
      `SELECT tipo, titulo, mensagem, dados FROM public.notificacoes
        WHERE dados ->> 'devolucao_id' = $1 ORDER BY created_at, id`,
      [dev],
    )
  ).rows;

/** Uma devolucao concluida com vale pelo painel: devolve o aviso que a cliente recebe. */
async function concluirComVale() {
  await semearPessoas();
  const o = await pedido();
  const d = await devolucaoRecebida(o);
  await concluirPeloPainel(d.id, "vale");
  const a = await avisos(d.id);
  assert.equal(a.length, 1, "um aviso por conclusao");
  return { ...d, aviso: a[0] };
}

/** O que a migration promete, sobre o corpo que estiver vivo (levanta se falhar). */
async function comportamentoDepois() {
  const v = await concluirComVale();
  assert.equal(v.aviso.mensagem, FRASE_NOVA(v.protocolo));
  assert.doesNotMatch(v.aviso.mensagem, /emitid/i);
  assert.equal(v.aviso.titulo, "Devolução concluída");
  assert.equal(v.aviso.tipo, "success");
  assert.equal(v.aviso.dados.devolucao_id, v.id);
}

const linhasDaConsulta = async (sql) => {
  await C.query("SAVEPOINT consulta");
  try {
    await C.query("SET LOCAL transaction_read_only = on");
    return (await C.query(sql)).rows;
  } finally {
    await C.query("ROLLBACK TO SAVEPOINT consulta");
  }
};
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const LINHA_DO_CORPO =
  "devolucao_avisa_o_cliente: corpo exato (md5), o aviso do vale diz que a loja combina";

// ---------------------------------------------------------------------------

prova(
  "CONTROLE: com o corpo da 20261241000000 a conclusao com vale diz 'foi emitido' (o defeito)",
  () =>
    emTransacao(
      async () => {
        const v = await concluirComVale();
        assert.equal(v.aviso.mensagem, FRASE_ANTIGA(v.protocolo));
        // O mesmo comportamento DEPOIS, rodado aqui, fica vermelho (a prova enxerga o defeito).
        await assert.rejects(comportamentoDepois());
      },
      { estado: "antes" },
    ),
);

prova(
  "DEPOIS: a conclusao com vale pelo painel diz que a loja combina; mesmo titulo e tipo; nada de 'emitido'",
  () => emTransacao(comportamentoDepois),
);

prova(
  "DEPOIS: reembolso pelo app, troca e reprovada seguem com o texto de sempre",
  () =>
    emTransacao(async () => {
      await semearPessoas();
      const d1 = await devolucaoRecebida(await pedido());
      await concluirPeloPainel(d1.id, "troca");
      let a = await avisos(d1.id);
      assert.equal(
        a[0].mensagem,
        `A troca da devolução ${d1.protocolo} foi confirmada.`,
      );
      const d2 = await devolucaoRecebida(await pedido());
      await concluirPeloPainel(d2.id, "reembolso");
      a = await avisos(d2.id);
      assert.equal(
        a[0].mensagem,
        `Devolução ${d2.protocolo} concluída. A loja está confirmando sua devolução com o Mercado Pago.`,
      );
      assert.equal(a[0].dados.evento, "reembolso_em_processamento");
      const d3 = await devolucaoRecebida(await pedido());
      await C.query(
        "UPDATE public.devolucoes SET status = 'reprovada' WHERE id = $1",
        [d3.id],
      );
      a = await avisos(d3.id);
      assert.equal(a[0].titulo, "Produto não aceito na inspeção");
      assert.equal(a[0].tipo, "warning");
    }),
);

prova(
  "DADO DE ANTES: o aviso 'foi emitido' gravado antes do apply fica byte a byte (nenhuma linha reescrita)",
  () =>
    emTransacao(
      async () => {
        const v = await concluirComVale();
        const antes = (
          await C.query(
            "SELECT id, xmin::text AS x, mensagem FROM public.notificacoes WHERE dados ->> 'devolucao_id' = $1",
            [v.id],
          )
        ).rows;
        assert.equal(antes[0].mensagem, FRASE_ANTIGA(v.protocolo));
        assert.equal(await aplicar(MIGRATION), null, "o apply falhou");
        assert.equal(await hashVivo(), H_NOVO);
        const depois = (
          await C.query(
            "SELECT id, xmin::text AS x, mensagem FROM public.notificacoes WHERE dados ->> 'devolucao_id' = $1",
            [v.id],
          )
        ).rows;
        assert.deepEqual(depois, antes, "a linha antiga mudou");
      },
      { estado: "antes" },
    ),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo corpo e catalogo; rollback devolve o da 1241, 2x; ida e volta igual",
  () =>
    emTransacao(async () => {
      const cat = await catalogo();
      for (const texto of [MIGRATION, MIGRATION, emCRLF(MIGRATION)]) {
        assert.equal(await aplicar(texto), null, "reaplicar falhou");
        assert.equal(await hashVivo(), H_NOVO);
        assert.equal(await catalogo(), cat, "o catalogo mudou ao reaplicar");
      }
      for (const texto of [ROLLBACK, ROLLBACK, emCRLF(ROLLBACK)]) {
        assert.equal(await aplicar(texto), null, "rollback falhou");
        assert.equal(await hashVivo(), H_ANTES);
        assert.equal(await catalogo(), cat, "o catalogo mudou no rollback");
      }
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(), H_NOVO);
      assert.equal(await catalogo(), cat);
      const gatilho = (
        await C.query(
          `SELECT t.tgenabled, t.tgfoid = to_regprocedure($1) AS liga FROM pg_trigger t
            WHERE t.tgname = 'tr_devolucao_avisa_o_cliente' AND t.tgrelid = 'public.devolucoes'::regclass`,
          [SIG],
        )
      ).rows;
      assert.deepEqual(gatilho, [{ tgenabled: "O", liga: true }]);
    }),
);

prova(
  "PRE-VOO: corpo estranho, gatilho desligado e EXECUTE aberto ao logado recusam B1_BASELINE_DIVERGENT sem escrever; o rollback recusa corpo estranho",
  () =>
    emTransacao(async () => {
      const def = (
        await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          SIG,
        ])
      ).rows[0].d;
      const fim = def.lastIndexOf("$avisa_o_cliente$");
      const estranho = `${def.slice(0, fim)}-- +1\n${def.slice(fim)}`;
      const casos = [
        ["corpo estranho", estranho, null],
        [
          "gatilho desligado",
          "ALTER TABLE public.devolucoes DISABLE TRIGGER tr_devolucao_avisa_o_cliente",
          "ALTER TABLE public.devolucoes ENABLE TRIGGER tr_devolucao_avisa_o_cliente",
        ],
        [
          "EXECUTE aberto ao logado",
          `GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated`,
          `REVOKE EXECUTE ON FUNCTION ${SIG} FROM authenticated`,
        ],
      ];
      for (const [nome, estragar, consertar] of casos) {
        await C.query("SAVEPOINT caso");
        await C.query(estragar);
        const h = await hashVivo();
        const cat = await catalogo();
        const r = await aplicar(MIGRATION);
        assert.ok(r, `${nome}: o apply devia recusar`);
        assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
        assert.equal(await hashVivo(), h, `${nome}: escreveu o corpo`);
        assert.equal(await catalogo(), cat, `${nome}: mexeu no catalogo`);
        if (!consertar) {
          const rr = await aplicar(ROLLBACK);
          assert.ok(rr, "o rollback devia recusar corpo estranho");
          assert.match(rr.erro, /B1_BASELINE_DIVERGENT/);
          assert.equal(await hashVivo(), h);
        }
        await C.query("ROLLBACK TO SAVEPOINT caso");
      }
      assert.equal(await hashVivo(), H_NOVO);
    }),
);

prova(
  "MUTANTE: com a frase antiga no corpo novo, o comportamento DEPOIS fica vermelho",
  () =>
    emTransacao(async () => {
      const def = (
        await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          SIG,
        ])
      ).rows[0].d;
      const de =
        "'A devolução ' || NEW.protocolo || ' foi resolvida com vale-troca. A loja combina com você o valor e como usar. Se não tiver notícia, fale com a loja.'";
      assert.ok(def.includes(de), "o trecho do mutante sumiu do corpo vivo");
      await C.query(
        def
          .split(de)
          .join(
            "'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'",
          ),
      );
      await assert.rejects(comportamentoDepois(), "MUTANTE SOBREVIVEU");
    }),
);

prova(
  "CONSULTAS: 205a positiva depois e so a linha do corpo negativa antes; 205b positiva nos dois e negativa com corpo estranho; 28a e 43a seguem positivas",
  async () => {
    await emTransacao(async () => {
      assert.deepEqual(reprovadas(await linhasDaConsulta(C205A)), []);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C205B)), []);
      assert.equal((await linhasDaConsulta(C205A)).length, 3);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C28A)), []);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C43A)), []);
    });
    await emTransacao(
      async () => {
        assert.deepEqual(reprovadas(await linhasDaConsulta(C205A)), [
          LINHA_DO_CORPO,
        ]);
        assert.deepEqual(reprovadas(await linhasDaConsulta(C205B)), []);
      },
      { estado: "antes" },
    );
    await emTransacao(async () => {
      const def = (
        await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          SIG,
        ])
      ).rows[0].d;
      const fim = def.lastIndexOf("$avisa_o_cliente$");
      await C.query(`${def.slice(0, fim)}-- +1\n${def.slice(fim)}`);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C205B)), [
        LINHA_DO_CORPO,
      ]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C205A)), [
        LINHA_DO_CORPO,
      ]);
      await C.query(
        "ALTER TABLE public.devolucoes DISABLE TRIGGER tr_devolucao_avisa_o_cliente",
      );
      assert.ok(
        reprovadas(await linhasDaConsulta(C205A)).includes(
          "tr_devolucao_avisa_o_cliente: em devolucoes, ligado, chama a funcao",
        ),
      );
    });
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.stack || e.message)
            .split("\n")
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do aviso do vale-troca falharam.`,
    );
  }
  console.log(
    `\n[o-aviso-do-vale-troca] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
