import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Prova de TEXTO (sem banco) da 20261658000000: os corpos novos de solicitar_devolucao e devolucao_elegibilidade, o rollback byte a
// byte, a regra declarada (o frete de ida só conta o que devolveu dinheiro; a quantidade segue contando a troca) e o kit de publicação.
// A prova viva, contra o Postgres, está em tests/banco/devolucoes-viva.cjs ("troca e vale-troca não contam") e a das consultas
// 214a/214b em tests/banco/o-frete-de-ida-so-volta-com-reembolso-portao-viva.cjs.
const nome = "20261658000000_o_frete_de_ida_so_volta_com_reembolso.sql";
const ORIGEM_SOL =
  "supabase/migrations/20261405400000_a_devolucao_integral_nao_perde_o_centavo_do_cupom.sql";
const ORIGEM_ELE =
  "supabase/migrations/20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
const SOL = {
  fn: "solicitar_devolucao",
  assinatura:
    "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])",
  antes: "94ecd75ba32dd0a8ce7d433f4b6f7961",
  depois: "e3f83a07f0a4909fb879ac653c115871",
};
const ELE = {
  fn: "devolucao_elegibilidade",
  assinatura: "public.devolucao_elegibilidade(uuid)",
  antes: "bedd211bba45261dfbf962241ca3c9dd",
  depois: "4776618e9ccd401f7c7eb9518ceaa62d",
};

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
const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const origemSol = ler(ORIGEM_SOL);
const origemEle = ler(ORIGEM_ELE);

// As trocas declaradas no cabeçalho (item 3), como texto exato dos corpos novos.
const FILTRO_ANTIGO =
  "     WHERE d.order_id = v_o.id AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')\n";
const FILTRO_NOVO =
  "       AND (d.id = v_id OR (d.status = 'concluida' AND d.resolucao_final = 'reembolso'))\n";
const TROCA_SOL = [
  "     WHERE d.order_id = v_o.id\n",
  "       -- 20261658000000: para o frete de ida só conta o que devolveu DINHEIRO: esta devolução e as anteriores concluídas com\n",
  '       -- reembolso. Troca e vale-troca não devolvem o dinheiro da peça, então não fazem o pedido "voltar inteiro". NÃO unificar\n',
  "       -- com v_ja (acima): para a QUANTIDADE que ainda pode ser devolvida a troca conta, porque a peça trocada já saiu do pedido.\n",
  FILTRO_NOVO,
].join("");
const CAMPO_ELE =
  "           -- 20261658000000: quanto do item já voltou em DINHEIRO (devolução concluída com reembolso). É a conta do frete de ida.\n" +
  "           'ja_reembolsada', x.reembolsada,\n";
const SUBCONSULTA_ELE =
  ",\n" +
  '             -- 20261658000000: só a devolução concluída com reembolso (fora o item "Não veio"). NÃO unificar com `ja` (acima): `ja` conta\n' +
  "             -- também a troca e o vale, porque a peça trocada já saiu do pedido e não pode ser devolvida de novo; mas troca e vale não\n" +
  '             -- devolvem dinheiro, então não fazem o pedido "voltar inteiro" para o frete de ida (a mesma conta de solicitar_devolucao).\n' +
  "             COALESCE((SELECT sum(di.quantidade) FROM public.devolucao_itens di\n" +
  "                         JOIN public.devolucoes d ON d.id = di.devolucao_id\n" +
  "                        WHERE di.order_item_id = oi.id\n" +
  "                          AND d.status = 'concluida' AND d.resolucao_final = 'reembolso'\n" +
  "                          AND di.condicao IS DISTINCT FROM 'ausente'), 0)::integer AS reembolsada";

const unico = (texto: string, trecho: string, por: string) => {
  assert.equal(vezes(texto, trecho), 1, `alvo único: ${trecho.slice(0, 60)}`);
  return texto.replace(trecho, () => por);
};
// Desfaz, a mão, só o que a migration declara: sobra o corpo vigente, byte a byte.
const inversoSol = (c: string) => unico(c, TROCA_SOL, FILTRO_ANTIGO);
const inversoEle = (c: string) =>
  unico(unico(c, CAMPO_ELE, ""), SUBCONSULTA_ELE, "");

Deno.test("1658: os corpos anteriores sao os vigentes (5400 e 3992); os novos sao os pinados; o rollback devolve os vigentes byte a byte", () => {
  for (const [f, origem] of [
    [SOL, origemSol],
    [ELE, origemEle],
  ] as const) {
    assert.equal(md5(corpo(origem, f.fn)), f.antes, `${f.fn}: vigente`);
    assert.equal(md5(corpo(sql, f.fn)), f.depois, `${f.fn}: desta`);
    assert.equal(md5(corpo(rb, f.fn)), f.antes, `${f.fn}: rollback`);
    assert.equal(
      definicao(rb, f.fn),
      definicao(origem, f.fn),
      `${f.fn}: rollback inteiro`,
    );
    // Cabeçalho (assinatura, SECURITY DEFINER, volatilidade, search_path, retorno) igual ao vigente.
    assert.equal(
      definicao(sql, f.fn).split(DELIM)[0],
      definicao(origem, f.fn).split(DELIM)[0],
      `${f.fn}: cabecalho`,
    );
  }
  // Desfeitas as trocas declaradas, sobram os vigentes, byte a byte.
  assert.equal(inversoSol(corpo(sql, SOL.fn)), corpo(origemSol, SOL.fn));
  assert.equal(inversoEle(corpo(sql, ELE.fn)), corpo(origemEle, ELE.fn));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
  // As vigentes sao as ULTIMAS redefinicoes antes desta (ninguem entre elas e esta mexeu nas duas).
  for (const arq of Deno.readDirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )) {
    const v = arq.name.slice(0, 14);
    if (!/^\d{14}_/.test(arq.name) || v >= nome.slice(0, 14)) continue;
    const t = ler(`supabase/migrations/${arq.name}`);
    if (v > "20261405400000")
      assert.ok(
        !t.includes(`FUNCTION public.${SOL.fn}(`),
        `${arq.name} redefine ${SOL.fn}`,
      );
    if (v > "20261399992000")
      assert.ok(
        !t.includes(`FUNCTION public.${ELE.fn}(`),
        `${arq.name} redefine ${ELE.fn}`,
      );
  }
});

Deno.test("1658: o frete de ida so conta o reembolso; a QUANTIDADE segue contando a troca (as duas contas nao se unificam)", () => {
  const s = corpo(sql, SOL.fn);
  // A soma do frete troca a lista negativa pelo filtro novo; a conta v_ja (quantidade) fica com a lista negativa.
  assert.equal(vezes(s, FILTRO_NOVO), 1);
  assert.equal(
    vezes(s, "d.status NOT IN ('recusada', 'cancelada', 'reprovada')"),
    1,
  );
  const iJa = s.indexOf("INTO v_ja");
  const iFrete = s.indexOf("INTO v_total_coberto");
  assert.ok(iJa > 0 && iFrete > iJa);
  assert.ok(
    s
      .slice(iJa, s.indexOf("IF v_qtd IS NULL", iJa))
      .includes("d.status NOT IN ('recusada', 'cancelada', 'reprovada')"),
    "v_ja segue contando toda devolução que valeu (inclusive a troca)",
  );
  const frete = s.slice(iFrete, s.indexOf("IF v_total_coberto", iFrete));
  assert.ok(frete.includes(FILTRO_NOVO), "o filtro novo esta na soma do frete");
  assert.ok(
    !frete.includes("NOT IN"),
    "a soma do frete nao usa mais a lista negativa",
  );
  assert.ok(
    frete.includes("AND di.condicao IS DISTINCT FROM 'ausente';"),
    "o item 'Nao veio' segue fora do frete",
  );
  // O resto do frete de ida nao muda: so arrependimento/defeito, o pedido inteiro, o valor do frete do pedido.
  assert.ok(s.includes("IF v_tipo IN ('arrependimento', 'vicio') THEN"));
  assert.ok(s.includes("IF v_total_coberto >= v_total_pedido THEN"));
  assert.ok(s.includes("v_frete := COALESCE(v_o.shipping, 0);"));
  assert.equal(vezes(s, "AND di.condicao IS DISTINCT FROM 'ausente'"), 2);

  const e = corpo(sql, ELE.fn);
  // ja_devolvida e disponivel seguem pela conta antiga (x.ja); ja_reembolsada e' a conta nova.
  assert.equal(vezes(e, "'ja_devolvida', x.ja,"), 1);
  assert.equal(vezes(e, "'disponivel', GREATEST(x.quantity - x.ja, 0),"), 1);
  assert.equal(vezes(e, "'ja_reembolsada', x.reembolsada,"), 1);
  assert.equal(
    vezes(e, "COALESCE(sum(GREATEST(x.quantity - x.ja, 0)), 0)"),
    1,
    "o total disponivel (o bloqueio 'todos ja devolvidos') segue por x.ja",
  );
  assert.equal(
    vezes(e, "d.status NOT IN ('recusada', 'cancelada', 'reprovada')"),
    1,
  );
  assert.equal(
    vezes(e, "AND d.status = 'concluida' AND d.resolucao_final = 'reembolso'"),
    1,
  );
  assert.equal(vezes(e, "AND di.condicao IS DISTINCT FROM 'ausente'"), 2);
  // O comentario que impede a "unificacao" das duas contas esta nos dois corpos.
  assert.ok(s.includes("NÃO unificar"));
  assert.ok(e.includes("NÃO unificar"));
});

Deno.test("1658: a funcao que devolve o dinheiro nao e' tocada; a migration e' aditiva, sem BEGIN/COMMIT e com pre/pos-voo", () => {
  const codigo = semComentarios(sql);
  for (const fn of [
    "admin_devolucao_concluir",
    "admin_devolucao_reemitir_reembolso",
    "pedido__saldo_a_estornar",
    "devolucao_detalhe",
    "solicitar_estorno",
    "registrar_estorno_manual",
  ])
    assert.ok(!codigo.includes(`FUNCTION public.${fn}(`), fn);
  // Regra da casa (AGENTS.md): sem transacao de nivel superior; quem abre e' o aplicador.
  assert.doesNotMatch(codigo, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  assert.doesNotMatch(semComentarios(rb), /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  // Aditiva: nenhuma tabela, coluna, dado, politica nem ACL muda (fora dos corpos e dos blocos DO).
  const fora = (texto: string) =>
    semComentarios(
      texto
        .replace(definicao(texto, SOL.fn), "")
        .replace(definicao(texto, ELE.fn), ""),
    )
      .replace(/\$preflight_[a-z_0-9]*\$[\s\S]*?\$preflight_[a-z_0-9]*\$/g, "")
      .replace(/\$posvoo_[a-z_0-9]*\$[\s\S]*?\$posvoo_[a-z_0-9]*\$/g, "");
  assert.doesNotMatch(
    fora(sql),
    /\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|GRANT|REVOKE|CREATE TABLE|CREATE POLICY)\b/i,
  );
  assert.doesNotMatch(
    fora(rb),
    /\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|GRANT|REVOKE|CREATE TABLE|CREATE POLICY)\b/i,
  );
  assert.ok(codigo.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(codigo.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(codigo.includes("POSVOO_20261658000000"));
  assert.ok(semComentarios(rb).includes("B1_BASELINE_DIVERGENT"));
  assert.ok(semComentarios(rb).includes("POSVOO_ROLLBACK_20261658000000"));
  // O pre-voo confere as colunas que a regra nova le.
  assert.ok(codigo.includes("a.attname = 'resolucao_final'"));
  assert.ok(codigo.includes("a.attname = 'condicao'"));
  // O pre-voo aceita o vigente OU o desta (reaplicar nao falha), no formato que tests/banco/sucessoras-da-99.cjs le;
  // o rollback exige o desta e o pos-voo dele o vigente.
  for (const f of [SOL, ELE]) {
    const linha = sql
      .split("\n")
      .find((l) => l.includes(`('${f.fn}', '${f.assinatura}', '${f.antes}'`));
    assert.ok(
      linha?.includes(`'${f.antes}', '${f.depois}')`),
      `pre-voo ${f.fn}`,
    );
    assert.ok(
      codigo.includes(`('${f.fn}', '${f.assinatura}', '${f.depois}')`),
      `pos-voo ${f.fn}`,
    );
    assert.ok(
      semComentarios(rb).includes(
        `('${f.fn}', '${f.assinatura}', '${f.depois}')`,
      ),
      `pre-voo do rollback ${f.fn}`,
    );
    assert.ok(
      semComentarios(rb).includes(
        `('${f.fn}', '${f.assinatura}', '${f.antes}')`,
      ),
      `pos-voo do rollback ${f.fn}`,
    );
  }
  // A fotografia de atributos (OID, dono, ACL) viaja do pre-voo ao pos-voo, nos dois arquivos.
  assert.equal(vezes(codigo, "ikcous.freteida_atributos"), 2);
  assert.equal(vezes(semComentarios(rb), "ikcous.freteida_rb_atributos"), 2);
});

Deno.test("1658: a cadeia de posteriores e o kit de publicacao conhecem a migration", () => {
  const suc = ler("tests/banco/sucessoras-da-99.cjs");
  // A cadeia da 99 segue a ordem de arquivo, a mesma do CI, não a ordem
  // em que as migrations chegaram às lojas.
  const inicio = suc.indexOf("const NOMES = [");
  const ordem = [
    ...suc
      .slice(inicio, suc.indexOf("\n];", inicio))
      .matchAll(/^ {2}"(\d{14})_/gm),
  ].map((m) => m[1]);
  assert.ok(ordem.includes(nome.slice(0, 14)), "na lista de sucessoras");
  assert.deepEqual(
    ordem.slice(ordem.indexOf(nome.slice(0, 14)) + 1),
    ["20261659000000", "20261660000000", "20261662000000", "20261663000000"],
    "sucessoras da 99 posteriores à 1658, em ordem de arquivo",
  );
  assert.ok(suc.includes(`["${nome}", 2]`), "dois pares no pre-voo");
  const estoque = ler("tests/banco/estoque-do-painel-portao-viva.cjs");
  assert.ok(estoque.includes(`"${nome}"`));
  const oito = ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs");
  assert.ok(oito.includes(`"${nome}"`), "fora do rol da cadeia da 8e");
  assert.ok(
    ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(`('${ELE.fn}', '${ELE.depois}', '${nome.slice(0, 14)}')`),
    "a 8e aceita a elegibilidade desta como sucessora",
  );
  // O rollback da 5400 (e, por ele, o da 3992) desfaz esta antes.
  const post5400 = ler(
    "tests/banco/a-devolucao-integral-nao-perde-o-centavo-do-cupom-posterior.cjs",
  );
  assert.ok(
    post5400.includes("o-frete-de-ida-so-volta-com-reembolso-posterior.cjs"),
  );
  const modulo = ler(
    "tests/banco/o-frete-de-ida-so-volta-com-reembolso-posterior.cjs",
  );
  for (const f of [SOL, ELE])
    assert.ok(modulo.includes(f.antes) && modulo.includes(f.depois), f.fn);
  // As conferencias das antecessoras aceitam os corpos desta.
  const c144 = ler(
    "scripts/publicacao/consultas/144a-conferir-o-item-que-nao-veio-pode-ser-devolvido-de-novo-aplicado.sql",
  );
  assert.ok(
    c144.includes(`'${SOL.depois}'`) && c144.includes(`'${ELE.depois}'`),
  );
  const c157 = ler(
    "scripts/publicacao/consultas/157a-conferir-a-devolucao-integral-nao-perde-o-centavo-do-cupom-aplicado.sql",
  );
  assert.ok(c157.includes(`'${SOL.depois}'`));
  // As consultas 214a (depois) e 214b (antes) pinam os md5.
  const a = ler(
    "scripts/publicacao/consultas/214a-conferir-o-frete-de-ida-so-volta-com-reembolso-aplicado.sql",
  );
  const b = ler(
    "scripts/publicacao/consultas/214b-antes-o-frete-de-ida-so-volta-com-reembolso-base-vigente.sql",
  );
  for (const f of [SOL, ELE]) {
    assert.ok(a.includes(`'${f.depois}'`) && !a.includes(`'${f.antes}'`));
    assert.ok(b.includes(`'${f.antes}'`) && !b.includes(`'${f.depois}'`));
  }
  // Kit de publicacao: db-apply, canais, menu do workflow, lista de rol fechado e o rpc-ci.
  assert.ok(ler("scripts/db-apply.cjs").includes(`"${nome}": [`));
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.find(
    (l: { consulta: string }) =>
      l.consulta ===
      "214a-conferir-o-frete-de-ida-so-volta-com-reembolso-aplicado",
  );
  assert.deepEqual(lote?.versoes, [nome.slice(0, 14)]);
  assert.equal(
    lote?.ausenciaConfirmadaPor,
    "214b-antes-o-frete-de-ida-so-volta-com-reembolso-base-vigente",
  );
  for (const arq of [
    ".github/workflows/conferir-banco-da-loja.yml",
    "scripts/frota/publicar-release.mjs",
    "scripts/publicacao/conferir-banco.cjs",
  ]) {
    const t = ler(arq);
    assert.ok(
      t.includes(
        "214a-conferir-o-frete-de-ida-so-volta-com-reembolso-aplicado",
      ),
      arq,
    );
    assert.ok(
      t.includes(
        "214b-antes-o-frete-de-ida-so-volta-com-reembolso-base-vigente",
      ),
      arq,
    );
  }
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes(
      "tests/banco/o-frete-de-ida-so-volta-com-reembolso-portao-viva.cjs",
    ),
  );
});
