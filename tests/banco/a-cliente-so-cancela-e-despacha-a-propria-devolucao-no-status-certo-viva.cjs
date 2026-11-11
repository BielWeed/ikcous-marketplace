"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, listas
 * de status) ou do resultado da própria RPC no Postgres efêmero; nunca de
 * entrada de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) das duas portas
 * da cliente sobre a PRÓPRIA devolução, contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rpc-ci), chamadas como `authenticated` com o
 * JWT de uma cliente comum:
 *
 *  - public.cancelar_devolucao (corpo vivo: 20261179000000): a devolução é da
 *    cliente (senão P0002 'Devolução não encontrada.') E está solicitada ou
 *    aprovada (senão 22023 'Esta devolução não pode mais ser cancelada.').
 *    O que está em jogo: 'cancelada' LIBERA os itens para uma nova devolução;
 *    cancelar uma devolução já concluída (reembolso pago) reabriria o dinheiro
 *    e o estoque do mesmo item.
 *  - public.informar_envio_devolucao (corpo vivo: 20261175000000): a devolução
 *    é da cliente (P0002), está 'aprovada' E a forma de retorno é Correios ou
 *    transportadora (envio_proprio / etiqueta_reversa) (senão 22023). Sem isso
 *    a cliente rebaixaria uma devolução recebida/concluída para 'em_transito'.
 *
 * As devoluções são semeadas DIRETO pelo dono do clone (com os NOT NULL e CHECKs
 * vivos), uma por pedido (há índice de UMA devolução aberta por pedido), tudo
 * numa transação SEMPRE desfeita, cada cenário num SAVEPOINT. Toda recusa prova
 * três coisas: código e mensagem exatos, a linha da devolução INTEIRA igual
 * (status, encerrada_em, postada_em, codigo_rastreio…) e nenhuma linha nova em
 * devolucao_eventos.
 *
 * CENÁRIOS:
 *   C1  cancelar: concluída (com reembolso), recebida, em trânsito, recusada,
 *       cancelada e reprovada DA PRÓPRIA cliente -> 22023, nada muda
 *   C2  cancelar: outra cliente tenta cancelar a solicitada da dona -> P0002,
 *       nada muda (e id inexistente dá o mesmo P0002)
 *   C3  controle: a dona cancela a solicitada e a aprovada -> 'cancelada',
 *       encerrada_em preenchido e 1 evento novo (cliente)
 *   Ia  informar: outra cliente informa o envio da aprovada da dona -> P0002,
 *       status e codigo_rastreio intactos
 *   Ib  informar: a dona em concluída, recebida, solicitada (e em trânsito,
 *       recusada, cancelada, reprovada), todas com método Correios -> 22023,
 *       nada muda (postada_em e eventos inclusive)
 *   Ic  informar: aprovada com método entrega_na_loja ou coleta -> 22023
 *   Id  controle: a dona, aprovada com envio_proprio e com etiqueta_reversa,
 *       código válido -> 'em_transito', código em MAIÚSCULAS, postada_em
 *       preenchida e 1 evento novo
 *
 * MUTANTES: MUTANTE_R113A=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha no cenário que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R113A a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-cliente-so-cancela-e-despacha-a-propria-devolucao-no-status-certo-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, falhar } = P;
const { anexarAoSummary } = require("./efemero.cjs");

const TITULO =
  "Prova viva: a cliente só cancela e despacha a PRÓPRIA devolução no status certo (rpc-ci)";
const CANCELAR = "public.cancelar_devolucao(uuid)";
const INFORMAR = "public.informar_envio_devolucao(uuid,text)";
const U_CLIENTE = "c113a000-0000-4000-8000-0000000000a1";
const U_OUTRO = "c113a000-0000-4000-8000-0000000000a2";
const id = (n) => `c113a000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const POSSE = "IF NOT FOUND OR v_d.user_id IS DISTINCT FROM auth.uid() THEN";
const GUARDA_STATUS_CANCELAR =
  "  IF v_d.status NOT IN ('solicitada', 'aprovada') THEN\n" +
  "    RAISE EXCEPTION 'Esta devolução não pode mais ser cancelada.' USING ERRCODE = '22023';\n" +
  "  END IF;\n";
const STATUS_INFORMAR = "v_d.status <> 'aprovada' OR ";
const METODO_INFORMAR =
  " OR v_d.metodo_retorno NOT IN ('envio_proprio', 'etiqueta_reversa')";

const MUTANTES = {
  "cancelar-sem-guarda-de-posse": {
    assinatura: CANCELAR,
    espera: ["C2"],
    de: POSSE,
    para: "IF NOT FOUND THEN",
  },
  "cancelar-sem-guarda-de-status": {
    assinatura: CANCELAR,
    espera: ["C1"],
    de: GUARDA_STATUS_CANCELAR,
    para: "",
  },
  "informar-sem-guarda-de-posse": {
    assinatura: INFORMAR,
    espera: ["Ia"],
    de: POSSE,
    para: "IF NOT FOUND THEN",
  },
  "informar-sem-guarda-de-status": {
    assinatura: INFORMAR,
    espera: ["Ib"],
    de: STATUS_INFORMAR,
    para: "",
  },
  "informar-sem-guarda-do-metodo": {
    assinatura: INFORMAR,
    espera: ["Ic"],
    de: METODO_INFORMAR,
    para: "",
  },
};

// ------------------------------------------------------------------ semente

let seq = 100;
const proximo = () => id(++seq);

const TERMINAIS = ["concluida", "recusada", "cancelada", "reprovada"];

/**
 * Um pedido entregue e pago + UMA devolução dele no `status` pedido, da `dono`.
 * Datas de fechamento em now() - 1 dia (nunca = now() da transação, para um
 * UPDATE que as reescrevesse aparecer). Em trânsito já nasce com rastreio e
 * postada_em, para um novo informar_envio ter o que sobrescrever.
 */
async function devolucao(
  c,
  dono,
  { status, metodo = "envio_proprio", modalidade = "nacional" },
) {
  const pedido = proximo();
  const dev = proximo();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, cancelled_after_shipping)
     VALUES ($1, $2, 'Cliente ficticia', '{"whatsapp":"5599999990000"}', 300, 300,
             'delivered', 'online', 'pix', 'pago', now(), false)`,
    [pedido, dono],
  );
  const terminal = TERMINAIS.includes(status);
  const comReembolso = status === "concluida";
  const recebida = ["recebida", "concluida", "reprovada"].includes(status);
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada,
        resolucao_final, modalidade, metodo_retorno, status, valor_itens,
        valor_reembolso, reembolso_manual, codigo_rastreio, prazo_ate, politica,
        aprovada_em, postada_em, recebida_em, concluida_em, encerrada_em)
     VALUES ($1::uuid, $1::uuid::text, $2, $3, 'arrependimento', 'desisti', 'reembolso',
             $4, $5, $6, $7, 100, $8, $9, $10, current_date + 7, '{}',
             CASE WHEN $7 = 'solicitada' THEN NULL ELSE now() - interval '3 days' END,
             CASE WHEN $7 = 'em_transito' THEN now() - interval '2 days' ELSE NULL END,
             CASE WHEN $11 THEN now() - interval '1 day' ELSE NULL END,
             CASE WHEN $12 THEN now() - interval '1 day' ELSE NULL END,
             CASE WHEN $13 THEN now() - interval '1 day' ELSE NULL END)`,
    [
      dev,
      pedido,
      dono,
      comReembolso ? "reembolso" : null,
      modalidade,
      metodo,
      status,
      comReembolso ? 100 : null,
      comReembolso,
      status === "em_transito" ? "AA111111111BR" : null,
      recebida,
      comReembolso,
      terminal,
    ],
  );
  return dev;
}

/** Linha INTEIRA das devoluções e TODOS os eventos delas (o que "nada muda" mede). */
async function foto(c, ids) {
  return (
    await c.query(
      `SELECT
         (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.devolucoes d
           WHERE d.id = ANY($1::uuid[])) AS devolucoes,
         (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.devolucao_eventos e
           WHERE e.devolucao_id = ANY($1::uuid[])) AS eventos`,
      [ids],
    )
  ).rows[0];
}

const linhaDe = (f, dev) => f.devolucoes.find((d) => d.id === dev);
const eventosDe = (f, dev) =>
  (f.eventos || []).filter((e) => e.devolucao_id === dev);

// ------------------------------------------------------------------- portas

const sessao = (uid) => ({
  uid,
  claims: JSON.stringify({ sub: uid, role: "authenticated" }),
});

const cancelar = (uid, dev) =>
  P.tentar(
    "authenticated",
    "SELECT public.cancelar_devolucao($1::uuid) AS r",
    [dev],
    sessao(uid),
  );

const informar = (uid, dev, codigo = "qb123456789br") =>
  P.tentar(
    "authenticated",
    "SELECT public.informar_envio_devolucao($1::uuid, $2) AS r",
    [dev, codigo],
    sessao(uid),
  );

const MSG_NAO_ACHADA = /^Devolução não encontrada\.$/;
const MSG_CANCELAR = /^Esta devolução não pode mais ser cancelada\.$/;
const MSG_INFORMAR =
  /^O código de envio só é informado depois da aprovação, em devolução pelos Correios ou transportadora\.$/;

/** A porta TEM de recusar (código + mensagem) e a devolução INTEIRA e os eventos ficam como estavam. */
async function recusa(c, chamar, ids, codigo, mensagem, rotulo) {
  const antes = await foto(c, ids);
  const r = await chamar();
  assert.equal(
    r.codigo,
    codigo,
    `${rotulo}: devia recusar com ${codigo}; resposta ${JSON.stringify(r.erro ?? r.linhas)}`,
  );
  assert.match(r.erro, mensagem, `${rotulo}: mensagem`);
  assert.deepEqual(
    await foto(c, ids),
    antes,
    `${rotulo}: a recusa mudou linha de devolução ou evento`,
  );
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "C1",
  nome: "C1: a dona não cancela devolução concluída (com reembolso), recebida, em trânsito, recusada, cancelada nem reprovada -> 22023, nada muda",
  corpo: async (c) => {
    const ids = [];
    // concluida e recebida (as duas do brief) primeiro; depois o resto dos fechados/em curso.
    for (const status of [
      "concluida",
      "recebida",
      "em_transito",
      "recusada",
      "cancelada",
      "reprovada",
    ]) {
      const dev = await devolucao(c, U_CLIENTE, { status });
      ids.push(dev);
      await recusa(
        c,
        () => cancelar(U_CLIENTE, dev),
        ids,
        "22023",
        MSG_CANCELAR,
        `[C1] cancelar ${status}`,
      );
      const depois = linhaDe(await foto(c, ids), dev);
      assert.equal(depois.status, status, `[C1] ${status}: status intacto`);
    }
    // A concluída guarda o fechamento de ontem, não o now() de um cancelamento.
    const concluida = linhaDe(await foto(c, ids), ids[0]);
    assert.equal(concluida.status, "concluida");
    assert.notEqual(
      concluida.encerrada_em,
      null,
      "[C1] concluída segue encerrada",
    );
    assert.equal(
      concluida.reembolso_manual,
      true,
      "[C1] reembolso da concluída intacto",
    );
  },
});

CENARIOS.push({
  id: "C2",
  nome: "C2: outra cliente não cancela a devolução solicitada da dona -> P0002 'Devolução não encontrada', nada muda",
  corpo: async (c) => {
    const dev = await devolucao(c, U_CLIENTE, { status: "solicitada" });
    await recusa(
      c,
      () => cancelar(U_OUTRO, dev),
      [dev],
      "P0002",
      MSG_NAO_ACHADA,
      "[C2] outra cliente cancela",
    );
    const f = await foto(c, [dev]);
    assert.equal(linhaDe(f, dev).status, "solicitada", "[C2] status intacto");
    assert.equal(
      linhaDe(f, dev).encerrada_em,
      null,
      "[C2] encerrada_em intacto",
    );
    // Id que não existe: a mesma resposta (não revela se o id existe).
    const r = await cancelar(U_CLIENTE, id(999));
    assert.equal(r.codigo, "P0002", "[C2] id inexistente");
    assert.match(r.erro, MSG_NAO_ACHADA);
  },
});

CENARIOS.push({
  id: "C3",
  nome: "C3: controle — a dona cancela a solicitada e a aprovada -> 'cancelada', encerrada_em e 1 evento novo",
  corpo: async (c) => {
    for (const status of ["solicitada", "aprovada"]) {
      const dev = await devolucao(c, U_CLIENTE, { status });
      const antes = await foto(c, [dev]);
      assert.equal(linhaDe(antes, dev).encerrada_em, null);
      const r = await cancelar(U_CLIENTE, dev);
      assert.equal(r.codigo, undefined, `[C3] ${status}: ${r.erro}`);
      assert.deepEqual(r.linhas, [{ r: { id: dev, status: "cancelada" } }]);
      const depois = await foto(c, [dev]);
      assert.equal(linhaDe(depois, dev).status, "cancelada", `[C3] ${status}`);
      assert.notEqual(
        linhaDe(depois, dev).encerrada_em,
        null,
        `[C3] ${status}: encerrada_em preenchido`,
      );
      const novos = eventosDe(depois, dev);
      assert.equal(
        novos.length,
        eventosDe(antes, dev).length + 1,
        `[C3] ${status}: 1 evento novo`,
      );
      const ev = novos.at(-1);
      assert.equal(ev.de_status, status);
      assert.equal(ev.para_status, "cancelada");
      assert.equal(ev.ator, "cliente");
    }
  },
});

CENARIOS.push({
  id: "Ia",
  nome: "Ia: outra cliente não informa o envio da devolução aprovada da dona -> P0002, status e codigo_rastreio intactos",
  corpo: async (c) => {
    const dev = await devolucao(c, U_CLIENTE, { status: "aprovada" });
    await recusa(
      c,
      () => informar(U_OUTRO, dev),
      [dev],
      "P0002",
      MSG_NAO_ACHADA,
      "[Ia] outra cliente informa envio",
    );
    const linha = linhaDe(await foto(c, [dev]), dev);
    assert.equal(linha.status, "aprovada", "[Ia] status intacto");
    assert.equal(linha.codigo_rastreio, null, "[Ia] codigo_rastreio intacto");
    const r = await informar(U_CLIENTE, id(999));
    assert.equal(r.codigo, "P0002", "[Ia] id inexistente");
    assert.match(r.erro, MSG_NAO_ACHADA);
  },
});

CENARIOS.push({
  id: "Ib",
  nome: "Ib: a dona não informa envio em devolução concluída, recebida, solicitada (nem em trânsito, recusada, cancelada, reprovada) -> 22023, nada muda",
  corpo: async (c) => {
    const ids = [];
    for (const status of [
      "concluida",
      "recebida",
      "solicitada",
      "em_transito",
      "recusada",
      "cancelada",
      "reprovada",
    ]) {
      // Método Correios em todas: só o STATUS pode barrar.
      const dev = await devolucao(c, U_CLIENTE, { status });
      ids.push(dev);
      const antes = linhaDe(await foto(c, ids), dev);
      await recusa(
        c,
        () => informar(U_CLIENTE, dev),
        ids,
        "22023",
        MSG_INFORMAR,
        `[Ib] informar envio em ${status}`,
      );
      const depois = linhaDe(await foto(c, ids), dev);
      assert.equal(depois.status, status, `[Ib] ${status}: status intacto`);
      assert.equal(
        depois.codigo_rastreio,
        antes.codigo_rastreio,
        `[Ib] ${status}: codigo_rastreio intacto`,
      );
      assert.equal(
        depois.postada_em,
        antes.postada_em,
        `[Ib] ${status}: postada_em intacto`,
      );
    }
  },
});

CENARIOS.push({
  id: "Ic",
  nome: "Ic: devolução aprovada com retorno entrega_na_loja ou coleta -> 22023, nada muda",
  corpo: async (c) => {
    const ids = [];
    for (const metodo of ["entrega_na_loja", "coleta"]) {
      // Aprovada e da dona: só o MÉTODO pode barrar.
      const dev = await devolucao(c, U_CLIENTE, {
        status: "aprovada",
        metodo,
        modalidade: "local",
      });
      ids.push(dev);
      await recusa(
        c,
        () => informar(U_CLIENTE, dev),
        ids,
        "22023",
        MSG_INFORMAR,
        `[Ic] informar envio com retorno ${metodo}`,
      );
      const linha = linhaDe(await foto(c, ids), dev);
      assert.equal(linha.status, "aprovada", `[Ic] ${metodo}: status intacto`);
      assert.equal(
        linha.codigo_rastreio,
        null,
        `[Ic] ${metodo}: codigo_rastreio intacto`,
      );
    }
  },
});

CENARIOS.push({
  id: "Id",
  nome: "Id: controle — a dona informa envio da aprovada com envio_proprio e com etiqueta_reversa -> 'em_transito', código em maiúsculas, postada_em e 1 evento",
  corpo: async (c) => {
    for (const metodo of ["envio_proprio", "etiqueta_reversa"]) {
      const dev = await devolucao(c, U_CLIENTE, { status: "aprovada", metodo });
      const antes = await foto(c, [dev]);
      assert.equal(linhaDe(antes, dev).postada_em, null);
      const r = await informar(U_CLIENTE, dev, "  qb123456789br ");
      assert.equal(r.codigo, undefined, `[Id] ${metodo}: ${r.erro}`);
      assert.deepEqual(r.linhas, [{ r: { id: dev, status: "em_transito" } }]);
      const depois = await foto(c, [dev]);
      const linha = linhaDe(depois, dev);
      assert.equal(linha.status, "em_transito", `[Id] ${metodo}`);
      assert.equal(
        linha.codigo_rastreio,
        "QB123456789BR",
        `[Id] ${metodo}: código aparado e em maiúsculas`,
      );
      assert.notEqual(
        linha.postada_em,
        null,
        `[Id] ${metodo}: postada_em preenchida`,
      );
      const novos = eventosDe(depois, dev);
      assert.equal(
        novos.length,
        eventosDe(antes, dev).length + 1,
        `[Id] ${metodo}: 1 evento novo`,
      );
      const ev = novos.at(-1);
      assert.equal(ev.de_status, "aprovada");
      assert.equal(ev.para_status, "em_transito");
      assert.equal(ev.ator, "cliente");
      assert.equal(ev.nota, "Rastreio: QB123456789BR");
    }
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R113A='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        m.assinatura,
      ])
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

async function semear(c) {
  for (const [uid, nome] of [
    [U_CLIENTE, "Cliente"],
    [U_OUTRO, "Outra"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}')",
      [uid, `${uid}@r113a.fixture.invalid`],
    );
    // O gatilho de profiles sincroniza o papel em auth.users.
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $2, 'customer')",
      [uid, `${nome} ficticia`],
    );
  }
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), cliente e outra, e cada
 * cenário num SAVEPOINT. Devolve {mutante, passou:[ids], falhou:[{id, nome, erro}]}.
 * Erro que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await semear(c);
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id: cid, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        seq = 100;
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

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const nomeMutante = process.env.MUTANTE_R113A || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R113A='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const c = await P.conectar().catch((erro) => {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  });
  try {
    // A cliente (authenticated) chama auth.uid(): precisa enxergar o schema.
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
    const r = await rodar(c, nomeMutante);
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
        "A cliente consegue cancelar ou despachar devolução que não é dela, ou fora do status certo — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[a-cliente-so-cancela-e-despacha] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await c.end().catch(() => {});
  }
}

main().catch((e) => falhar("FALHOU", e.stack || e.message));
