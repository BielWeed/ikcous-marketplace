// @ts-nocheck
// VERIFICACOES DO LOTE 2026116x — as entradas que faltavam (fila do bastão
// 19/09, item 4, parte B.3).
//
// O DEFEITO QUE ESTE TESTE FIXA: as quatro migrations do lote do código de
// barras/PDV (20261160..20261163) vieram de C1 SEM entrada em VERIFICACOES —
// medida em 20/09, só a 20261164 tinha. Migration sem entrada é checagem
// pulada no db-apply ("pulada, nenhuma verificação registrada"): qualquer
// regressão silenciosa no corpo vivo dessas funções passa batida. Cada
// entrada acrescentada é provada por SABOTAGEM aqui: contra um corpo SEM o
// marcador, a entrada tem de FALHAR — entrada que nunca reprova é pior que
// entrada ausente.
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");

// [nome da migration, corpo COM o marcador (verificada), corpo SEM o
// marcador (a sabotagem — tem de falhar)]
const CASOS = [
  {
    nome: "20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql",
    com: "SELECT p.id, p.nome, p.codigo_barras FROM produtos p",
    sem: "SELECT p.id, p.nome FROM produtos p",
  },
  {
    nome: "20261161000000_o_balcao_acha_o_produto_pelo_codigo.sql",
    com: "jsonb_build_object('origem', v_origem, 'codigo', p_codigo)",
    sem: "jsonb_build_object('codigo', p_codigo)",
  },
  {
    nome: "20261162000000_a_venda_no_balcao_nasce_inteira.sql",
    com: "jsonb_build_object('ja_existia', v_ja_existia, 'order', to_jsonb(o.*))",
    sem: "jsonb_build_object('order', to_jsonb(o.*))",
  },
  {
    nome: "20261163000000_a_lista_de_pedidos_filtra_por_canal.sql",
    // As TRÊS ocorrências medidas no corpo vivo (contagem, dados e total).
    com: [
      "WHERE true",
      "AND (p_canal = 'all' OR o.canal = p_canal)",
      "AND (p_canal = 'all' OR o.canal = p_canal)",
      "AND (p_canal = 'all' OR o.canal = p_canal)",
    ].join(" "),
    sem: "WHERE true",
  },
];

for (const caso of CASOS) {
  Deno.test(`${caso.nome}: entrada existe e aponta a função certa`, () => {
    const entrada = VERIFICACOES[caso.nome];
    assert(entrada !== undefined, "sem entrada em VERIFICACOES");
    assert(entrada.length >= 1);
    assert(
      typeof entrada[0].funcao === "string" && entrada[0].funcao.length > 0,
    );
  });

  Deno.test(`${caso.nome}: SABOTAGEM — corpo sem o marcador reprova`, () => {
    const checagem = VERIFICACOES[caso.nome][0];
    const resultado = avaliarChecagem(caso.sem, checagem);
    assertEquals(
      resultado.situacao,
      "falhou",
      "entrada que não reprova contra o corpo sem a mudança é pior que ausente",
    );
  });

  Deno.test(`${caso.nome}: corpo com o marcador verifica`, () => {
    const checagem = VERIFICACOES[caso.nome][0];
    const resultado = avaliarChecagem(caso.com, checagem);
    assertEquals(resultado.situacao, "verificada");
  });
}
