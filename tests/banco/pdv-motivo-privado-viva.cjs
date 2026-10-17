"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os arquivos lidos são migrations com nomes fixos do próprio repositório. */
/**
 * PROVA VIVA da 20261249: o motivo do balcão nasce privado, nunca em notes.
 * Mesmo harness das provas 235/248: provisionar.cjs + aplicar-migrations.cjs
 * montam PG17 efêmero; rodar-isolado.cjs entrega um clone exclusivo já migrado.
 * lerDatabaseUrlEfemera recusa banco externo e execução fora do CI efêmero.
 * Fixtures, migrations, rollbacks e mutantes ficam numa transação desfeita.
 * Não prova Supabase/PostgREST nem ambiente externo.
 *
 * Casos: desconto com motivo; RLS real para cliente cadastrada; ausência de
 * motivo com/sem desconto; tabs/quebras; 2001 recusado antes da escrita e 2000
 * aceito sem truncar; motivo mesmo sem desconto; repetição não reescreve nota;
 * carimbo do vendedor; falha da nota desfaz venda/estoque; dados antigos ficam;
 * atributos/ACL/proconfig, hash real, apply 2x, pré-voo e rollback byte a byte.
 *
 * Mutantes: notes público; histórico com motivo; INSERT incondicional; INSERT fora do IF da venda
 * nova; INSERT depois do handler; sem limite; D4 antiga; truncar. Os dois
 * deslocamentos também têm prova de POSIÇÃO no prosrc vivo: mover o INSERT
 * pode ser equivalente em vendas sem falha, mas viola o bloco aprovado.
 * Cada mutante só conta como morto por AssertionError da prova indicada,
 * nunca por falha de compilar SQL ou por falha de infraestrutura.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/pdv-motivo-privado-viva.cjs
 */
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const NOME =
  "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql";
const BASE =
  "20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql";
const FN =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const bloco = (s) => {
  const a = s.indexOf(
    "CREATE OR REPLACE FUNCTION public.registrar_venda_presencial(",
  );
  const b = s.indexOf("\n$$;", a);
  assert(a >= 0 && b > a, "bloco da RPC não encontrado");
  return s.slice(a, b + 4);
};
const corpo = (s) => {
  const f = bloco(s);
  return f.slice(f.indexOf("AS $$") + 5, -3);
};
const FUNCAO = bloco(MIGRATION);
const HASH = createHash("md5").update(corpo(MIGRATION)).digest("hex");
const HASH_BASE = "996caf02505ac16a8bded73bcf8900aa";
const ADMIN = "e2490000-0000-4000-8000-000000000001";
const CLIENTE = "e2490000-0000-4000-8000-000000000002";
const MOTIVO = "Ajuste autorizado pela loja";
const MSG_OBRIGATORIO = "Informe o motivo do desconto.";
const MSG_LIMITE = "O motivo do desconto pode ter até 2000 caracteres.";
const MSG_CHAVE = "Esta chave de venda já foi usada por outro pedido.";
const NOTA = `            IF v_motivo IS NOT NULL THEN
                INSERT INTO public.marketplace_order_internal_notes (order_id, note)
                VALUES (v_order_id, v_motivo);
            END IF;`;
const LIMITE = `        IF v_motivo IS NOT NULL AND length(v_motivo) > 2000 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O motivo do desconto pode ter até 2000 caracteres.';
        END IF;`;

async function entrar(c, uid, admin) {
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [
      uid,
      JSON.stringify({
        sub: uid,
        role: "authenticated",
        app_metadata: { role: admin ? "admin" : "customer" },
      }),
    ],
  );
}
async function semente(c) {
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
  await c.query("GRANT USAGE ON SCHEMA extensions TO authenticated");
  for (const [id, role] of [
    [ADMIN, "admin"],
    [CLIENTE, "customer"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, ($1::uuid)::text || '@pdv-privado.teste', jsonb_build_object('role', $2::text))",
      [id, role],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova PDV privado', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role",
      [id, role],
    );
  }
  assert.deepEqual(
    (
      await c.query(
        "SELECT u.raw_app_meta_data->>'role' AS a, p.role AS p FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id = $1",
        [ADMIN],
      )
    ).rows,
    [{ a: "admin", p: "admin" }],
  );
}
async function produto(c) {
  const id = randomUUID();
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Produto PDV privado', 100, 10, true, 60)",
    [id],
  );
  return id;
}
// A recusa é capturada num savepoint para medir o que ficou APÓS o erro da RPC.
async function vender(
  c,
  p,
  {
    desconto = 10,
    motivo = MOTIVO,
    chave = randomUUID(),
    cliente = CLIENTE,
  } = {},
) {
  await c.query("SAVEPOINT chamada");
  try {
    await entrar(c, ADMIN, true);
    const r = await c.query(
      "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', $2::uuid, NULL, NULL, $3::numeric, $4::text, $5::uuid) AS r",
      [
        JSON.stringify([{ product_id: p, quantity: 1 }]),
        cliente,
        desconto,
        motivo,
        chave,
      ],
    );
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT chamada");
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT chamada");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT chamada");
    return { ok: false, code: e.code, message: e.message };
  }
}
const notas = async (c, id) =>
  (
    await c.query(
      "SELECT order_id::text, note, updated_by::text, updated_at FROM public.marketplace_order_internal_notes WHERE order_id = $1",
      [id],
    )
  ).rows;
async function dados(c, p) {
  return (
    await c.query(
      `SELECT
    (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
    (SELECT count(*)::int FROM public.marketplace_order_internal_notes) AS notas,
    (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
    (SELECT count(*)::int FROM public.marketplace_order_history) AS historicos,
    (SELECT count(*)::int FROM public.marketplace_order_payment_history) AS pagamentos,
    (SELECT estoque FROM public.produtos WHERE id = $1) AS estoque`,
      [p],
    )
  ).rows[0];
}
const exigirVenda = (v) =>
  assert.equal(v.ok, true, `venda recusada: ${v.code} ${v.message}`);
async function motivoPrivado(c) {
  const p = await produto(c);
  const v = await vender(c, p, { motivo: `  ${MOTIVO}  ` });
  exigirVenda(v);
  assert.equal(v.r.ja_existia, false);
  assert.equal(
    v.r.order.notes,
    null,
    "motivo jamais sai no retorno público da venda nova",
  );
  assert.equal(
    (
      await c.query(
        "SELECT notes FROM public.marketplace_orders WHERE id = $1",
        [v.r.order.id],
      )
    ).rows[0].notes,
    null,
  );
  const n = await notas(c, v.r.order.id);
  assert.equal(n.length, 1);
  assert.equal(n[0].note, MOTIVO, "texto aparado, sem truncar");
  assert.equal(n[0].updated_by, ADMIN, "carimbo é do vendedor autenticado");
  assert.equal(
    n[0].updated_at.getTime(),
    (await c.query("SELECT now() AS agora")).rows[0].agora.getTime(),
  );
  assert.equal(v.r.order.user_id, CLIENTE);
  assert.equal(Number(v.r.order.total), 90);
  assert.equal((await dados(c, p)).estoque, 9);
  // O histórico do pedido é legível pela dona (20261202): leva só a frase fixa, nunca o motivo.
  assert.deepEqual(
    (
      await c.query(
        "SELECT notes FROM public.marketplace_order_history WHERE order_id = $1",
        [v.r.order.id],
      )
    ).rows,
    [{ notes: "Venda no balcão" }],
    "histórico legível pela cliente só leva a frase fixa",
  );

  await entrar(c, CLIENTE, false);
  try {
    const privado = await c.query(
      "SELECT note FROM public.marketplace_order_internal_notes WHERE order_id = $1",
      [v.r.order.id],
    );
    assert.equal(
      privado.rowCount,
      0,
      "RLS real esconde a nota da dona do pedido",
    );
    const publico = await c.query(
      "SELECT notes FROM public.marketplace_orders WHERE id = $1",
      [v.r.order.id],
    );
    assert.deepEqual(
      publico.rows,
      [{ notes: null }],
      "cliente lê seu pedido com notes NULL",
    );
  } finally {
    await c.query("RESET ROLE");
  }
}
async function semMotivo(c) {
  for (const motivo of [null, "", "   ", "\t\r\n"]) {
    const p = await produto(c);
    const v = await vender(c, p, { desconto: 0, motivo });
    exigirVenda(v);
    assert.equal(v.r.order.notes, null);
    assert.equal(
      (await notas(c, v.r.order.id)).length,
      0,
      "sem motivo NÃO cria linha privada",
    );
    assert.equal((await dados(c, p)).estoque, 9);
  }
}
async function motivoSemDesconto(c) {
  const p = await produto(c);
  const v = await vender(c, p, { desconto: 0, motivo: `  ${MOTIVO}  ` });
  exigirVenda(v);
  assert.equal(v.r.order.notes, null);
  assert.equal((await notas(c, v.r.order.id))[0].note, MOTIVO);
}
async function recusa(c, motivo, desconto, mensagem) {
  const p = await produto(c);
  const antes = await dados(c, p);
  const v = await vender(c, p, { motivo, desconto });
  assert.deepEqual(v, { ok: false, code: "22023", message: mensagem });
  assert.deepEqual(
    await dados(c, p),
    antes,
    "nenhum cabeçalho, nota, item, histórico ou estoque persiste",
  );
}
async function brancoComDesconto(c) {
  for (const motivo of [null, " ", "\t\r\n", " \t\n "]) {
    await recusa(c, motivo, 10, MSG_OBRIGATORIO);
  }
}
async function acimaDoLimite(c) {
  for (const desconto of [0, 10]) {
    await recusa(c, "á".repeat(2001), desconto, MSG_LIMITE);
  }
  // Mesmo com produto inexistente, a validação tem de vir ANTES do laço do estoque.
  const v = await vender(c, randomUUID(), { motivo: "á".repeat(2001) });
  assert.deepEqual(v, { ok: false, code: "22023", message: MSG_LIMITE });
}
async function limiteExato(c) {
  for (const texto of ["á".repeat(2000), "🧾".repeat(2000)]) {
    const p = await produto(c);
    const v = await vender(c, p, { motivo: `  ${texto}  ` });
    exigirVenda(v);
    assert.equal(v.r.order.notes, null);
    assert.equal(
      (await notas(c, v.r.order.id))[0].note,
      texto,
      "limite em caracteres PostgreSQL, sem perder conteúdo",
    );
  }
}
async function repeticao(c) {
  const p = await produto(c);
  const chave = randomUUID();
  const a = await vender(c, p, { chave });
  exigirVenda(a);
  const original = await notas(c, a.r.order.id);
  const antes = await dados(c, p);
  for (const motivo of ["Outro motivo", "x".repeat(2001), "\t\n"]) {
    const b = await vender(c, p, { chave, motivo });
    exigirVenda(b);
    assert.deepEqual(b.r, { ...a.r, ja_existia: true });
    assert.deepEqual(
      await notas(c, a.r.order.id),
      original,
      "nota e carimbos originais intactos",
    );
    assert.deepEqual(
      await dados(c, p),
      antes,
      "uma venda, uma nota, uma baixa",
    );
  }
}
// A posição é parte explícita do contrato aprovado e é medida no corpo VIVO.
async function posicaoAtomica(c) {
  const s = (await catalogo(c)).fonte;
  const a = s.indexOf("    IF NOT v_ja_existia THEN");
  const cabecalho = s.indexOf(
    "        BEGIN\n            INSERT INTO public.marketplace_orders (",
  );
  const retorno = s.indexOf(
    "            ) RETURNING id INTO v_order_id;",
    cabecalho,
  );
  const n = s.indexOf(NOTA);
  const handler = s.indexOf("\n        EXCEPTION", cabecalho);
  const fimVendaNova = s.indexOf("\n    END IF;", handler);
  assert(
    a > 0 &&
      cabecalho > a &&
      retorno > cabecalho &&
      n > retorno &&
      handler > n &&
      fimVendaNova > handler,
    "INSERT privado condicional imediatamente após o cabeçalho, dentro do BEGIN/handler e da venda nova",
  );
  assert.equal(
    s
      .slice(retorno + "            ) RETURNING id INTO v_order_id;".length, n)
      .trim(),
    "",
  );
  assert.equal(
    s.split("INSERT INTO public.marketplace_order_internal_notes").length - 1,
    1,
  );
}
async function falhaDaNota(c) {
  const p = await produto(c);
  const antes = await dados(c, p);
  await c.query(
    `CREATE FUNCTION public.pdv249_falha_nota() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='falha injetada na nota'; END; $$;
    CREATE TRIGGER pdv249_falha_nota BEFORE INSERT ON public.marketplace_order_internal_notes
      FOR EACH ROW EXECUTE FUNCTION public.pdv249_falha_nota()`,
  );
  try {
    const v = await vender(c, p);
    // Dentro do handler, o cabeçalho é desfeito antes de procurar a chave: não existe.
    // Fora dele a mensagem seria a da injeção. O erro continua sendo propagado.
    assert.deepEqual(v, { ok: false, code: "23505", message: MSG_CHAVE });
    assert.deepEqual(
      await dados(c, p),
      antes,
      "falha privada não deixa venda pela metade",
    );
  } finally {
    await c.query(
      "DROP TRIGGER pdv249_falha_nota ON public.marketplace_order_internal_notes; DROP FUNCTION public.pdv249_falha_nota()",
    );
  }
}
async function catalogo(c) {
  const r = await c.query(
    `SELECT replace(prosrc, E'\\r', '') AS fonte, md5(replace(prosrc, E'\\r', '')) AS hash,
    proowner, proacl::text AS acl, prosecdef, proconfig::text AS proconfig, provolatile, proisstrict,
    proretset, pronargs, proargnames, pg_get_function_arguments(oid) AS args,
    pg_get_function_result(oid) AS retorno, prolang, obj_description(oid, 'pg_proc') AS comentario
    FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [FN],
  );
  assert.equal(r.rowCount, 1);
  return r.rows[0];
}
const atributos = ({ fonte, hash, ...resto }) => resto;
async function migrationERollback(c) {
  const atual = await catalogo(c);
  assert.equal(atual.hash, HASH, "hash vivo = md5 real do texto do arquivo");
  assert.equal(atual.fonte, corpo(MIGRATION));
  assert.equal(atual.prosecdef, true);
  assert.equal(atual.proconfig, '{"search_path=pg_catalog, pg_temp"}');
  assert.equal(atual.acl, "{postgres=X/postgres,authenticated=X/postgres}");
  assert.equal(atual.provolatile, "v");
  assert.equal(atual.proisstrict, false);
  const p = await produto(c);
  const v = await vender(c, p);
  exigirVenda(v);
  const notaAntes = await notas(c, v.r.order.id);
  await c.query(ROLLBACK);
  const antigo = await catalogo(c);
  assert.equal(antigo.hash, HASH_BASE);
  assert.equal(
    antigo.fonte,
    corpo(ler(BASE)),
    "rollback devolve corpo vivo da 235 byte a byte",
  );
  assert.deepEqual(atributos(antigo), atributos(atual));
  assert.deepEqual(
    await notas(c, v.r.order.id),
    notaAntes,
    "rollback preserva nota privada já gravada",
  );
  // Controle do vazamento antigo e do limite declarado: o apply não reescreve linha.
  const velha = await vender(c, p, {
    motivo: "Motivo antigo fica onde estava",
  });
  exigirVenda(velha);
  assert.equal(velha.r.order.notes, "Motivo antigo fica onde estava");
  const antes = await dados(c, p);
  await c.query(ROLLBACK); // rollback também é repetível
  await c.query(MIGRATION);
  await c.query(MIGRATION); // reaplicar exatamente o mesmo corpo
  assert.deepEqual(await catalogo(c), atual);
  assert.deepEqual(await dados(c, p), antes);
  assert.deepEqual(await notas(c, v.r.order.id), notaAntes);
  assert.equal(
    (
      await c.query(
        "SELECT notes FROM public.marketplace_orders WHERE id = $1",
        [velha.r.order.id],
      )
    ).rows[0].notes,
    velha.r.order.notes,
  );
}
async function prevoo(c) {
  const casos = [
    [
      "corpo desconhecido",
      FUNCAO.replace(
        "    v_vendedor uuid;",
        "    v_vendedor uuid; -- byte estranho",
      ),
    ],
    ["SECURITY INVOKER", `ALTER FUNCTION ${FN} SECURITY INVOKER`],
    ["search_path", `ALTER FUNCTION ${FN} SET search_path TO public`],
    ["EXECUTE público", `GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`],
    [
      "sem índice da chave",
      "DROP INDEX public.marketplace_orders_chave_da_compra_unica",
    ],
    [
      "sem tabela privada",
      "DROP TABLE public.marketplace_order_internal_notes",
    ],
    [
      "RLS desligada",
      "ALTER TABLE public.marketplace_order_internal_notes DISABLE ROW LEVEL SECURITY",
    ],
    [
      "política ausente",
      "DROP POLICY nota_interna_so_admin_atual ON public.marketplace_order_internal_notes",
    ],
    [
      "gatilho desligado",
      "ALTER TABLE public.marketplace_order_internal_notes DISABLE TRIGGER nota_interna_carimba_quem_e_quando",
    ],
    [
      "ACL fechada",
      "REVOKE INSERT ON public.marketplace_order_internal_notes FROM authenticated",
    ],
    [
      "CHECK ausente",
      "ALTER TABLE public.marketplace_order_internal_notes DROP CONSTRAINT marketplace_order_internal_notes_note_check",
    ],
    [
      "dono da função diferente do dono do pedido",
      `CREATE ROLE pdv249_dono NOLOGIN; GRANT CREATE ON SCHEMA public TO pdv249_dono; ALTER FUNCTION ${FN} OWNER TO pdv249_dono`,
      /o dono de .* não é o dono de marketplace_orders/,
    ],
    [
      "publicada",
      "CREATE PUBLICATION pdv249_publicada FOR TABLE public.marketplace_order_internal_notes",
    ],
  ];
  for (const [rotulo, sql, padrao] of casos) {
    await c.query("SAVEPOINT divergencia");
    try {
      await c.query(sql);
      const antes = await catalogo(c);
      await c.query("SAVEPOINT tentativa");
      let erro;
      try {
        await c.query(MIGRATION);
      } catch (e) {
        erro = e;
      }
      await c.query("ROLLBACK TO SAVEPOINT tentativa");
      await c.query("RELEASE SAVEPOINT tentativa");
      assert(erro, `pré-voo aceitou: ${rotulo}`);
      assert.match(erro.message, padrao ?? /B1_BASELINE_DIVERGENT/, rotulo);
      assert.deepEqual(
        await catalogo(c),
        antes,
        `pré-voo não muda função: ${rotulo}`,
      );
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT divergencia");
      await c.query("RELEASE SAVEPOINT divergencia");
    }
  }
}
function trocar(s, a, b) {
  assert.equal(s.split(a).length - 1, 1, `âncora do mutante não é única: ${a}`);
  return s.replace(a, () => b);
}
async function mutantes(c) {
  const semNota = trocar(FUNCAO, `\n\n${NOTA}`, "");
  const foraVenda = trocar(
    semNota,
    "    -- (10) UM ÚNICO ponto de montagem",
    `${NOTA}\n\n    -- (10) UM ÚNICO ponto de montagem`,
  );
  const depoisHandler = trocar(
    semNota,
    "        END;\n    END IF;",
    `        END;\n${NOTA}\n    END IF;`,
  );
  const lista = [
    [
      "notes volta a receber motivo",
      trocar(
        FUNCAO,
        "                NULL,\n                p_idempotency_key",
        "                NULLIF(btrim(COALESCE(p_observacao,'')),''),\n                p_idempotency_key",
      ),
      motivoPrivado,
    ],
    [
      "INSERT privado incondicional",
      trocar(
        FUNCAO,
        NOTA,
        "            INSERT INTO public.marketplace_order_internal_notes (order_id, note)\n            VALUES (v_order_id, v_motivo);",
      ),
      semMotivo,
    ],
    ["INSERT fora do IF da venda nova", foraVenda, posicaoAtomica],
    ["INSERT depois do handler", depoisHandler, falhaDaNota],
    ["sem validação de 2000", trocar(FUNCAO, LIMITE, ""), acimaDoLimite],
    [
      "D4 não usa v_motivo",
      trocar(
        FUNCAO,
        "IF v_desconto > 0 AND v_motivo IS NULL THEN",
        "IF v_desconto > 0 AND NULLIF(btrim(COALESCE(p_observacao,'')),'') IS NULL THEN",
      ),
      brancoComDesconto,
    ],
    [
      "motivo copiado para o histórico do pedido",
      trocar(
        FUNCAO,
        "'delivered', 'Venda no balcão', v_vendedor",
        "'delivered', COALESCE(v_motivo, 'Venda no balcão'), v_vendedor",
      ),
      motivoPrivado,
    ],
    [
      "truncar em vez de recusar",
      trocar(FUNCAO, LIMITE, "        v_motivo := left(v_motivo, 2000);"),
      acimaDoLimite,
    ],
  ];
  for (const [nome, sql, prova] of lista) {
    await c.query("SAVEPOINT mutante");
    try {
      await c.query(sql); // compilar não conta como matar
      let morto = false;
      try {
        await prova(c);
      } catch (e) {
        if (!(e instanceof assert.AssertionError)) throw e;
        morto = true;
      }
      assert(morto, `MUTANTE SOBREVIVEU: ${nome}`);
      console.log(`      mutante morto: ${nome} <- ${prova.name}`);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT mutante");
      await c.query("RELEASE SAVEPOINT mutante");
    }
  }
  assert.equal(
    (await catalogo(c)).fonte,
    corpo(MIGRATION),
    "corpo restaurado após mutantes",
  );
}

async function main() {
  // Obrigatório falhar enquanto o md5 ainda não foi medido no PG pelo integrador.
  assert(
    !MIGRATION.includes("__HASH_DESTA_A_PREENCHER__"),
    "hash real da 249 ainda não preenchido",
  );
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  const resultados = [];
  try {
    assert.equal(
      (await catalogo(c)).hash,
      HASH,
      "banco deve ter todas as migrations aplicadas",
    );
    await c.query("BEGIN");
    await semente(c);
    for (const [nome, prova] of [
      ["motivo privado e cliente cadastrada sem acesso", motivoPrivado],
      ["sem motivo, sem linha privada", semMotivo],
      ["motivo sem desconto", motivoSemDesconto],
      ["branco com desconto recusa sem escrever", brancoComDesconto],
      ["2001 caracteres recusa antes da escrita", acimaDoLimite],
      ["2000 caracteres intactos", limiteExato],
      ["repetição preserva nota original", repeticao],
      ["posição dentro do bloco atômico", posicaoAtomica],
      ["falha privada desfaz venda e estoque", falhaDaNota],
      [
        "hash/atributos/ACL, 2x e rollback preservando notas",
        migrationERollback,
      ],
      ["pré-voo operacional recusa divergências", prevoo],
      ["oito mutantes mortos pela prova indicada", mutantes],
    ]) {
      await c.query("SAVEPOINT prova");
      try {
        await prova(c);
        resultados.push({ nome, ok: true });
        console.log(`  ok   ${nome}`);
      } catch (e) {
        resultados.push({ nome, ok: false });
        console.log(`  FAIL ${nome}\n${e.stack || e}`);
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT prova");
        await c.query("RELEASE SAVEPOINT prova");
      }
    }
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  const falhas = resultados.filter((r) => !r.ok);
  const resumo = `${
    resultados.length - falhas.length
  }/${resultados.length} provas do motivo privado do balcão verdes.`;
  console.log(`\n[pdv-motivo-privado] ${resumo}`);
  anexarAoSummary("Prova viva: motivo privado do balcão (20261249)", resumo);
  if (falhas.length) process.exitCode = 1;
}
main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
