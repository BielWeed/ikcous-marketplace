// Contrato offline da 1664. A prova das saídas de dinheiro e das permissões roda só no clone do CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql";
const pasta = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rollback = ler(`supabase/migrations/rollback-manual-${nome}`);
const [fichaA, fichaB] = [
  "scripts/publicacao/consultas/220a-conferir-o-reembolso-por-fora-nao-conta-duas-vezes-aplicado.sql",
  "scripts/publicacao/consultas/220b-antes-o-reembolso-por-fora-nao-conta-duas-vezes-base-vigente.sql",
];
const fichas = [ler(fichaA), ler(fichaB)];

const anteriores = [
  {
    funcao: "fin__movimentos",
    assinatura: "public.fin__movimentos(date,date)",
    arquivo:
      "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql",
    antes: "26473edd94ad6547d95de43433088304",
    depois: "17127ad84b6eb71e8cd1714d47855a68",
  },
  {
    funcao: "pedido__saldo_a_estornar",
    assinatura: "public.pedido__saldo_a_estornar(uuid)",
    arquivo: "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql",
    antes: "99741b4cdbf1e8d8340f80440e6da094",
    depois: "7f0c83c80b5f26df9cbc19e92384453d",
  },
  {
    funcao: "admin_devolucao_reembolso_por_fora_apos_espera",
    assinatura:
      "public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)",
    arquivo: "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql",
    antes: "92dd1608d02ef5e9fd9fe34e0bd7c49f",
    depois: "32c2bc1d99162e0450a11431fa8ae411",
  },
  {
    funcao: "pedido_reembolsos_e_saldo",
    assinatura: "public.pedido_reembolsos_e_saldo(uuid)",
    arquivo: "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql",
    antes: "86dd0eaaaa571a4d5e85622e90442bc0",
    depois: "801b199196120f82c4b57ab7abbc9c11",
  },
  {
    funcao: "get_admin_analytics_v2",
    assinatura: "public.get_admin_analytics_v2(integer)",
    arquivo:
      "20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql",
    antes: "1624212a7096b6f49a80370b30191a15",
    depois: "3853f60efad86f22deb368ed791d76cb",
  },
] as const;

const novas = [
  {
    funcao: "order_refund__valor_coberto_por_fora",
    hash: "b02ca216bd69262ba5f5ca4034d6db4a",
  },
  {
    funcao: "order_refund__suspeitas_do_pedido",
    hash: "ecf3eb8ffbe6926ef78678f51ca3f24f",
  },
  {
    funcao: "admin_devolucao_confirmar_mesmo_dinheiro",
    hash: "a17c0572552eaef549ff3b0dfab76622",
  },
  {
    funcao: "admin_devolucao_confirmar_dois_reembolsos",
    hash: "7d8a4faa9bd8954cf9cb9851bf8dfde5",
  },
] as const;

function definicao(texto: string, fn: string) {
  const inicio = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (inicio < 0) return null;
  const tagInicio = texto.indexOf("\nAS $", inicio) + 4;
  const tagFim = texto.indexOf("$", tagInicio + 1) + 1;
  const tag = texto.slice(tagInicio, tagFim);
  const fim = texto.indexOf(`${tag};`, tagFim);
  return {
    texto: texto.slice(inicio, fim + tag.length + 1),
    cabecalho: texto.slice(inicio, tagInicio),
    corpo: texto.slice(tagFim, fim),
  };
}
const hash = (s: string) => createHash("md5").update(s).digest("hex");

Deno.test("1664: reembolso tardio exige confirmação explícita para mudar o saldo", () => {
  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS cobre_devolucao_id uuid"));
  assert.ok(
    sql.includes(
      "CONSTRAINT order_refunds_cobre_devolucao_id_fkey REFERENCES public.devolucoes(id)",
    ),
  );
  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS devolucao_id uuid"));
  assert.ok(
    sql.includes(
      "devolucao_id = COALESCE(pv.devolucao_id, EXCLUDED.devolucao_id)",
    ),
  );
  assert.ok(
    sql.includes(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_cobre_devolucao",
    ),
  );
  assert.ok(
    sql.includes(
      "CHECK (cobre_devolucao_id IS NULL OR dobro_conferido_em IS NULL)",
    ),
  );

  const suspeitas = definicao(sql, "order_refund__suspeitas_do_pedido");
  assert.ok(suspeitas);
  for (const trecho of [
    "r.solicitado_por = 'sistema' THEN 'A'",
    "r.created_at > d.registrado_em",
    "pv.substituida_por_manual_em IS NOT NULL",
    "r.concluido_em > pv.por_fora_liberado_em THEN 'B'",
    "r.caminho = 'B' AND r.devolucao_id = d.id",
    "r.status = 'concluido' AND r.concluido_em IS NOT NULL",
    "r.mp_chargeback_id IS NULL AND r.cobre_devolucao_id IS NULL AND r.dobro_conferido_em IS NULL",
  ])
    assert.ok(suspeitas.corpo.includes(trecho), trecho);

  const cobertura = definicao(sql, "order_refund__valor_coberto_por_fora");
  assert.ok(cobertura);
  assert.ok(
    cobertura.corpo.includes(
      "d.id = r.cobre_devolucao_id AND d.order_id = r.order_id",
    ),
  );
  assert.ok(cobertura.corpo.includes("LEAST(r.amount, d.valor_reembolso)"));
  assert.ok(
    definicao(sql, "pedido__saldo_a_estornar")?.corpo.includes(
      "+ public.order_refund__valor_coberto_por_fora(o.id)",
    ),
  );
  assert.ok(
    definicao(sql, "pedido_reembolsos_e_saldo")?.corpo.includes(
      "'possivel_dobro'",
    ),
  );
  assert.ok(
    definicao(sql, "fin__movimentos")?.corpo.includes(
      "JOIN public.devolucoes d ON d.id = r.cobre_devolucao_id",
    ),
  );
});

Deno.test("1664: só admin atual concilia e as decisões são exclusivas", () => {
  for (const fn of [
    "admin_devolucao_confirmar_mesmo_dinheiro",
    "admin_devolucao_confirmar_dois_reembolsos",
  ]) {
    const d = definicao(sql, fn);
    assert.ok(d);
    assert.ok(
      d.cabecalho.includes("SECURITY DEFINER\nSET search_path = public"),
    );
    const guarda = d.corpo.indexOf("IF NOT public.is_admin_atual() THEN");
    assert.ok(guarda >= 0 && guarda < d.corpo.indexOf("SELECT * INTO"));
    assert.ok(d.corpo.includes("FOR UPDATE"));
    assert.ok(d.corpo.includes("v_r.order_id IS DISTINCT FROM"));
    assert.ok(d.corpo.includes("order_refund__suspeitas_do_pedido"));
    assert.ok(
      sql.includes(
        `REVOKE ALL ON FUNCTION public.${fn}(uuid, uuid) FROM PUBLIC, anon;`,
      ),
    );
    assert.ok(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION public.${fn}(uuid, uuid) TO authenticated;`,
      ),
    );
    assert.ok(rollback.includes(`DROP FUNCTION public.${fn}(uuid,uuid);`));
  }
  assert.ok(!sql.includes("GRANT SELECT ON TABLE public.order_refund_prova"));
});

Deno.test("1664: as funções vigentes mantém os cabeçalhos e o rollback restaura os corpos exatos", () => {
  const fontes = [...Deno.readDirSync(pasta)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort();
  for (const f of anteriores) {
    const base = definicao(ler(`supabase/migrations/${f.arquivo}`), f.funcao);
    const aplicada = definicao(sql, f.funcao);
    const desfeita = definicao(rollback, f.funcao);
    assert.ok(base && aplicada && desfeita, f.funcao);
    assert.equal(base.cabecalho, aplicada.cabecalho, f.funcao);
    assert.equal(desfeita.texto, base.texto, f.funcao);
    assert.equal(hash(base.corpo), f.antes, f.funcao);
    assert.equal(hash(aplicada.corpo), f.depois, f.funcao);
    assert.ok(
      sql.includes(`('${f.assinatura}', '${f.antes}', '${f.depois}')`),
      f.funcao,
    );
    assert.ok(
      rollback.includes(f.antes) && rollback.includes(f.depois),
      f.funcao,
    );

    const quem = fontes.filter((n) =>
      definicao(ler(`supabase/migrations/${n}`), f.funcao),
    );
    assert.deepEqual(quem.slice(-2), [f.arquivo, nome], f.funcao);
  }
  for (const f of novas) {
    const d = definicao(sql, f.funcao);
    assert.ok(d);
    assert.equal(hash(d.corpo), f.hash, f.funcao);
    assert.ok(sql.includes(f.hash), f.funcao);
  }
  for (const t of [sql, rollback]) {
    assert.ok(!/^\s*(?:BEGIN|COMMIT);\s*$/im.test(t));
    assert.ok(t.includes("SET LOCAL lock_timeout = '5s'"));
  }
  assert.ok(rollback.includes("CONFERENCIA_DE_REEMBOLSO_NAO_SE_APAGA"));
  assert.ok(
    rollback.includes(
      "DROP COLUMN cobre_devolucao_id, DROP COLUMN dobro_conferido_em",
    ),
  );
});

Deno.test("1664: as fichas a/b, verificações e o CI registram todos os objetos", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const db = require("../scripts/db-apply.cjs");
  const verifica =
    db.VERIFICACOES[
      "20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql"
    ];
  assert.equal(verifica.length, anteriores.length + novas.length);
  for (const v of verifica) {
    const d = definicao(sql, v.funcao);
    assert.ok(d, v.funcao);
    assert.equal(
      db.avaliarChecagem(d.texto, v).situacao,
      "verificada",
      v.funcao,
    );
  }

  const a = fichaA.split("/").at(-1)?.replace(".sql", "") ?? "";
  const b = fichaB.split("/").at(-1)?.replace(".sql", "") ?? "";
  const rol = new Map(Object.entries(conf.ROL_FECHADO_POR_CONSULTA));
  assert.deepEqual(rol.get(a), rol.get(b));
  assert.equal((rol.get(a) as string[]).length, 21);
  assert.equal(
    fichas.every((s) => conf.contarStatements(s) === 1),
    true,
  );
  for (const f of anteriores) {
    assert.ok(fichas[0].includes(f.depois), f.funcao);
    assert.ok(fichas[1].includes(f.antes), f.funcao);
  }
  for (const f of novas) {
    assert.ok(fichas[0].includes(f.hash), f.funcao);
    assert.ok(fichas[1].includes(`('${f.funcao}',`), f.funcao);
  }
  const release = ler("scripts/frota/publicar-release.mjs");
  const consultaCi = ler(".github/workflows/conferir-banco-da-loja.yml");
  const testeCi = ler(".github/workflows/rpc-ci.yml");
  for (const id of [a, b]) {
    assert.ok(
      release.includes(id) && consultaCi.includes(id) && testeCi.includes(id),
      id,
    );
  }
  assert.ok(
    testeCi.includes(
      "tests/banco/o-reembolso-por-fora-nao-conta-duas-vezes-viva.cjs",
    ),
  );
});
