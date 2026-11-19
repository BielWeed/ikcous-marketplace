import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Prova de TEXTO (sem banco) da 20261405400000: o corpo novo de solicitar_devolucao, o rollback byte a byte, a regra declarada e a ARITMÉTICA da regra
// (independente do Postgres). A prova viva, contra o Postgres, está em tests/banco/devolucoes-viva.cjs ("valor dos itens com cupom").
const nome =
  "20261405400000_a_devolucao_integral_nao_perde_o_centavo_do_cupom.sql";
const ORIGEM =
  "supabase/migrations/20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
const ANTES = "52e5c30c06f9767a97e98f3a393b8496";
const DEPOIS = "94ecd75ba32dd0a8ce7d433f4b6f7961";
const FN = "solicitar_devolucao";
const ASSINATURA =
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])";

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

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const origem = ler(ORIGEM);

// As três trocas declaradas no cabeçalho (item 3), como texto exato do corpo novo.
const DECLARACAO = [
  "  -- 20261405400000: o MESMO cupom como fração exata (numerador e denominador, nos mesmos limites de v_fator_desconto): o valor da LINHA",
  "  -- sai de uma conta só, arredondada uma vez, e não do preço de uma unidade arredondado e multiplicado depois.",
  "  v_cupom_num numeric := 1;",
  "  v_cupom_den numeric := 1;",
  "",
].join("\n");
const FRACAO =
  "    v_cupom_num := GREATEST(LEAST(v_o.subtotal - COALESCE(v_o.discount, 0), v_o.subtotal), 0);\n    v_cupom_den := v_o.subtotal;\n";
const CONTA_NOVA =
  "    v_valor := v_valor\n      + round(v_oi.price * v_cupom_num * (v_ja + v_qtd) / v_cupom_den, 2)\n      - round(v_oi.price * v_cupom_num * v_ja / v_cupom_den, 2);\n";
const CONTA_VELHA =
  "    v_valor := v_valor + round(v_qtd * v_valor_unit, 2);\n";

// Desfaz, a mão, só o que a migration declara: sobra o corpo vigente, byte a byte.
const inverso = (c: string) => {
  const sem = (texto: string, trecho: string) => {
    assert.equal(texto.split(trecho).length - 1, 1, `alvo único: ${trecho}`);
    return texto.replace(trecho, () => "");
  };
  let r = c;
  r = sem(r, DECLARACAO);
  r = sem(r, FRACAO);
  // A conta nova ocupa o lugar da velha (e traz o comentário de três linhas logo acima).
  const ini = r.indexOf("    -- 20261405400000: o valor desta devolução");
  assert.ok(ini > 0, "comentário da conta nova");
  const fim = r.indexOf(CONTA_NOVA) + CONTA_NOVA.length;
  assert.ok(fim > ini, "conta nova depois do comentário");
  return r.slice(0, ini) + CONTA_VELHA + r.slice(fim);
};

Deno.test("5400: o corpo anterior e' o vigente (3992); o novo e' o pinado; o rollback devolve o vigente byte a byte", () => {
  assert.equal(md5(corpo(origem, FN)), ANTES, "vigente (3992)");
  assert.equal(md5(corpo(sql, FN)), DEPOIS, "desta");
  assert.equal(md5(corpo(rb, FN)), ANTES, "rollback");
  assert.equal(definicao(rb, FN), definicao(origem, FN), "rollback inteiro");
  // Cabeçalho (assinatura, SECURITY DEFINER, search_path, retorno) igual ao vigente.
  assert.equal(
    definicao(sql, FN).split(DELIM)[0],
    definicao(origem, FN).split(DELIM)[0],
    "cabecalho",
  );
  // Desfeita a troca declarada, sobra o vigente, byte a byte.
  assert.equal(inverso(corpo(sql, FN)), corpo(origem, FN), "inverso");
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("5400: a regra nova esta onde deve e so ela; o que protege dinheiro continua", () => {
  const s = corpo(sql, FN);
  // A conta nova uma vez, a antiga nenhuma; a fração entra pelo mesmo IF do fator.
  assert.equal(s.split(CONTA_NOVA).length - 1, 1);
  assert.equal(s.split("round(v_qtd * v_valor_unit, 2)").length - 1, 0);
  assert.equal(s.split(FRACAO).length - 1, 1);
  const iIf = s.indexOf("IF v_o.subtotal > 0 THEN");
  assert.ok(iIf > 0 && s.indexOf(FRACAO) > iIf);
  assert.ok(s.indexOf(FRACAO) < s.indexOf("END IF;", iIf));
  // v_ja (a quantidade que as OUTRAS devoluções que valem já levaram) é calculado ANTES da conta, no mesmo laço.
  assert.ok(s.indexOf("INTO v_ja") > 0);
  assert.ok(s.indexOf("INTO v_ja") < s.indexOf(CONTA_NOVA));
  assert.ok(s.indexOf("IF v_qtd IS NULL") < s.indexOf(CONTA_NOVA));
  // O snapshot por unidade que o resto do sistema lê NÃO muda (nem a conta que o produz).
  assert.equal(
    s.split("v_valor_unit := round(v_oi.price * v_fator_desconto, 2);").length -
      1,
    1,
  );
  assert.ok(
    s.includes("v_valor_unit\n    );"),
    "o INSERT do item grava v_valor_unit",
  );
  // Trava de arredondamento, frete de ida e regra do item "Não veio" (3992) ficam como estavam.
  assert.ok(
    s.includes(
      "v_valor := LEAST(v_valor, GREATEST(round(v_o.subtotal - COALESCE(v_o.discount, 0), 2), 0));",
    ),
  );
  assert.equal(
    s.split("AND di.condicao IS DISTINCT FROM 'ausente'").length - 1,
    2,
  );
  assert.ok(s.includes("v_frete := COALESCE(v_o.shipping, 0);"));
  assert.ok(s.includes("IF v_total_coberto >= v_total_pedido THEN"));
  assert.ok(
    s.includes("d.status NOT IN ('recusada', 'cancelada', 'reprovada')"),
  );
  // Nenhuma outra variável de rateio foi criada além das duas declaradas.
  assert.equal(s.split("v_cupom_num").length - 1, 4);
  assert.equal(s.split("v_cupom_den").length - 1, 4);
});

Deno.test("5400: a funcao que devolve o dinheiro nao e' tocada; a migration e' aditiva, sem BEGIN/COMMIT e com pre/pos-voo", () => {
  const codigo = semComentarios(sql);
  for (const fn of [
    "admin_devolucao_concluir",
    "admin_devolucao_reemitir_reembolso",
    "pedido__saldo_a_estornar",
    "devolucao_elegibilidade",
    "devolucao_detalhe",
    "solicitar_estorno",
    "registrar_estorno_manual",
  ])
    assert.ok(!codigo.includes(`FUNCTION public.${fn}(`), fn);
  // Regra da casa (AGENTS.md): sem transacao de nivel superior; quem abre e' o aplicador.
  assert.doesNotMatch(codigo, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  assert.doesNotMatch(semComentarios(rb), /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  // Aditiva: nenhuma tabela, coluna, dado, politica nem ACL muda (fora do corpo da funcao e dos blocos DO).
  assert.doesNotMatch(
    semComentarios(sql.replace(definicao(sql, FN), ""))
      .replace(/\$preflight_[a-z_0-9]*\$[\s\S]*?\$preflight_[a-z_0-9]*\$/g, "")
      .replace(/\$posvoo_[a-z_0-9]*\$[\s\S]*?\$posvoo_[a-z_0-9]*\$/g, ""),
    /\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|GRANT|REVOKE|CREATE TABLE|CREATE POLICY)\b/i,
  );
  assert.doesNotMatch(
    semComentarios(rb),
    /\b(?:GRANT|REVOKE|DROP|DELETE|TRUNCATE)\b/i,
  );
  assert.ok(codigo.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(codigo.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(codigo.includes("POSVOO_20261405400000"));
  assert.ok(semComentarios(rb).includes("B1_BASELINE_DIVERGENT"));
  assert.ok(semComentarios(rb).includes("POSVOO_ROLLBACK_20261405400000"));
  // O pre-voo aceita o vigente OU o desta (reaplicar nao falha), no formato que tests/banco/sucessoras-da-99.cjs le;
  // o rollback exige o desta e o pos-voo dele o vigente.
  const linha = sql
    .split("\n")
    .find((l) => l.includes(`('${FN}', '${ASSINATURA}'`));
  assert.ok(linha?.includes(`'${ANTES}', '${DEPOIS}')`), "pre-voo");
  const linhaRb = rb
    .split("\n")
    .find((l) => l.includes(`('${FN}', '${ASSINATURA}'`));
  assert.ok(linhaRb?.includes(`'${DEPOIS}')`), "rollback");
  assert.ok(semComentarios(rb).includes(`'${ANTES}'`), "pos-voo do rollback");
  assert.ok(codigo.includes(`IS DISTINCT FROM '${DEPOIS}'`), "pos-voo");
  // A fotografia de atributos (OID, dono, ACL) viaja do pre-voo ao pos-voo, nos dois arquivos.
  assert.ok(codigo.includes("ikcous.devcupom_atributos"));
  assert.ok(semComentarios(rb).includes("ikcous.devcupom_rb_atributos"));
  // Vem depois da migration de origem e da ultima do repositorio.
  assert.ok(nome.slice(0, 14) > ORIGEM.split("/").pop()!.slice(0, 14));
  assert.ok(nome.slice(0, 14) > "20261404000000");
});

Deno.test("5400: a cadeia de posteriores conhece a migration (lista das sucessoras, rol do 8e, rollback da 3992)", () => {
  const suc = ler("tests/banco/sucessoras-da-99.cjs");
  assert.ok(suc.includes(`"${nome}"`), "lista de sucessoras");
  const estoque = ler("tests/banco/estoque-do-painel-portao-viva.cjs");
  assert.ok(estoque.includes(`"${nome}"`) && estoque.includes(ASSINATURA));
  const oito = ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs");
  assert.ok(
    oito.includes(`"${nome}"`),
    "fora do rol da 8e (nao e funcao dela)",
  );
  const post = ler("tests/banco/o-item-que-nao-veio-posterior.cjs");
  assert.ok(
    post.includes(
      "a-devolucao-integral-nao-perde-o-centavo-do-cupom-posterior.cjs",
    ),
    "o rollback da 3992 desfaz esta antes",
  );
  const modulo = ler(
    "tests/banco/a-devolucao-integral-nao-perde-o-centavo-do-cupom-posterior.cjs",
  );
  assert.ok(modulo.includes(ANTES) && modulo.includes(DEPOIS));
  // A 8e nao pina solicitar_devolucao: nada a mudar nas consultas de publicacao do portao.
  assert.ok(
    !ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes("('solicitar_devolucao'"),
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// A ARITMÉTICA da regra, em centavos inteiros (BigInt), sem Postgres. O round() do numeric arredonda o meio para cima (longe do zero).
// ---------------------------------------------------------------------------------------------------------------------
const meioParaCima = (a: bigint, b: bigint) => (2n * a + b) / (2n * b); // a/b, a >= 0
// preço, subtotal e desconto em CENTAVOS; n = unidades acumuladas da linha. Fração do cupom: (subtotal - desconto) preso a [0, subtotal] / subtotal.
const acumulado = (
  preco: bigint,
  subtotal: bigint,
  desconto: bigint,
  n: number,
) => {
  if (subtotal <= 0n) return preco * BigInt(n);
  const num =
    subtotal - desconto < 0n
      ? 0n
      : subtotal - desconto > subtotal
        ? subtotal
        : subtotal - desconto;
  return meioParaCima(preco * num * BigInt(n), subtotal);
};
const parte = (p: bigint, s: bigint, d: bigint, antes: number, agora: number) =>
  acumulado(p, s, d, antes + agora) - acumulado(p, s, d, antes);
// O corpo ANTIGO: o preço de uma unidade arredondado, vezes a quantidade.
const antigo = (p: bigint, s: bigint, d: bigint, q: number) =>
  BigInt(q) * (s <= 0n ? p : meioParaCima(p * (s - d), s));

Deno.test("5400: aritmetica - o caso do defeito (3 x 50,00, cupom de 2,00) fecha em 148,00 e o corpo antigo dava 147,99", () => {
  const p = 5000n;
  const s = 15000n;
  const d = 200n;
  assert.deepEqual(
    [1, 2, 3].map((n) => parte(p, s, d, 0, n)),
    [4933n, 9867n, 14800n],
  );
  assert.deepEqual(
    [1, 2, 3].map((n) => antigo(p, s, d, n)),
    [4933n, 9866n, 14799n],
    "o defeito: a integral ficava 1 centavo abaixo do pago",
  );
  // Três devoluções de 1 unidade, uma depois da outra.
  assert.deepEqual(
    [0, 1, 2].map((antes) => parte(p, s, d, antes, 1)),
    [4933n, 4934n, 4933n],
  );
  // Sete unidades de 10,01 com cupom de 3,33 em 2 + 3 + 2: soma = 70,07 - 3,33.
  assert.equal(
    parte(1001n, 7007n, 333n, 0, 2) +
      parte(1001n, 7007n, 333n, 2, 3) +
      parte(1001n, 7007n, 333n, 5, 2),
    6674n,
  );
});

Deno.test("5400: aritmetica - sem cupom e' preco x quantidade; qualquer divisao em partes soma o total da linha (20 mil casos)", () => {
  // Gerador determinístico (xorshift32): o teste não pode ser sorte.
  let x = 0x2d3f9a1b;
  const sorteio = (n: number) => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x % n;
  };
  for (let i = 0; i < 20000; i += 1) {
    const q = 1 + sorteio(12);
    const preco = BigInt(1 + sorteio(30000)); // de R$ 0,01 a R$ 300,00
    const subtotal = preco * BigInt(q) + BigInt(sorteio(5000)); // o subtotal pode ter mais linhas além desta
    const desconto = BigInt(sorteio(Number(subtotal) + 1));
    // Uma divisão aleatória da linha em devoluções sucessivas.
    let antes = 0;
    let soma = 0n;
    while (antes < q) {
      const agora = 1 + sorteio(q - antes);
      const v = parte(preco, subtotal, desconto, antes, agora);
      assert.ok(v >= 0n, "parte nunca negativa");
      soma += v;
      antes += agora;
    }
    assert.equal(
      soma,
      acumulado(preco, subtotal, desconto, q),
      "soma das partes = total da linha",
    );
    // A linha inteira de uma vez dá o mesmo total (juntas ou em partes, o mesmo dinheiro).
    assert.equal(parte(preco, subtotal, desconto, 0, q), soma);
    // O total da linha nunca passa do preço cheio nem fica abaixo de zero.
    assert.ok(soma >= 0n && soma <= preco * BigInt(q));
    // Sem cupom: preço x quantidade, em qualquer parte.
    assert.equal(parte(preco, subtotal, 0n, 0, q), preco * BigInt(q));
    const agora = 1 + sorteio(q);
    assert.equal(
      parte(preco, subtotal, 0n, q - agora, agora),
      preco * BigInt(agora),
    );
  }
});

Deno.test("5400: aritmetica - o limite do cupom: desconto maior que o subtotal zera, subtotal 0 nao rateia", () => {
  assert.equal(
    parte(5000n, 15000n, 99999n, 0, 3),
    0n,
    "desconto acima do subtotal: fração 0",
  );
  assert.equal(
    parte(5000n, 15000n, -500n, 0, 3),
    15000n,
    "desconto negativo nunca amplia o preço: fração 1",
  );
  assert.equal(
    parte(5000n, 0n, 100n, 0, 3),
    15000n,
    "subtotal 0 (dado legado): sem rateio",
  );
});
