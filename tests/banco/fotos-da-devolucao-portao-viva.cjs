"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 20 (o cliente apaga a foto de devolucao
 * que nao usou) -- a migration 20261216000000, que cria a politica `devolucoes_cliente_delete_policy` em
 * `storage.objects` --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   20a-conferir-fotos-da-devolucao-aplicado.sql        (DEPOIS do apply: 6 linhas)
 *   20b-antes-fotos-da-devolucao-sem-delete.sql         (ANTES do apply: 6 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz).
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada: a 20261216
 * aplicada = o DEPOIS). Cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que
 * termina em ROLLBACK; as consultas rodam nela como um papel de LEITURA nao superusuario, com
 * `SET LOCAL ROLE` e a transacao ja somente leitura. O ANTES e' o DEPOIS com o rollback-manual da
 * migration executado na transacao.
 *
 * CASOS:
 *  ROL        as 6 linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_20A e
 *             ROL_DA_20B), sem repetir nem faltar, em qualquer estado.
 *  ESTADOS    depois (a arvore): 20a POSITIVA e 20b NEGATIVA nas 3 linhas da politica de DELETE; antes
 *             (rollback): o inverso; aplicar a migration DE NOVO: 20a POSITIVA (idempotencia); ida e volta.
 *  NEGATIVOS  (20a sobre o depois; cada um reprova EXATAMENTE as linhas previstas, toda mutacao com
 *             guarda): uma politica de DELETE a mais para `anon` no bucket -> a linha do papel; a politica
 *             de DELETE do cliente sem a pasta e sem a foto em uso -> a linha da condicao; sem a politica
 *             de INSERT do cliente -> a linha de INSERT/SELECT.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  COMPORTAMENTO  a politica de verdade: o cliente apaga a propria foto livre e NAO apaga a foto em uso,
 *             a de outro cliente nem a de outro bucket (dois clientes, RLS ligada).
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e a ACL real das lojas NAO foram medidos aqui. (2) Nao ha mutantes do TEXTO
 * do .sql (como ha nos lotes 16 e 17): a prova cobre o comportamento da consulta em cada estado. (3) O
 * COMPORTAMENTO da politica aqui usa o `storage.objects` do efemero (provisionar.cjs), nao o servico de
 * Storage da Supabase: o `remove` pela API passa pela mesma RLS, mas essa passagem nao e' medida.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/fotos-da-devolucao-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "20a-conferir-fotos-da-devolucao-aplicado";
const B = "20b-antes-fotos-da-devolucao-sem-delete";
const ARQ =
  "20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_20A, [B]: CONF.ROL_DA_20B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);

// As 3 linhas que mudam entre o antes e o depois (as 2 outras valem nos dois estados).
const LINHAS_DA_POLITICA = [
  "devolucoes: politicas de DELETE do cliente",
  "devolucoes: DELETE so para authenticated",
  "devolucoes: DELETE so no bucket, na pasta do cliente e fora da foto em uso",
];
const LINHA_OUTRAS =
  "devolucoes: nenhuma outra politica DELETE/ALL alcanca o bucket";
const LINHA_CONDICAO =
  "devolucoes: DELETE so no bucket, na pasta do cliente e fora da foto em uso";
const LINHA_INSERT_SELECT =
  "devolucoes: INSERT e SELECT do cliente seguem no lugar";

const PAPEL_RO = `portao20_ro_${process.pid}`;
const U_A = "2aaaaaaa-0000-0000-0000-000000000001";
const U_B = "2bbbbbbb-0000-0000-0000-000000000002";
let C;

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(montar, consultas, { comoDono = false } = {}) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    if (!comoDono) {
      await C.query(`SET LOCAL ROLE ${PAPEL_RO}`);
      await C.query("SET LOCAL transaction_read_only = on");
      assert.equal(
        (await C.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
    }
    const saidas = {};
    for (const nome of consultas) {
      const r = await C.query(SQL[nome]);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

const reprovadas = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();

/** O rol da consulta: as linhas sao exatamente o contrato, cada uma UMA vez. */
function confereRol(nome, linhas) {
  assert.deepEqual(
    linhas.map((l) => l.item).sort(),
    [...ROL[nome]].sort(),
    `${nome}: as linhas nao sao exatamente o rol`,
  );
  assert.equal(new Set(linhas.map((l) => l.item)).size, linhas.length);
  for (const l of linhas)
    assert.equal(
      typeof l.ok,
      "boolean",
      `${nome}: ok nao booleano em ${l.item}`,
    );
}

/** Guarda: a mutacao tem de ter aplicado; sem ela um mutante que nao faz nada vira falso verde. */
async function guarda(sql) {
  const r = await C.query(sql);
  assert.equal(r.rows[0].aplicou, true, `a mutacao nao aplicou: ${sql}`);
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova(
  "ROL: as 6 linhas de cada consulta sao exatamente o rol, nos dois estados",
  async () => {
    const depois = await noEstado(null, [A, B]);
    confereRol(A, depois[A]);
    confereRol(B, depois[B]);
    const antes = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    confereRol(A, antes[A]);
    confereRol(B, antes[B]);
    assert.equal(ROL[A].length, 6);
    assert.equal(ROL[B].length, 6);
  },
);

prova(
  "DEPOIS (a arvore): 20a POSITIVA; 20b reprova SO as 3 linhas da politica de DELETE",
  async () => {
    const s = await noEstado(null, [A, B]);
    assert.deepEqual(
      reprovadas(s[A]),
      [],
      "20a tem de estar toda ok no depois",
    );
    assert.deepEqual(reprovadas(s[B]), [...LINHAS_DA_POLITICA].sort());
  },
);

prova(
  "ANTES (rollback na transacao): 20b POSITIVA; 20a reprova SO as 3 linhas da politica de DELETE",
  async () => {
    const s = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "20b tem de estar toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [...LINHAS_DA_POLITICA].sort());
  },
);

prova(
  "IDEMPOTENCIA e IDA E VOLTA: aplicar de novo e rollback+aplicar deixam a 20a POSITIVA",
  async () => {
    const dobro = await noEstado(
      async (c) => {
        await c.query(MIGRATION);
        await c.query(MIGRATION);
      },
      [A, B],
    );
    assert.deepEqual(reprovadas(dobro[A]), []);
    const idaEVolta = await noEstado(
      async (c) => {
        await c.query(ROLLBACK);
        await c.query(MIGRATION);
      },
      [A],
    );
    assert.deepEqual(reprovadas(idaEVolta[A]), []);
  },
);

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [null, (c) => c.query(ROLLBACK)]) {
      const comoDono = await noEstado(montar, [A, B], { comoDono: true });
      const comoLeitura = await noEstado(montar, [A, B]);
      assert.deepEqual(comoLeitura[A], comoDono[A]);
      assert.deepEqual(comoLeitura[B], comoDono[B]);
    }
  },
);

prova(
  "NEGATIVO: outra politica de DELETE que alcanca o bucket (para anon, ou larga demais para authenticated) reprova a linha das outras",
  async () => {
    for (const [papel, usando] of [
      ["anon", "bucket_id = 'devolucoes'"],
      ["authenticated", "split_part(name, '/', 1) = (SELECT auth.uid())::text"],
      ["authenticated", "bucket_id <> 'products'"],
    ]) {
      const s = await noEstado(
        async (c) => {
          await c.query(
            `CREATE POLICY portao20_intrusa ON storage.objects FOR DELETE TO ${papel} USING (${usando})`,
          );
          await guarda(
            "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'portao20_intrusa') AS aplicou",
          );
        },
        [A, B],
      );
      assert.deepEqual(reprovadas(s[A]), [LINHA_OUTRAS], `${papel}: ${usando}`);
      // A 20b ("antes") tambem recusa: se a intrusa ja existe, o cliente ja apagaria sem a nossa condicao.
      assert.ok(
        reprovadas(s[B]).includes(LINHA_OUTRAS),
        `20b tem de reprovar a intrusa (${papel}: ${usando})`,
      );
    }
  },
);

prova(
  "OK: uma politica de DELETE presa a outro bucket conhecido (products) nao reprova nada",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(
          "CREATE POLICY portao20_produtos ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'products'::text) AND (SELECT public.is_admin()))",
        );
        await guarda(
          "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'portao20_produtos') AS aplicou",
        );
      },
      [A],
    );
    assert.deepEqual(reprovadas(s[A]), []);
  },
);

prova(
  "NEGATIVO: DELETE sem a pasta do cliente e sem a foto em uso reprova a linha da condicao",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(
          "DROP POLICY devolucoes_cliente_delete_policy ON storage.objects",
        );
        await c.query(
          "CREATE POLICY devolucoes_cliente_delete_policy ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'devolucoes')",
        );
        await guarda(
          "SELECT NOT (qual LIKE '%ANY (d.fotos)%') AS aplicou FROM pg_policies WHERE policyname = 'devolucoes_cliente_delete_policy'",
        );
      },
      [A],
    );
    assert.deepEqual(reprovadas(s[A]), [LINHA_CONDICAO]);
  },
);

prova(
  "NEGATIVO: sem a politica de INSERT do cliente reprova a linha de INSERT e SELECT",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(
          "DROP POLICY devolucoes_cliente_insert_policy ON storage.objects",
        );
        await guarda(
          "SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'devolucoes_cliente_insert_policy') AS aplicou",
        );
      },
      [A],
    );
    assert.deepEqual(reprovadas(s[A]), [LINHA_INSERT_SELECT]);
  },
);

prova(
  "COMPORTAMENTO: o cliente apaga a propria foto livre; nao a em uso, a alheia nem a de outro bucket",
  async () => {
    await C.query("BEGIN");
    try {
      // `storage.objects` tem chave estrangeira para o bucket: o "outro" tambem tem de existir.
      await C.query(
        "INSERT INTO storage.buckets (id, name, public) VALUES ('outro', 'outro', false) ON CONFLICT (id) DO NOTHING",
      );
      await C.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES
         ('devolucoes', $1), ('devolucoes', $2), ('devolucoes', $3), ('outro', $4)`,
        [
          `${U_A}/o1/livre.jpg`,
          `${U_A}/o1/usada.jpg`,
          `${U_B}/o2/dele.jpg`,
          `${U_A}/o1/outro-bucket.jpg`,
        ],
      );
      // Uma devolucao do cliente A referencia a foto "usada". Como dono da conexao, sem as chaves
      // estrangeiras (nao interessa o pedido aqui, so a lista de fotos).
      await C.query("SET LOCAL session_replication_role = replica");
      await C.query(
        `INSERT INTO public.devolucoes
         (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
          metodo_retorno, valor_itens, prazo_ate, politica, fotos)
       VALUES ('DVPROVA20', gen_random_uuid(), $1, 'vicio', 'defeito', 'troca', 'nacional',
               'envio_proprio', 0, current_date, '{}'::jsonb, ARRAY[$2]::text[])`,
        [U_A, `${U_A}/o1/usada.jpg`],
      );
      await C.query("SET LOCAL session_replication_role = origin");

      // Um DELETE com WHERE so alcanca as linhas que o SELECT deixa ver. Para que a negativa
      // venha SO da policy de DELETE (e nao de um SELECT que esconde a foto alheia), abre-se um
      // SELECT permissivo temporario (desfeito pelo ROLLBACK).
      await C.query(
        "CREATE POLICY prova_select_aberto ON storage.objects FOR SELECT TO authenticated USING (true)",
      );

      // O cliente A (authenticated; o uid vem do GUC da emulacao de auth.uid()).
      await C.query("SELECT set_config('app.rpc.user_id', $1, true)", [U_A]);
      const apaga = async (bucket, nome) => {
        await C.query("SET LOCAL ROLE authenticated");
        const r = await C.query(
          "DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2 RETURNING name",
          [bucket, nome],
        );
        await C.query("RESET ROLE");
        return r.rowCount;
      };
      assert.equal(
        await apaga("devolucoes", `${U_A}/o1/usada.jpg`),
        0,
        "a foto em uso por uma devolucao nao se apaga",
      );
      assert.equal(
        await apaga("devolucoes", `${U_B}/o2/dele.jpg`),
        0,
        "a foto de outro cliente nao se apaga",
      );
      assert.equal(
        await apaga("outro", `${U_A}/o1/outro-bucket.jpg`),
        0,
        "foto de outro bucket nao se apaga",
      );
      assert.equal(
        await apaga("devolucoes", `${U_A}/o1/livre.jpg`),
        1,
        "a propria foto, sem devolucao que a use, se apaga",
      );
      const restantes = await C.query(
        "SELECT name FROM storage.objects WHERE bucket_id = 'devolucoes' ORDER BY name",
      );
      assert.deepEqual(
        restantes.rows.map((r) => r.name),
        [`${U_A}/o1/usada.jpg`, `${U_B}/o2/dele.jpg`],
      );

      // Controle: com a policy enfraquecida (so o bucket), a foto alheia SE apaga. Prova que a
      // negativa acima vem da condicao de pasta/uso, e nao de outra coisa.
      await C.query(
        "DROP POLICY devolucoes_cliente_delete_policy ON storage.objects",
      );
      await C.query(
        "CREATE POLICY devolucoes_cliente_delete_policy ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'devolucoes')",
      );
      assert.equal(
        await apaga("devolucoes", `${U_B}/o2/dele.jpg`),
        1,
        "controle: sem a condicao de pasta a foto alheia se apagaria",
      );
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  C.on("error", () => {});
  await C.connect();
  const falhas = [];
  try {
    await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);
    await C.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${e.message.split("\n").join("\n    ")}`,
        );
      }
    }
  } finally {
    await C.query(`DROP OWNED BY ${PAPEL_RO}`).catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do portao 20 falharam.`,
    );
  }
  console.log(
    `\n[fotos-da-devolucao-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
