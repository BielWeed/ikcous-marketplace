import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const nome =
  "20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$$";
const definicao = (sql: string, fn: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string, fn: string) => {
  const d = definicao(sql, fn);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const CASOS = [
  {
    fn: "devolucao_elegibilidade",
    antes: "0bdb635f4f04e8edb894b70da58282e7",
    depois: "bedd211bba45261dfbf962241ca3c9dd",
    origem:
      "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
  },
  {
    fn: "solicitar_devolucao",
    antes: "a12d11acdcc07992f4a5f527106a1cf8",
    depois: "52e5c30c06f9767a97e98f3a393b8496",
    origem:
      "supabase/migrations/20261175000000_a_devolucao_nasce_no_pedido.sql",
  },
  {
    fn: "devolucao_detalhe",
    antes: "6897a45df3e5d29256f85611ea3ca91f",
    depois: "a439e320641d553e3a21883c6606c6f2",
    origem:
      "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
  },
] as const;

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const AUS = "AND di.condicao IS DISTINCT FROM 'ausente'";

// Desfaz, a mao, so o que a migration declara: sobra o corpo vigente.
const inverso = (fn: string, c: string) => {
  let r = c;
  if (fn === "devolucao_elegibilidade") {
    r = r.replace(
      /\n {26}-- 20261399992000:[^\n]*\n {26}AND di\.condicao IS DISTINCT FROM 'ausente'\)/,
      ")",
    );
  } else if (fn === "solicitar_devolucao") {
    r = r.replace(
      /\n {7}-- 20261399992000:[^\n]*\n {7}AND di\.condicao IS DISTINCT FROM 'ausente';/g,
      ";",
    );
  } else {
    r = r
      .replace(/ {4}-- 20261399992000:[^\n]*\n/, "")
      .replace(
        /jsonb_agg\(to_jsonb\(i\) \|\| jsonb_build_object\('ja_pedido_e_nao_veio', EXISTS \([\s\S]*?da\.created_at < v_d\.created_at\)\) ORDER BY/,
        "jsonb_agg(to_jsonb(i) ORDER BY",
      );
  }
  return r;
};

Deno.test("399992: o corpo anterior e' o vigente (175 e 199); o novo e' o pinado; o rollback devolve o vigente byte a byte", () => {
  for (const c of CASOS) {
    const origem = ler(c.origem);
    assert.equal(md5(corpo(origem, c.fn)), c.antes, `${c.fn}: vigente`);
    assert.equal(md5(corpo(sql, c.fn)), c.depois, `${c.fn}: desta`);
    assert.equal(md5(corpo(rb, c.fn)), c.antes, `${c.fn}: rollback`);
    assert.equal(
      definicao(rb, c.fn),
      definicao(origem, c.fn),
      `${c.fn}: rollback inteiro`,
    );
    // Cabecalho (assinatura, SECURITY DEFINER, volatilidade, search_path, retorno) igual ao vigente.
    assert.equal(
      definicao(sql, c.fn).split(DELIM)[0],
      definicao(origem, c.fn).split(DELIM)[0],
      `${c.fn}: cabecalho`,
    );
    // Desfeita a troca declarada, sobra o vigente, byte a byte.
    assert.equal(
      inverso(c.fn, corpo(sql, c.fn)),
      corpo(origem, c.fn),
      `${c.fn}: inverso`,
    );
  }
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 3);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 3);
});

Deno.test("399992: a regra nova esta onde deve e so ela", () => {
  const e = corpo(sql, "devolucao_elegibilidade");
  const s = corpo(sql, "solicitar_devolucao");
  const t = corpo(sql, "devolucao_detalhe");
  // Elegibilidade: UMA condicao, dentro da conta do "ja devolvido" de cada item.
  assert.equal(e.split(AUS).length - 1, 1);
  assert.ok(e.indexOf("AS ja") > e.indexOf(AUS));
  assert.ok(
    e.indexOf(AUS) >
      e.indexOf("d.status NOT IN ('recusada', 'cancelada', 'reprovada')"),
  );
  // Solicitacao: a conta por item (v_ja) e a do frete de ida (v_total_coberto), nenhuma outra.
  assert.equal(s.split(AUS).length - 1, 2);
  const iJa = s.indexOf("INTO v_ja");
  const iCob = s.indexOf("INTO v_total_coberto");
  assert.ok(iJa > 0);
  assert.ok(iCob > iJa);
  assert.ok(s.indexOf(AUS) > iJa);
  assert.ok(s.indexOf(AUS) < s.indexOf("IF v_qtd IS NULL"));
  assert.ok(s.lastIndexOf(AUS) > iCob);
  assert.ok(s.lastIndexOf(AUS) < s.indexOf("IF v_total_coberto"));
  // O PRAZO nao mudou: continua contado da entrega, nas duas funcoes.
  for (const c of [e, s])
    assert.ok(c.includes("devolucao__entregue_em(v_o.id)"));
  assert.ok(s.includes("v_dias := v_hoje - v_entregue_dia;"));
  assert.ok(
    e.includes(
      "v_dias := v_hoje - (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date;",
    ),
  );
  // A solicitacao nova continua nascendo "solicitada" (a lojista aprova) e "uma aberta por pedido" segue valendo.
  assert.ok(
    s.includes("'Já existe uma devolução em andamento para este pedido.'"),
  );
  assert.ok(s.includes("'solicitada'"));
  // Detalhe: o aviso exige anterior CONCLUIDA, 'ausente' e mais antiga; nada de escrita.
  assert.equal(
    t.split("jsonb_build_object('ja_pedido_e_nao_veio', EXISTS (").length - 1,
    1,
  );
  for (const trecho of [
    "a.condicao = 'ausente'",
    "da.status = 'concluida'",
    "da.created_at < v_d.created_at",
    "a.order_item_id = i.order_item_id",
  ])
    assert.equal(t.split(trecho).length - 1, 1, trecho);
  assert.doesNotMatch(semComentarios(t), /\b(?:UPDATE|INSERT|DELETE)\b/);
});

Deno.test("399992: a funcao que devolve o dinheiro nao e' tocada; a migration e' aditiva, sem BEGIN/COMMIT e com pre/pos-voo", () => {
  const codigo = semComentarios(sql);
  for (const fn of [
    "admin_devolucao_concluir",
    "admin_devolucao_reemitir_reembolso",
    "pedido__saldo_a_estornar",
    "solicitar_estorno",
    "registrar_estorno_manual",
  ])
    assert.ok(!codigo.includes(`FUNCTION public.${fn}(`), fn);
  // Regra da casa (AGENTS.md): sem transacao de nivel superior; quem abre e' o aplicador.
  assert.doesNotMatch(codigo, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  assert.doesNotMatch(semComentarios(rb), /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  // Aditiva: nenhuma tabela, coluna, dado, politica nem ACL muda (fora dos corpos e dos blocos DO).
  assert.doesNotMatch(
    codigo.replace(/\$[a-z_0-9]*\$[\s\S]*?\$[a-z_0-9]*\$/g, ""),
    /\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|GRANT|REVOKE|CREATE TABLE|CREATE POLICY)\b/i,
  );
  assert.doesNotMatch(
    semComentarios(rb),
    /\b(?:GRANT|REVOKE|DROP|DELETE|TRUNCATE)\b/i,
  );
  assert.ok(codigo.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(codigo.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(codigo.includes("POSVOO_20261399992000"));
  assert.ok(codigo.includes("NOTIFY pgrst, 'reload schema';"));
  // O pre-voo aceita o vigente OU o desta (reaplicar nao falha); o rollback exige o desta.
  for (const c of CASOS) {
    const linha = sql
      .split("\n")
      .find(
        (l) =>
          l.includes(`('${c.fn}', 'public.${c.fn}(`) && l.includes(c.antes),
      );
    assert.ok(
      linha?.includes(`'${c.antes}', '${c.depois}')`),
      `pre-voo ${c.fn}`,
    );
    const linhaRb = rb
      .split("\n")
      .find(
        (l) =>
          l.includes(`('${c.fn}', 'public.${c.fn}(`) && l.includes(c.depois),
      );
    assert.ok(linhaRb?.includes(`', '${c.depois}')`), `rollback ${c.fn}`);
  }
  // Assinatura exata conferida pelo pre-voo.
  assert.ok(
    sql.includes(
      "'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])'",
    ),
  );
  // Vem depois das duas migrations de origem e do numero anterior da fila.
  assert.ok(nome.slice(0, 14) > "20261199000000");
  assert.ok(nome.slice(0, 14) > "20261399991000");
});

Deno.test("399992: o portao 8e conhece as duas sucessoras (elegibilidade e detalhe) e o solicitar_devolucao nao entra nas 61", () => {
  const oito = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  for (const c of CASOS.filter((x) => x.fn !== "solicitar_devolucao"))
    assert.ok(
      oito.includes(`('${c.fn}', '${c.depois}', '20261399992000')`),
      `8e: sucessora de ${c.fn}`,
    );
  assert.ok(!oito.includes("('solicitar_devolucao'"));
});
