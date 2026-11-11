"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) do sino de perguntas e da aba Pendentes do painel:
 * public.get_admin_questions_paged (corpo vigente desde
 * 20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql), contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rpc-ci). Só o clone descartável do rodar-isolado.cjs, nunca banco de loja.
 *
 * O QUE O CORPO GUARDA (na contagem E na página, que são duas consultas separadas):
 *   `p_filter = 'all' OR NOT EXISTS (resposta da pergunta)`. 'all' não filtra; qualquer outro valor (a tela e o
 *   sino mandam 'pending') deixa passar SÓ a pergunta sem nenhuma resposta. O sino do lojista (AdminLayout e
 *   useAvisosDoLojista: p_filter 'pending', p_page_size 1, lendo SÓ total_count) e a aba Pendentes de Perguntas e
 *   Respostas dependem disso: sem a guarda o sino conta TODAS as perguntas como pendentes; invertida, mostra zero
 *   com cliente esperando resposta.
 *
 * FIXTURE (ano 2031; nenhum outro teste escreve nele; created_at todos DISTINTOS; a lista é a da data decrescente):
 *   q   created_at     produto  autora  respostas  pergunta
 *   q1  2031-01-01     Alfa     Ana     0          "Tem no tamanho M?"
 *   q2  2031-01-02     Beta     Bia     0          "Serve no tamanho G?"
 *   q3  2031-01-03     Alfa     Ana     1          "Qual a cor da caixa?"
 *   q4  2031-01-04     Beta     Bia     1          "Pode lavar na maquina?"
 *   q5  2031-01-05     Alfa     Bia     0          "Quanto tempo de entrega?"
 *   => todas (data decrescente): q5, q4, q3, q2, q1 (total 5)
 *   => pendentes: q5, q2, q1 (total 3); respondidas: q4, q3
 *   Uma pergunta tem NO MÁXIMO uma resposta (idx_answers_question_id_unique, 20260812030000): "respondida" = 1 linha em
 *   answers; a resposta editada é upsert, não segunda linha. Por isso não há fixture com duas respostas.
 *   O clone pode trazer perguntas de antes: a transação começa apagando-as (DESFEITO no fim).
 *
 * CENÁRIOS (cada um confere ids, ORDEM e total_count de TODAS as páginas, mais uma página além do fim):
 *   G  controle sem filtro: as 5 perguntas, na ordem, com a resposta dentro (q4 e q3), as pendentes com a lista vazia
 *   P  pendentes: o total é 3 (não 5), a pergunta respondida fica de fora, paginado de 2 em 2
 *   B  a chamada do SINO (busca '', 'pending', página 0, tamanho 1): 1 linha (a mais nova pendente) e total_count 3
 *   S  busca combinada com pendentes (produto, autora, texto): total e página concordam com o filtro
 *   C  coerência: com a página grande, o total_count é exatamente o número de linhas, em 'all' e em 'pending', e
 *      toda linha pendente chega com a lista de respostas vazia
 *
 * MUTANTES: MUTANTE_R112E=<nome> troca UM trecho do corpo vivo (via pg_get_functiondef, dentro da transação
 * desfeita; a contagem e a página são separadas no marcador "-- Fetch paginated data") e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha num cenário que o nome promete. Nome desconhecido é ERRO.
 * Sem MUTANTE_R112E a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-sino-de-perguntas-do-painel-conta-so-as-pendentes-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o sino de perguntas do painel conta só as pendentes (rpc-ci)";
const FN = "public.get_admin_questions_paged(text,text,integer,integer)";
const ADMIN = "b112e100-0000-4000-8000-0000000000a1";
const ANA = "b112e100-0000-4000-8000-0000000000a2";
const BIA = "b112e100-0000-4000-8000-0000000000a3";
const PROD_ALFA = "b112e100-0000-4000-8000-0000000000f1";
const PROD_BETA = "b112e100-0000-4000-8000-0000000000f2";
const id = (n) => `b112e100-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

// [n, created_at, produto, autora, pergunta, respostas]
const PERGUNTAS = [
  [1, "2031-01-01T12:00:00Z", PROD_ALFA, ANA, "Tem no tamanho M?", 0],
  [2, "2031-01-02T12:00:00Z", PROD_BETA, BIA, "Serve no tamanho G?", 0],
  [3, "2031-01-03T12:00:00Z", PROD_ALFA, ANA, "Qual a cor da caixa?", 1],
  [4, "2031-01-04T12:00:00Z", PROD_BETA, BIA, "Pode lavar na maquina?", 1],
  [5, "2031-01-05T12:00:00Z", PROD_ALFA, BIA, "Quanto tempo de entrega?", 0],
];

// ---------------------------------------------------------------- mutantes
// Os trechos EXATOS do corpo vivo. Cada um aparece 1x na contagem e 1x na página
// (o marcador separa as duas metades); o mutante diz em qual(is) mexe.
const DIVISOR = "    -- Fetch paginated data";
const FILTRO =
  "(p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))";
const FILTRO_INVERTIDO =
  "(p_filter = 'all' OR EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))";

/** Um mutante = um trecho trocado na(s) metade(s) pedida(s): "ambas", "contagem" ou "pagina". */
const mut = (espera, de, para, onde = "ambas") => ({
  espera,
  de,
  para,
  onde,
});
const MUTANTES = {
  // Os dois pedidos: a guarda some da contagem (o número do sino) OU da página (as linhas da aba Pendentes).
  "perguntas-contagem-sem-filtro-pendente": mut(
    ["P"],
    FILTRO,
    "TRUE",
    "contagem",
  ),
  "perguntas-pagina-sem-filtro-pendente": mut(["P"], FILTRO, "TRUE", "pagina"),
  // A guarda some das duas.
  "perguntas-sem-filtro-pendente-em-nenhuma": mut(["P"], FILTRO, "TRUE"),
  // A guarda inverte: 'pending' passa a mostrar as RESPONDIDAS e esconde as que esperam resposta.
  "perguntas-pendente-inverte-para-respondidas": mut(
    ["P"],
    FILTRO,
    FILTRO_INVERTIDO,
  ),
  "perguntas-contagem-pendente-invertida": mut(
    ["P"],
    FILTRO,
    FILTRO_INVERTIDO,
    "contagem",
  ),
  "perguntas-pagina-pendente-invertida": mut(
    ["P"],
    FILTRO,
    FILTRO_INVERTIDO,
    "pagina",
  ),
  // 'all' deixa de ser "sem filtro": a aba Todas passa a mostrar só as pendentes.
  "perguntas-all-vira-pendente": mut(
    ["G"],
    FILTRO,
    "NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id)",
  ),
};

// ---------------------------------------------------------------- consulta

/** Chama a RPC como o administrador (papel authenticated + JWT), a mesma porta do painel e do sino. */
async function listar(
  c,
  { busca = "", filtro = "all", pagina = 0, tamanho = 100 },
) {
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [SESSAO.uid, SESSAO.claims],
  );
  await c.query("SET LOCAL ROLE authenticated");
  try {
    const r = await c.query(
      "SELECT public.get_admin_questions_paged($1,$2,$3,$4) AS r",
      [busca, filtro, pagina, tamanho],
    );
    return {
      linhas: r.rows[0].r.data,
      ids: r.rows[0].r.data.map((q) => q.id),
      total: Number(r.rows[0].r.total_count),
    };
  } finally {
    await c.query("RESET ROLE");
  }
}

/**
 * Confere TODAS as páginas de um filtro: ids na ordem, total_count igual em cada uma, e uma página além do
 * fim vazia que ainda carrega o total.
 */
async function conferir(c, rotulo, filtro, paginas, total) {
  for (const [pagina, numeros] of paginas.entries()) {
    const r = await listar(c, { ...filtro, pagina });
    assert.strictEqual(
      r.total,
      total,
      `[${rotulo}] total_count da página ${pagina} (o número do sino/paginador): esperado ${total}`,
    );
    assert.deepStrictEqual(
      r.ids,
      numeros.map(id),
      `[${rotulo}] linhas da página ${pagina}: pergunta de fora do filtro, ordem ou limite errados`,
    );
  }
  const alem = await listar(c, { ...filtro, pagina: paginas.length });
  assert.deepStrictEqual(
    { ids: alem.ids, total: alem.total },
    { ids: [], total },
    `[${rotulo}] a página além do fim vem vazia e ainda carrega o total ${total}`,
  );
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "G",
  nome: "G: controle sem filtro — as 5 perguntas na ordem da data decrescente, com as respostas dentro",
  corpo: async (c) => {
    await conferir(
      c,
      "G all",
      { filtro: "all", tamanho: 2 },
      [[5, 4], [3, 2], [1]],
      5,
    );
    const todas = await listar(c, { filtro: "all" });
    const respostasPorPergunta = todas.linhas.map((q) => q.answers.length);
    assert.deepStrictEqual(
      respostasPorPergunta,
      [0, 1, 1, 0, 0],
      "[G] 'all' traz a pergunta respondida COM a resposta dentro (q4 e q3, uma cada) e as pendentes com a lista vazia",
    );
  },
});

CENARIOS.push({
  id: "P",
  nome: "P: pendentes — total 3 (não 5), a respondida fica de fora, de 2 em 2",
  corpo: async (c) => {
    await conferir(
      c,
      "P pending",
      { filtro: "pending", tamanho: 2 },
      [[5, 2], [1]],
      3,
    );
    // Uma página só: as 3 pendentes e NENHUMA das duas respondidas (q3 e q4).
    const todas = await listar(c, { filtro: "pending", tamanho: 100 });
    assert.deepStrictEqual(
      todas.ids,
      [5, 2, 1].map(id),
      "[P] pendentes = só q5, q2 e q1",
    );
    assert.ok(
      !todas.ids.includes(id(3)),
      "[P] a pergunta respondida q3 não é pendente",
    );
    assert.ok(
      !todas.ids.includes(id(4)),
      "[P] a pergunta respondida q4 não é pendente",
    );
  },
});

CENARIOS.push({
  id: "B",
  nome: "B: a chamada do sino (busca vazia, 'pending', página 0, tamanho 1) — 1 linha e total_count 3",
  corpo: async (c) => {
    const sino = await listar(c, { filtro: "pending", pagina: 0, tamanho: 1 });
    assert.strictEqual(
      sino.total,
      3,
      "[B] o número do sino = as perguntas SEM resposta (3), não todas (5) nem zero",
    );
    assert.deepStrictEqual(
      sino.ids,
      [id(5)],
      "[B] a página de 1 linha traz a pendente mais nova (q5)",
    );
    // O mesmo número com a aba "Todas": o sino e a aba não são a mesma coisa.
    const todas = await listar(c, { filtro: "all", pagina: 0, tamanho: 1 });
    assert.strictEqual(todas.total, 5, "[B] 'all' conta as 5");
  },
});

CENARIOS.push({
  id: "S",
  nome: "S: busca combinada com pendentes (produto, autora, texto) — o total e a página concordam com o filtro",
  corpo: async (c) => {
    // Produto Alfa: q5, q3, q1; pendentes dele: q5, q1.
    await conferir(
      c,
      "S Alfa + all",
      { busca: "Alfa", filtro: "all", tamanho: 2 },
      [[5, 3], [1]],
      3,
    );
    await conferir(
      c,
      "S Alfa + pending",
      { busca: "Alfa", filtro: "pending", tamanho: 1 },
      [[5], [1]],
      2,
    );
    // Autora Bia: q5, q4, q2; pendentes dela: q5, q2.
    await conferir(
      c,
      "S Bia + all",
      { busca: "Bia", filtro: "all", tamanho: 10 },
      [[5, 4, 2]],
      3,
    );
    await conferir(
      c,
      "S Bia + pending",
      { busca: "Bia", filtro: "pending", tamanho: 10 },
      [[5, 2]],
      2,
    );
    // Texto que só existe numa pergunta RESPONDIDA: 'all' acha, 'pending' não (total 0, nunca 1).
    await conferir(
      c,
      "S lavar + all",
      { busca: "lavar", filtro: "all", tamanho: 10 },
      [[4]],
      1,
    );
    await conferir(
      c,
      "S lavar + pending",
      { busca: "lavar", filtro: "pending", tamanho: 10 },
      [],
      0,
    );
    // Texto que só existe numa PENDENTE: as duas abas acham.
    await conferir(
      c,
      "S entrega + pending",
      { busca: "entrega", filtro: "pending", tamanho: 10 },
      [[5]],
      1,
    );
  },
});

CENARIOS.push({
  id: "C",
  nome: "C: coerência — com a página grande o total_count é o número de linhas, e toda pendente chega sem resposta",
  corpo: async (c) => {
    for (const [filtro, esperadas] of [
      ["all", 5],
      ["pending", 3],
    ]) {
      const r = await listar(c, { filtro, tamanho: 100 });
      assert.strictEqual(
        r.total,
        r.linhas.length,
        `[C ${filtro}] o total_count tem de bater com as linhas da página`,
      );
      assert.strictEqual(
        r.linhas.length,
        esperadas,
        `[C ${filtro}] número de linhas`,
      );
    }
    const pendentes = await listar(c, { filtro: "pending", tamanho: 100 });
    for (const q of pendentes.linhas) {
      assert.deepStrictEqual(
        q.answers,
        [],
        `[C] a pendente ${q.id} chegou com resposta dentro: o filtro deixou passar pergunta respondida`,
      );
    }
  },
});

// ------------------------------------------------------------------ rodada

/**
 * Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). A contagem e a página são
 * separadas no marcador; o trecho tem de aparecer exatamente 1x em cada metade, e o mutante mexe só onde diz.
 */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R112E='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  assert.strictEqual(
    def.split(DIVISOR).length - 1,
    1,
    "o marcador que separa a contagem da página tem de aparecer 1x",
  );
  const [contagem, pagina] = def.split(DIVISOR);
  for (const [metade, texto] of [
    ["contagem", contagem],
    ["pagina", pagina],
  ]) {
    const ocorrencias = texto.split(m.de).length - 1;
    assert.strictEqual(
      ocorrencias,
      1,
      `mutante ${nome}: o trecho tem de aparecer 1x na ${metade} do corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
    );
  }
  const novaContagem =
    m.onde === "pagina" ? contagem : contagem.replace(m.de, () => m.para);
  const novaPagina =
    m.onde === "contagem" ? pagina : pagina.replace(m.de, () => m.para);
  const mutado = novaContagem + DIVISOR + novaPagina;
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.strictEqual(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), o admin, a loja sem pergunta e as 5 da fixture. Cada cenário só
 * lê. Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro que não é de asserção (SQL, conexão) sobe: é do
 * teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    // O clone nem sempre libera o schema auth para o papel authenticated; some no ROLLBACK.
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@r112e.fixture.invalid', '{"role":"admin"}'::jsonb),
              ($2, 'ana@r112e.fixture.invalid', '{}'::jsonb),
              ($3, 'bia@r112e.fixture.invalid', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, ANA, BIA],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Ficticio', 'admin'), ($2, 'Ana Ficticia', 'customer'), ($3, 'Bia Ficticia', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, ANA, BIA],
    );
    await c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
       VALUES ($1, 'Produto Alfa R112', 100, 10, true, 40),
              ($2, 'Produto Beta R112', 100, 10, true, 40)`,
      [PROD_ALFA, PROD_BETA],
    );
    // Números absolutos da loja inteira: limpa o que o clone já traga. Sem gatilho nem FK (replica) e DESFEITO
    // no ROLLBACK; o que se insere depois volta ao papel normal, com os gatilhos de produção.
    const antes = (
      await c.query("SELECT count(*)::int AS n FROM public.questions")
    ).rows[0].n;
    if (antes > 0) {
      console.log(
        `    (clone com ${antes} pergunta(s): apagadas só nesta transação)`,
      );
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("DELETE FROM public.answers");
      await c.query("DELETE FROM public.questions");
      await c.query("SET LOCAL session_replication_role = origin");
    }
    for (const [n, criado, produto, autora, texto, respostas] of PERGUNTAS) {
      await c.query(
        `INSERT INTO public.questions (id, product_id, user_id, question, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id(n), produto, autora, texto, criado],
      );
      // Sessão direta no banco grava a data como vier (o gatilho da data de agora só vale para papel de API).
      for (let r = 1; r <= respostas; r++) {
        await c.query(
          `INSERT INTO public.answers (question_id, user_id, answer, created_at)
           VALUES ($1, $2, $3, $4)`,
          [id(n), ADMIN, `Resposta ${r} da loja`, `2031-02-0${r}T12:00:00Z`],
        );
      }
    }
    const gravadas = (
      await c.query("SELECT count(*)::int AS n FROM public.questions")
    ).rows[0].n;
    assert.strictEqual(
      gravadas,
      PERGUNTAS.length,
      "a prova parte da loja só com as perguntas da fixture",
    );

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id: cenario, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(cenario);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id: cenario, nome, erro });
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

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R112E || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R112E='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
    for (const idCenario of r.passou) console.log(`  PASSOU ${idCenario}`);
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
        (cenario) => !r.falhou.some((f) => f.id === cenario),
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
        "O sino/a aba de perguntas do painel não contou só as pendentes — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-sino-de-perguntas-do-painel] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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
