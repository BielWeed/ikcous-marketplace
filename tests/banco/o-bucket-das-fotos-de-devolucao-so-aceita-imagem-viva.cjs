"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário); nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) da configuração do bucket
 * `devolucoes` (as fotos que a cliente anexa ao pedir devolução: dado de
 * cliente), contra o Postgres EFÊMERO com as migrations aplicadas do zero
 * (rpc-ci).
 *
 * POR QUE: a linha do bucket é a ÚNICA barreira de TIPO e de TAMANHO no
 * servidor. A policy de INSERT em storage.objects só confere a pasta (a conta
 * dona) e o teto de 30 fotos; quem recusa SVG/HTML/PDF e arquivo gigante é o
 * serviço de storage, lendo `allowed_mime_types` e `file_size_limit` desta
 * linha. O front só recusa tipo na tela. Se alguém trocar a linha (migration
 * futura, ON CONFLICT DO UPDATE, ajuste no painel), nenhum outro teste vê.
 *
 * Estado vivo conferido: só a 20261175000000_a_devolucao_nasce_no_pedido.sql
 * mexe em storage.buckets para `devolucoes` (INSERT ... ON CONFLICT DO
 * NOTHING); nenhuma migration posterior altera a linha.
 *
 * CENÁRIOS (valores exatos; leitura de SELECT, nada é escrito):
 *   B0  CONTROLE: existe UMA linha `devolucoes` (id = name)
 *   B1  public = false (privado: foto de cliente nunca por URL pública)
 *   B2  file_size_limit = 5242880 (5 MB)
 *   B3  allowed_mime_types = exatamente {image/jpeg, image/png, image/webp},
 *       comparado como conjunto ordenado (NULL = qualquer tipo -> vermelho)
 *
 * NÃO coberto (de propósito): "subir um SVG como `authenticated` e ver recusa".
 * O Postgres NÃO checa mimetype: quem checa é a API de storage, que não existe
 * neste banco efêmero. O que o banco garante, e o que esta prova afirma, é a
 * linha do bucket que a API de storage consulta. Pasta e teto de 30 fotos:
 * fotos-da-devolucao-portao-viva.cjs e a-foto-da-devolucao-e-a-pergunta-tem-teto-viva.cjs.
 *
 * MUTANTES: MUTANTE_R125C=<nome> faz UM UPDATE na linha do bucket (dentro da
 * transação desfeita) e roda os cenários; a execução TEM de ficar vermelha, e
 * vermelha no cenário que o nome promete, com os controles verdes. Nome
 * desconhecido é ERRO. Sem MUTANTE_R125C a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-bucket-das-fotos-de-devolucao-so-aceita-imagem-viva.cjs
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o bucket das fotos de devolução só aceita imagem, 5 MB e é privado (rpc-ci)";
const BUCKET = "devolucoes";
const TETO_BYTES = 5242880;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

// ---------------------------------------------------------------- mutantes
// `sql` é um UPDATE da linha do bucket; roda dentro da transação desfeita.
// `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const MUTANTES = {
  "mime-alargado": {
    espera: ["B3"],
    sql: "UPDATE storage.buckets SET allowed_mime_types = allowed_mime_types || ARRAY['image/svg+xml'] WHERE id = 'devolucoes'",
  },
  "mime-nulo": {
    espera: ["B3"],
    sql: "UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'devolucoes'",
  },
  "bucket-publico": {
    espera: ["B1"],
    sql: "UPDATE storage.buckets SET public = true WHERE id = 'devolucoes'",
  },
  "teto-maior": {
    espera: ["B2"],
    sql: "UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'devolucoes'",
  },
};

// ---------------------------------------------------------------- cenários
async function linhaDoBucket(c) {
  const { rows } = await c.query(
    `SELECT id, name, public, file_size_limit::text AS file_size_limit, allowed_mime_types
       FROM storage.buckets WHERE id = $1`,
    [BUCKET],
  );
  return rows;
}

const CENARIOS = [];

CENARIOS.push({
  id: "B0",
  nome: "B0: controle — existe uma linha só do bucket `devolucoes` (id = name)",
  corpo: async (c) => {
    const rows = await linhaDoBucket(c);
    assert.equal(
      rows.length,
      1,
      `[B0] esperava 1 linha do bucket '${BUCKET}', achei ${rows.length}`,
    );
    assert.equal(rows[0].name, BUCKET, "[B0] name");
  },
});

CENARIOS.push({
  id: "B1",
  nome: "B1: o bucket é PRIVADO (public = false)",
  corpo: async (c) => {
    const [b] = await linhaDoBucket(c);
    assert.ok(b, "[B1] o bucket não existe");
    assert.equal(
      b.public,
      false,
      "[B1] o bucket das fotos de devolução está PÚBLICO: qualquer um lê a foto pela URL",
    );
  },
});

CENARIOS.push({
  id: "B2",
  nome: "B2: o teto por arquivo é exatamente 5242880 bytes (5 MB)",
  corpo: async (c) => {
    const [b] = await linhaDoBucket(c);
    assert.ok(b, "[B2] o bucket não existe");
    assert.equal(
      b.file_size_limit,
      String(TETO_BYTES),
      `[B2] file_size_limit (esperado ${TETO_BYTES})`,
    );
  },
});

CENARIOS.push({
  id: "B3",
  nome: "B3: só image/jpeg, image/png e image/webp (conjunto exato; NULL = qualquer tipo é recusado)",
  corpo: async (c) => {
    const [b] = await linhaDoBucket(c);
    assert.ok(b, "[B3] o bucket não existe");
    assert.ok(
      Array.isArray(b.allowed_mime_types),
      "[B3] allowed_mime_types é NULL: o bucket aceita QUALQUER tipo de arquivo",
    );
    assert.deepEqual(
      [...b.allowed_mime_types].sort(),
      [...TIPOS].sort(),
      "[B3] tipos aceitos (conjunto exato, ordenado)",
    );
  },
});

// ------------------------------------------------------------------ rodada
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R125C='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const r = await c.query(m.sql);
  assert.equal(
    r.rowCount,
    1,
    `mutante ${nome}: o UPDATE tinha de alterar exatamente 1 linha (alterou ${r.rowCount})`,
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante) e cada cenário num SAVEPOINT.
 * Erro que não é de asserção (SQL, conexão) sobe: é do teste, não do banco.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id: cid, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(cid);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id: cid, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) => `${e.message.split("\n")[0]}`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R125C || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R125C='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const cid of r.passou) console.log(`  PASSOU ${cid}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (cid) => !r.falhou.some((f) => f.id === cid),
      );
      const demais = r.falhou
        .map((f) => f.id)
        .filter((cid) => !r.mutante.espera.includes(cid));
      if (faltou.length > 0 || demais.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho em [${r.falhou.map((f) => f.id).join(", ")}] (esperado SO [${r.mutante.espera.join(", ")}]; faltou [${faltou.join(", ")}], a mais [${demais.join(", ")}])`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "O bucket das fotos de devolução saiu do combinado (privado, 5 MB, só JPG/PNG/WEBP) — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-bucket-das-fotos-de-devolucao] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
