"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, ROTULOS,
 * nomes de cenário); nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) da retenção de 30 dias do
 * histórico de cotações de frete: o gatilho trigger_clean_old_shipping_logs
 * (AFTER INSERT ... FOR EACH STATEMENT) chama public.clean_old_shipping_logs(),
 * que apaga de public.shipping_calculation_logs só o que tem mais de 30 dias
 * (corpo vivo = baseline 20260806000000:277-289 e :5032; nenhuma migration
 * posterior o redefine). Esse histórico (CEPs, itens do carrinho, erro) é a
 * ÚNICA janela da lojista para entender por que o frete falhou: janela curta ou
 * invertida a deixa cega; gatilho solto ou janela longa guarda CEP e carrinho de
 * cliente sem limite.
 *
 * CENÁRIOS (valores exatos; cada um num SAVEPOINT desfeito; a tabela é
 * esvaziada dentro da transação desfeita, então o que sobrou de outra prova no
 * mesmo banco não entra):
 *   L1  o gatilho existe, está ligado (origin), é AFTER INSERT, FOR EACH
 *       STATEMENT, só INSERT, é o ÚNICO gatilho de usuário da tabela e chama a
 *       função certa
 *   L2  semeadas (gatilho calado só para semear) linhas de 31 d, 30 d + 1 h,
 *       29 d + 23 h, 29 d e 1 h, um INSERT novo apaga SÓ as duas que passaram de
 *       30 d: sobram 29 d + 23 h, 29 d, 1 h e a nova, intactas (mesmo id, mesmo
 *       created_at)
 *   L3  segunda execução (outro INSERT) não muda nada no que já sobrou
 *   L4  CONTROLE: com o gatilho calado, o INSERT novo deixa as cinco antigas
 *       onde estão (a limpeza é do gatilho, não de outra coisa) e a semente
 *       não envelhece sozinha
 *
 * NÃO coberto aqui: a política de admin da tabela -> admin-atual-endurecimento-viva.cjs.
 * A fronteira exata (30 d no segundo) não é afirmada: as bordas pinadas são
 * 1 h para cada lado dos 30 d, que é o que separa "30 dias" de "29" e de "31".
 *
 * "Gatilho calado" = session_replication_role=replica, que NÃO mexe no estado do
 * gatilho (pg_trigger.tgenabled), para o mutante "gatilho-desligado" continuar
 * visível em L1 e L2.
 *
 * MUTANTES: MUTANTE_R122C=<nome> troca UM trecho do corpo vivo da função (ou o
 * gatilho) dentro da transação desfeita e roda os cenários; a execução TEM de
 * ficar vermelha, no cenário que o nome promete. Nome desconhecido é ERRO.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-limpeza-dos-logs-de-frete-guarda-30-dias-viva.cjs
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o histórico de frete guarda 30 dias e só apaga o que passou (rpc-ci)";
const FN = "public.clean_old_shipping_logs()";
const TABELA = "public.shipping_calculation_logs";
const GATILHO = "trigger_clean_old_shipping_logs";

// ---------------------------------------------------------------- mutantes
// `de`/`para` são trechos EXATOS do corpo vivo (cada `de` aparece 1x); `sql`
// roda direto. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const MUTANTES = {
  "janela-de-um-dia": {
    espera: ["L2"],
    de: "INTERVAL '30 days'",
    para: "INTERVAL '1 day'",
  },
  "janela-de-noventa-dias": {
    espera: ["L2"],
    de: "INTERVAL '30 days'",
    para: "INTERVAL '90 days'",
  },
  "sem-clausula-de-data": {
    espera: ["L2"],
    de: "WHERE created_at < NOW() - INTERVAL '30 days';",
    para: ";",
  },
  "comparador-invertido": {
    espera: ["L2"],
    de: "created_at < NOW()",
    para: "created_at > NOW()",
  },
  "gatilho-removido": {
    espera: ["L1", "L2"],
    sql: `DROP TRIGGER ${GATILHO} ON ${TABELA}`,
  },
  "gatilho-desligado": {
    espera: ["L1", "L2"],
    sql: `ALTER TABLE ${TABELA} DISABLE TRIGGER ${GATILHO}`,
  },
  "gatilho-por-linha": {
    espera: ["L1"],
    sql: `DROP TRIGGER ${GATILHO} ON ${TABELA}; CREATE TRIGGER ${GATILHO} AFTER INSERT ON ${TABELA} FOR EACH ROW EXECUTE FUNCTION public.clean_old_shipping_logs()`,
  },
};

// ------------------------------------------------------------------ semente
// Cada linha antiga leva o rótulo no campo provider (texto livre da tabela).
const ANTIGAS = [
  ["r122c-31d", "31 days"],
  ["r122c-30d-1h", "30 days 1 hour"],
  ["r122c-29d-23h", "29 days 23 hours"],
  ["r122c-29d", "29 days"],
  ["r122c-1h", "1 hour"],
];
const SOBRAM = ["r122c-29d-23h", "r122c-29d", "r122c-1h"];

async function calar(c) {
  await c.query("SET LOCAL session_replication_role = replica");
}
async function religar(c) {
  await c.query("SET LOCAL session_replication_role = origin");
}

async function semear(c) {
  // Esvazia dentro da transação desfeita: DELETE não dispara o gatilho de INSERT.
  await c.query(`DELETE FROM ${TABELA}`);
  await calar(c);
  for (const [rotulo, idade] of ANTIGAS) {
    await c.query(
      `INSERT INTO ${TABELA}
         (origin_cep, destination_cep, provider, cart_items, response_time_ms, status, created_at)
       VALUES ('01001000', '02002000', $1, '[]'::jsonb, 1, 'ok', now() - $2::interval)`,
      [rotulo, idade],
    );
  }
  await religar(c);
}

async function inserirNova(c, rotulo) {
  await c.query(
    `INSERT INTO ${TABELA}
       (origin_cep, destination_cep, provider, cart_items, response_time_ms, status)
     VALUES ('01001000', '02002000', $1, '[]'::jsonb, 1, 'ok')`,
    [rotulo],
  );
}

const estado = async (c) =>
  (
    await c.query(
      `SELECT provider, id::text AS id, created_at::text AS created_at
         FROM ${TABELA} ORDER BY provider`,
    )
  ).rows;
const rotulos = (linhas) => linhas.map((l) => l.provider);

// ---------------------------------------------------------------- cenários
const CENARIOS = [];

CENARIOS.push({
  id: "L1",
  nome: "L1: o gatilho existe, está ligado, é AFTER INSERT FOR EACH STATEMENT e é o único da tabela",
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
        WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal`,
      [TABELA],
    );
    assert.equal(
      rows.length,
      1,
      `[L1] a tabela deve ter UM gatilho de usuário (achei ${rows.map((r) => r.tgname).join(", ") || "nenhum"})`,
    );
    assert.deepEqual(rows[0], {
      tgname: GATILHO,
      tgenabled: "O",
      por_linha: false,
      antes: false,
      insere: true,
      apaga: false,
      atualiza: false,
      trunca: false,
      funcao: "public.clean_old_shipping_logs",
    });
  },
});

CENARIOS.push({
  id: "L2",
  nome: "L2: um INSERT novo apaga só o que passou de 30 dias; 29 d + 23 h, 29 d, 1 h e a nova ficam intactas",
  corpo: async (c) => {
    const antes = await estado(c);
    assert.equal(antes.length, 5, "[L2] a semente tem 5 linhas antigas");
    await inserirNova(c, "r122c-nova");
    const depois = await estado(c);
    assert.deepEqual(
      rotulos(depois),
      [...SOBRAM, "r122c-nova"].sort(),
      "[L2] devem sobrar exatamente 29 d + 23 h, 29 d, 1 h e a nova (31 d e 30 d + 1 h somem)",
    );
    for (const l of depois.filter((x) => SOBRAM.includes(x.provider))) {
      const igual = antes.find((a) => a.provider === l.provider);
      assert.deepEqual(l, igual, `[L2] a linha ${l.provider} foi alterada`);
    }
  },
});

CENARIOS.push({
  id: "L3",
  nome: "L3: a segunda execução não muda nada no que já sobrou",
  corpo: async (c) => {
    await inserirNova(c, "r122c-nova");
    const primeira = await estado(c);
    await inserirNova(c, "r122c-nova-2");
    const segunda = await estado(c);
    assert.deepEqual(
      segunda.filter((l) => l.provider !== "r122c-nova-2"),
      primeira,
      "[L3] o segundo INSERT mexeu no que a primeira limpeza deixou",
    );
    assert.deepEqual(
      rotulos(segunda),
      [...SOBRAM, "r122c-nova", "r122c-nova-2"].sort(),
      "[L3] conjunto final",
    );
  },
});

CENARIOS.push({
  id: "L4",
  nome: "L4: controle — com o gatilho calado o INSERT novo deixa as cinco antigas onde estão",
  corpo: async (c) => {
    await calar(c);
    await inserirNova(c, "r122c-nova");
    await religar(c);
    assert.deepEqual(
      rotulos(await estado(c)),
      [...ANTIGAS.map(([r]) => r), "r122c-nova"].sort(),
      "[L4] sem gatilho nada deveria sumir: a limpeza do L2 é mesmo do gatilho",
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
        "A retenção de 30 dias do histórico de frete não é a prometida — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[logs-de-frete] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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
