"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, ROTULOS,
 * nomes de cenário); nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) da limpeza do cache de
 * cotações de frete: o gatilho shipping_quotes_cache_limpa_ao_gravar (AFTER
 * INSERT OR UPDATE ... FOR EACH STATEMENT, migration 20261166000000, nenhuma
 * migration posterior o redefine) chama public.limpar_cotacoes_fora_da_janela(),
 * que apaga de public.shipping_quotes_cache só o que passou de 2 horas — o mesmo
 * prazo que a leitura do calculate-shipping aceita (index.ts, `twoHoursAgo`).
 * Apagar a cotação VIVA faz cada carrinho voltar a gastar cota paga do token da
 * transportadora da lojista; não apagar a velha só faz a tabela crescer sem dono.
 *
 * Quem hoje chega perto: tests/shipping_quotes_cache_unique_test.ts só lê o TEXTO
 * do .sql, e cotacao-de-frete-de-outra-origem-ou-velha-nao-vira-preco-viva.cjs
 * DESLIGA o gatilho de propósito. Nenhum executa a limpeza.
 *
 * CENÁRIOS (cada um num SAVEPOINT desfeito; a tabela é esvaziada dentro da
 * transação desfeita; a semente é gravada com o gatilho calado):
 *   C1  o gatilho existe, está ligado (origin), é AFTER INSERT OR UPDATE, FOR
 *       EACH STATEMENT, sem DELETE/TRUNCATE, e chama a função certa
 *   C2  semeadas cotações de 3 h, 2 h 01 min, 1 h 59 min e 30 min, o upsert de
 *       uma chave nova (do jeito do edge: ON CONFLICT DO UPDATE) apaga SÓ a de
 *       3 h e a de 2 h 01 min; ficam 1 h 59 min, 30 min e a nova, intactas
 *   C3  um UPDATE numa linha viva e um upsert que cai no conflito de uma chave
 *       viva NÃO apagam a viva (nem as outras vivas), e varrem a velha que
 *       entrou entre uma gravação e outra
 *   C4  segunda execução: outro upsert não muda nada no que já sobrou
 *   C5  CONTROLE: com o gatilho calado o upsert deixa as velhas onde estão
 *
 * NOTA: a tabela tem OUTRO gatilho de limpeza mais velho (baseline
 * trigger_clean_expired_shipping_quotes: AFTER INSERT, janela de 24 h). Ele não
 * mascara nada aqui: todas as idades semeadas são menores que 24 h, então só a
 * função de 2 h pode apagá-las. Por isso C1 olha o gatilho pelo NOME, não pela
 * contagem.
 *
 * NÃO coberto aqui: a chave única da tabela e o upsert do edge ->
 * shipping_quotes_cache_unique_test.ts; que a leitura recuse a velha ->
 * cotacao-de-frete-de-outra-origem-ou-velha-nao-vira-preco-viva.cjs. A fronteira
 * exata (2 h 00 min 00 s) não é afirmada: a leitura usa `>` e a limpeza `<`, então
 * a linha exatamente na fronteira é inofensiva nos dois sentidos; as bordas
 * pinadas são 1 min para cada lado.
 *
 * "Gatilho calado" = session_replication_role=replica, que NÃO mexe em
 * pg_trigger.tgenabled (o mutante "gatilho-desligado" segue visível em C1 e C2).
 *
 * MUTANTES: MUTANTE_R122C=<nome> troca UM trecho do corpo vivo da função (ou o
 * gatilho) dentro da transação desfeita e roda os cenários; a execução TEM de
 * ficar vermelha, no cenário que o nome promete. Nome desconhecido é ERRO.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-limpeza-do-cache-de-cotacao-so-apaga-o-velho-viva.cjs
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: a limpeza do cache de cotação só apaga o que passou de 2 h (rpc-ci)";
const FN = "public.limpar_cotacoes_fora_da_janela()";
const TABELA = "public.shipping_quotes_cache";
const GATILHO = "shipping_quotes_cache_limpa_ao_gravar";
const DELETE_VIVO =
  "DELETE FROM public.shipping_quotes_cache WHERE created_at < now() - interval '2 hours';";

// ---------------------------------------------------------------- mutantes
// `de`/`para` são trechos EXATOS do corpo vivo (cada `de` aparece 1x); `sql`
// roda direto. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const MUTANTES = {
  "comparador-invertido": {
    espera: ["C2"],
    de: "created_at < now()",
    para: "created_at > now()",
  },
  "delete-sem-where-de-data": {
    espera: ["C2"],
    de: DELETE_VIVO,
    para: "DELETE FROM public.shipping_quotes_cache;",
  },
  "janela-de-vinte-minutos": {
    espera: ["C2"],
    de: "interval '2 hours'",
    para: "interval '20 minutes'",
  },
  "janela-de-um-dia": {
    espera: ["C2"],
    de: "interval '2 hours'",
    para: "interval '24 hours'",
  },
  "gatilho-removido": {
    espera: ["C1", "C2"],
    sql: `DROP TRIGGER ${GATILHO} ON ${TABELA}`,
  },
  "gatilho-desligado": {
    espera: ["C1", "C2"],
    sql: `ALTER TABLE ${TABELA} DISABLE TRIGGER ${GATILHO}`,
  },
  "gatilho-so-no-insert": {
    espera: ["C1", "C3"],
    sql: `DROP TRIGGER ${GATILHO} ON ${TABELA}; CREATE TRIGGER ${GATILHO} AFTER INSERT ON ${TABELA} FOR EACH STATEMENT EXECUTE FUNCTION public.limpar_cotacoes_fora_da_janela()`,
  },
};

// ------------------------------------------------------------------ semente
// O rótulo vai no destination_cep (parte da chave única; texto livre).
const ANTIGAS = [
  ["r122c-3h", "3 hours"],
  ["r122c-2h01", "2 hours 1 minute"],
  ["r122c-1h59", "1 hour 59 minutes"],
  ["r122c-30min", "30 minutes"],
];
const SOBRAM = ["r122c-1h59", "r122c-30min"];

async function calar(c) {
  await c.query("SET LOCAL session_replication_role = replica");
}
async function religar(c) {
  await c.query("SET LOCAL session_replication_role = origin");
}

async function semearLinha(c, rotulo, idade) {
  await c.query(
    `INSERT INTO ${TABELA} (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ('01001000', $1, 'hash-r122c', '[]'::jsonb, now() - $2::interval)`,
    [rotulo, idade],
  );
}

async function semear(c) {
  // Esvazia dentro da transação desfeita (a tabela pode trazer linhas de outra prova).
  await c.query(`DELETE FROM ${TABELA}`);
  await calar(c);
  for (const [rotulo, idade] of ANTIGAS) await semearLinha(c, rotulo, idade);
  await religar(c);
}

/** Gravação do jeito do edge: upsert pela chave única (origem, destino, carrinho). */
async function gravar(c, rotulo) {
  await c.query(
    `INSERT INTO ${TABELA} (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ('01001000', $1, 'hash-r122c', '["gravado"]'::jsonb, now())
     ON CONFLICT (origin_cep, destination_cep, cart_hash)
     DO UPDATE SET options = EXCLUDED.options, created_at = EXCLUDED.created_at`,
    [rotulo],
  );
}

const estado = async (c) =>
  (
    await c.query(
      `SELECT destination_cep AS rotulo, id::text AS id, options::text AS options,
              created_at::text AS created_at
         FROM ${TABELA} ORDER BY destination_cep`,
    )
  ).rows;
const rotulos = (linhas) => linhas.map((l) => l.rotulo).sort();

// ---------------------------------------------------------------- cenários
const CENARIOS = [];

CENARIOS.push({
  id: "C1",
  nome: "C1: o gatilho existe, está ligado, é AFTER INSERT OR UPDATE FOR EACH STATEMENT sem DELETE/TRUNCATE e chama a função certa",
  corpo: async (c) => {
    const { rows } = await c.query(
      `SELECT t.tgname, t.tgenabled,
              (t.tgtype & 1) = 1 AS por_linha,
              (t.tgtype & 2) = 2 AS antes,
              (t.tgtype & 4) = 4 AS insere,
              (t.tgtype & 8) = 8 AS apaga,
              (t.tgtype & 16) = 16 AS atualiza,
              (t.tgtype & 32) = 32 AS trunca,
              (SELECT p.pronamespace::regnamespace::text || '.' || p.proname FROM pg_proc p WHERE p.oid = t.tgfoid) AS funcao
         FROM pg_trigger t
        WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal AND t.tgname = $2`,
      [TABELA, GATILHO],
    );
    assert.equal(
      rows.length,
      1,
      `[C1] o gatilho ${GATILHO} deve existir, uma vez (achei ${rows.length})`,
    );
    assert.deepEqual(rows[0], {
      tgname: GATILHO,
      tgenabled: "O",
      por_linha: false,
      antes: false,
      insere: true,
      apaga: false,
      atualiza: true,
      trunca: false,
      funcao: "public.limpar_cotacoes_fora_da_janela",
    });
  },
});

CENARIOS.push({
  id: "C2",
  nome: "C2: o upsert de chave nova apaga só o que passou de 2 h; 1 h 59 min, 30 min e a nova ficam intactas",
  corpo: async (c) => {
    const antes = await estado(c);
    assert.equal(antes.length, 4, "[C2] a semente tem 4 cotações");
    await gravar(c, "r122c-nova");
    const depois = await estado(c);
    assert.deepEqual(
      rotulos(depois),
      [...SOBRAM, "r122c-nova"].sort(),
      "[C2] devem sobrar exatamente 1 h 59 min, 30 min e a nova (3 h e 2 h 01 min somem)",
    );
    for (const l of depois.filter((x) => SOBRAM.includes(x.rotulo))) {
      assert.deepEqual(
        l,
        antes.find((a) => a.rotulo === l.rotulo),
        `[C2] a cotação viva ${l.rotulo} foi alterada`,
      );
    }
    assert.equal(
      depois.find((l) => l.rotulo === "r122c-nova").options,
      '["gravado"]',
      "[C2] a cotação recém-gravada tem de ser a que o upsert escreveu",
    );
  },
});

CENARIOS.push({
  id: "C3",
  nome: "C3: UPDATE em linha viva e upsert no conflito de chave viva não apagam a viva; varrem a velha que entrou no meio",
  corpo: async (c) => {
    // Uma velha nova entra (gatilho calado) e um UPDATE numa viva a varre.
    await calar(c);
    await semearLinha(c, "r122c-3h-b", "3 hours");
    await religar(c);
    await c.query(
      `UPDATE ${TABELA} SET options = '["atualizado"]'::jsonb WHERE destination_cep = 'r122c-30min'`,
    );
    let depois = await estado(c);
    assert.deepEqual(
      rotulos(depois),
      ["r122c-1h59", "r122c-30min"],
      "[C3] o UPDATE deveria varrer as velhas (3 h, 2 h 01 min, 3 h-b) e deixar as duas vivas",
    );
    assert.equal(
      depois.find((l) => l.rotulo === "r122c-30min").options,
      '["atualizado"]',
      "[C3] a viva atualizada tem de continuar com o que o UPDATE escreveu",
    );

    // Outra velha entra; o upsert que cai no CONFLITO de uma viva a varre sem apagar a viva.
    await calar(c);
    await semearLinha(c, "r122c-3h-c", "3 hours");
    await religar(c);
    await gravar(c, "r122c-30min");
    depois = await estado(c);
    assert.deepEqual(
      rotulos(depois),
      ["r122c-1h59", "r122c-30min"],
      "[C3] o upsert no conflito tem de deixar as duas vivas e varrer a velha",
    );
    assert.equal(
      depois.find((l) => l.rotulo === "r122c-30min").options,
      '["gravado"]',
      "[C3] a viva que recebeu o upsert tem de existir com o valor gravado",
    );
  },
});

CENARIOS.push({
  id: "C4",
  nome: "C4: a segunda execução não muda nada no que já sobrou",
  corpo: async (c) => {
    await gravar(c, "r122c-nova");
    const primeira = await estado(c);
    await gravar(c, "r122c-nova-2");
    const segunda = await estado(c);
    assert.deepEqual(
      segunda.filter((l) => l.rotulo !== "r122c-nova-2"),
      primeira,
      "[C4] o segundo upsert mexeu no que a primeira limpeza deixou",
    );
    assert.deepEqual(
      rotulos(segunda),
      [...SOBRAM, "r122c-nova", "r122c-nova-2"].sort(),
      "[C4] conjunto final",
    );
  },
});

CENARIOS.push({
  id: "C5",
  nome: "C5: controle — com o gatilho calado o upsert deixa as quatro velhas onde estão",
  corpo: async (c) => {
    await calar(c);
    await gravar(c, "r122c-nova");
    await religar(c);
    assert.deepEqual(
      rotulos(await estado(c)),
      [...ANTIGAS.map(([r]) => r), "r122c-nova"].sort(),
      "[C5] sem gatilho nada deveria sumir: a limpeza do C2 é mesmo do gatilho",
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R122C='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  if (m.sql) {
    await c.query(m.sql);
    return m;
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  const ocorrencias = def.split(m.de).length - 1;
  assert.equal(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.equal(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), semente, e cada cenário num
 * SAVEPOINT. Erro que não é de asserção (SQL, conexão) sobe: é do teste.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await semear(c);
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
  const nomeMutante = process.env.MUTANTE_R122C || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R122C='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
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
        "A limpeza do cache de cotação não é a prometida (some só o que passou de 2 h) — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[cache-de-cotacao] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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
