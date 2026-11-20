// Prova offline: não deixa o contrato dos itens sair das duas projeções SQL.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const nome =
  "20261410000000_a_lista_do_painel_e_o_rastreio_levam_o_nome_antigo_da_opcao.sql";
const ler = (arquivo: string) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${arquivo}`, import.meta.url),
  ).replace(/\r/g, "");

function vigente(arquivoAnterior: string) {
  try {
    return ler(nome);
  } catch (erro) {
    if (!(erro instanceof Deno.errors.NotFound)) throw erro;
    return ler(arquivoAnterior);
  }
}

function definicao(sql: string, funcao: string) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${funcao}(`);
  assert.ok(inicio >= 0, `definição de ${funcao}`);
  const abre = /\n\s*AS (\$\w*\$)/.exec(sql.slice(inicio));
  assert.ok(abre, `delimitador de ${funcao}`);
  const inicioCorpo = inicio + abre.index + abre[0].length;
  const fim = sql.indexOf(`${abre[1]};`, inicioCorpo);
  assert.ok(fim >= 0, `fim de ${funcao}`);
  return {
    cabecalho: sql.slice(inicio, inicioCorpo),
    corpo: sql.slice(inicioCorpo, fim),
  };
}

const alvos = [
  {
    funcao: "get_admin_orders_paged",
    anterior:
      "20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql",
    md5: "b404a8397a6490c86fb192d85fd5b6c9",
  },
  {
    funcao: "get_orders_by_otp_v2",
    anterior:
      "20261342000000_o_rastreio_do_convidado_nao_devolve_a_nota_do_pedido.sql",
    md5: "02208ac9d2abe2e8b03790349d491ecb",
  },
];

for (const alvo of alvos) {
  Deno.test(`${alvo.funcao}: itens incluem só os dois campos históricos a mais`, () => {
    const antes = definicao(ler(alvo.anterior), alvo.funcao);
    const atual = definicao(vigente(alvo.anterior), alvo.funcao);
    const adicao =
      /^( +)'variacao_nome_na_compra', oi\.variacao_nome_na_compra,\n\1'variacao_valor_na_compra', oi\.variacao_valor_na_compra,\n/m;
    assert.match(atual.corpo, adicao, "faltam os rótulos históricos do item");
    assert.equal(atual.corpo.replace(adicao, ""), antes.corpo);
    assert.equal(atual.cabecalho, antes.cabecalho);
  });

  Deno.test(`${alvo.funcao}: rollback restaura a definição vigente byte a byte`, () => {
    const antes = definicao(ler(alvo.anterior), alvo.funcao);
    const rollback = definicao(ler(`rollback-manual-${nome}`), alvo.funcao);
    assert.deepEqual(rollback, antes);
    assert.equal(
      createHash("md5").update(rollback.corpo).digest("hex"),
      alvo.md5,
    );
  });
}
