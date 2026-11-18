"use strict";

// So o clone descartavel de rodar-isolado.cjs. Nenhuma migration muda.
// MUTANTE_R100 remove UMA guarda do corpo vivo dentro da transacao desfeita.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b101f000-0000-4000-8000-000000000001";
const CLIENTE = "b101f000-0000-4000-8000-000000000002";
const id = (n) => `b101f000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

async function pessoas() {
  const c = P.conexao();
  for (const [uid, papel] of [
    [ADMIN, "admin"],
    [CLIENTE, "customer"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}')",
      [uid, `${uid}@r101.fixture.invalid`],
    );
    // O gatilho de profiles sincroniza o papel em auth.users.
    await c.query(
      "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia',$2)",
      [uid, papel],
    );
  }
}

// Cada pedido de R$300 tem R$100 JA devolvidos manualmente. A devolucao
// concluida e o proprio alvo ou uma irma do alvo, nunca um saldo simulado.
async function fixture(estado, n) {
  const c = P.conexao();
  const pedido = id(n);
  const manual = id(n + 1);
  const alvo = estado === "concluida" ? manual : id(n + 2);
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id,user_id,customer_name,customer_data,total,subtotal,status,canal,
        payment_method,payment_status,paid_at,cancelled_after_shipping)
     VALUES ($1,$2,\'Cliente ficticio\',\'{"whatsapp":"5599999990000"}\',300,300,
             \'delivered\',\'online\',\'pix\',\'pago\',now(),false)`,
    [pedido, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,resolucao_final,
        modalidade,metodo_retorno,status,valor_itens,valor_reembolso,reembolso_manual,
        prazo_ate,politica,concluida_em,encerrada_em)
     VALUES ($1::uuid,$1::uuid::text,$2,$3,\'arrependimento\',\'desisti\',\'reembolso\',\'reembolso\',
             \'local\',\'entrega_na_loja\',\'concluida\',100,100,true,current_date+7,\'{}\',now(),now())`,
    [manual, pedido, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.devolucao_eventos (devolucao_id,de_status,para_status,ator,nota,created_by)
     VALUES ($1,\'recebida\',\'concluida\',\'loja\',\'R$100 devolvidos por fora\',$2)`,
    [manual, ADMIN],
  );
  if (alvo !== manual) {
    await c.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,modalidade,
          metodo_retorno,status,valor_itens,prazo_ate,politica)
       VALUES ($1::uuid,$1::uuid::text,$2,$3,\'arrependimento\',\'desisti\',\'reembolso\',\'local\',
               \'entrega_na_loja\',$4,50,current_date+7,\'{}\')`,
      [alvo, pedido, CLIENTE, estado],
    );
  }
  const saldo = await foto(pedido);
  assert.equal(
    saldo.saldo,
    "200.00",
    "fixture deve descontar os R$100 manuais",
  );
  return { pedido, alvo, manual };
}

async function foto(pedido) {
  return (
    await P.conexao().query(
      `SELECT
       (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.devolucoes d
         WHERE d.order_id=$1) AS devolucoes,
       (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.devolucao_eventos e
         JOIN public.devolucoes d ON d.id=e.devolucao_id WHERE d.order_id=$1) AS eventos,
       public.pedido__saldo_a_estornar($1)::numeric(12,2)::text AS saldo`,
      [pedido],
    )
  ).rows[0];
}

async function mutar(nome, assinatura, trecho) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        assinatura,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo unico`,
  );
  const alterado = original.replace(trecho, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

const registrar = (alvo) =>
  P.tentar(
    "authenticated",
    "SELECT public.admin_devolucao_registrar($1,'recebida',NULL,'Chegou na loja') AS r",
    [alvo],
    SESSAO,
  );
const enviar = (alvo) =>
  P.tentar(
    "authenticated",
    "SELECT public.admin_devolucao_registrar($1,'em_transito',NULL,'Enviado para a loja') AS r",
    [alvo],
    SESSAO,
  );
const decidir = (alvo, aprovar) =>
  P.tentar(
    "authenticated",
    "SELECT public.admin_devolucao_decidir($1,$2,'Decisao com motivo valido') AS r",
    [alvo, aprovar],
    SESSAO,
  );
const reprovar = (alvo) =>
  P.tentar(
    "authenticated",
    "SELECT public.admin_devolucao_reprovar($1,'Produto usado na inspecao') AS r",
    [alvo],
    SESSAO,
  );
const enviarComCodigo = (codigo) => (alvo) =>
  P.tentar(
    "authenticated",
    "SELECT public.admin_devolucao_registrar($1,'em_transito',$2,'Postado na loja') AS r",
    [alvo, codigo],
    SESSAO,
  );
const reprovarComMotivo = (motivo) => (alvo) =>
  P.tentar(
    "authenticated",
    "SELECT public.admin_devolucao_reprovar($1,$2) AS r",
    [alvo, motivo],
    SESSAO,
  );

async function recusa(fx, chamar, mensagem, rotulo) {
  const antes = await foto(fx.pedido);
  assert.equal(antes.saldo, "200.00");
  const r = await chamar(fx.alvo);
  assert.equal(r.codigo, "22023", `${rotulo}: estado invalido foi aceito`);
  assert.match(r.erro, mensagem);
  assert.deepEqual(
    await foto(fx.pedido),
    antes,
    `${rotulo}: mudou linha, evento ou saldo`,
  );
}

async function aceita(fx, chamar, de, para) {
  const antes = await foto(fx.pedido);
  const r = await chamar(fx.alvo);
  assert.equal(r.codigo, undefined, r.erro);
  assert.deepEqual(r.linhas, [{ r: { id: fx.alvo, status: para } }]);
  const depois = await foto(fx.pedido);
  const alvo = depois.devolucoes.find((d) => d.id === fx.alvo);
  assert.equal(alvo.status, para, "controle nao mudou o estado");
  const anteriores = antes.eventos || [];
  assert.equal(
    depois.eventos.length,
    anteriores.length + 1,
    "controle sem evento novo",
  );
  assert.deepEqual(
    depois.eventos.slice(0, -1),
    anteriores,
    "controle alterou evento antigo",
  );
  const evento = depois.eventos.at(-1);
  assert.equal(evento.devolucao_id, fx.alvo);
  assert.equal(evento.de_status, de);
  assert.equal(evento.para_status, para);
  assert.equal(evento.ator, "loja");
  assert.equal(evento.created_by, ADMIN);
  assert.deepEqual(
    depois.devolucoes.find((d) => d.id === fx.manual),
    antes.devolucoes.find((d) => d.id === fx.manual),
    "controle alterou o reembolso manual ja pago",
  );
  assert.equal(depois.saldo, "200.00", "controle perdeu o desconto manual");
}

prova(
  "recebimento recusa concluida sem mudar linha/eventos/saldo; aprovada e em_transito aceitam",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      await mutar(
        "devolucao-recebe-sem-estado",
        "public.admin_devolucao_registrar(uuid,text,text,text)",
        "    IF v_d.status NOT IN ('aprovada', 'em_transito') THEN\n" +
          "      RAISE EXCEPTION 'Só uma devolução aprovada ou a caminho pode ser marcada como recebida.' USING ERRCODE = '22023';\n" +
          "    END IF;\n",
      );
      await recusa(
        await fixture("concluida", 100),
        registrar,
        /^Só uma devolução aprovada ou a caminho pode ser marcada como recebida\.$/,
        "receber concluida",
      );
      for (const [estado, n] of [
        ["aprovada", 110],
        ["em_transito", 120],
      ]) {
        await aceita(await fixture(estado, n), registrar, estado, "recebida");
      }
    }),
);

prova(
  "envio recusa concluida/recusada/cancelada sem mudar linha/eventos/saldo; aprovada aceita",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      await mutar(
        "devolucao-envia-sem-estado",
        "public.admin_devolucao_registrar(uuid,text,text,text)",
        "    IF v_d.status <> 'aprovada' THEN\n" +
          "      RAISE EXCEPTION 'Só uma devolução aprovada pode ser marcada como enviada.' USING ERRCODE = '22023';\n" +
          "    END IF;\n",
      );
      for (const [estado, n] of [
        ["concluida", 400],
        ["recusada", 410],
        ["cancelada", 420],
      ]) {
        await recusa(
          await fixture(estado, n),
          enviar,
          /^Só uma devolução aprovada pode ser marcada como enviada\.$/,
          `enviar ${estado}`,
        );
      }
      await aceita(
        await fixture("aprovada", 430),
        enviar,
        "aprovada",
        "em_transito",
      );
    }),
);

prova(
  "decisao recusa aprovada/cancelada/concluida sem escrita ou perda manual; solicitada aceita aprovar e recusar",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      await mutar(
        "devolucao-decide-sem-solicitada",
        "public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)",
        "  IF v_d.status <> 'solicitada' THEN\n" +
          "    RAISE EXCEPTION 'Esta devolução já foi decidida.' USING ERRCODE = '22023';\n" +
          "  END IF;\n",
      );
      // Concluida primeiro: o mutante falha exatamente na tentativa de reabrir
      // a linha cujo reembolso manual precisa continuar descontado do saldo.
      let n = 200;
      for (const estado of ["concluida", "aprovada", "cancelada"]) {
        for (const aprovar of [true, false]) {
          await recusa(
            await fixture(estado, n),
            (alvo) => decidir(alvo, aprovar),
            /^Esta devolução já foi decidida\.$/,
            `${aprovar ? "aprovar" : "recusar"} ${estado}`,
          );
          n += 10;
        }
      }
      for (const aprovar of [true, false]) {
        await aceita(
          await fixture("solicitada", n),
          (alvo) => decidir(alvo, aprovar),
          "solicitada",
          aprovar ? "aprovada" : "recusada",
        );
        n += 10;
      }
    }),
);

prova(
  "inspecao recusa concluida sem mudar linha/eventos/saldo; recebida aceita reprovar",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      await mutar(
        "devolucao-reprova-sem-recebida",
        "public.admin_devolucao_reprovar(uuid,text)",
        "  IF v_d.status <> 'recebida' THEN\n" +
          "    RAISE EXCEPTION 'Só um produto recebido pode ser reprovado na inspeção.' USING ERRCODE = '22023';\n" +
          "  END IF;\n",
      );
      await recusa(
        await fixture("concluida", 300),
        reprovar,
        /^Só um produto recebido pode ser reprovado na inspeção\.$/,
        "reprovar concluida",
      );
      await aceita(
        await fixture("recebida", 310),
        reprovar,
        "recebida",
        "reprovada",
      );
    }),
);

prova(
  "marcar como enviada recusa concluida/recebida sem mudar linha/eventos/saldo; aprovada aceita",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      // Sem esta guarda, uma devolucao CONCLUIDA com reembolso manual voltaria
      // para em_transito e a lojista poderia pagar a mesma devolucao outra vez.
      await mutar(
        "devolucao-em-transito-sem-aprovada",
        "public.admin_devolucao_registrar(uuid,text,text,text)",
        "    IF v_d.status <> 'aprovada' THEN\n" +
          "      RAISE EXCEPTION 'Só uma devolução aprovada pode ser marcada como enviada.' USING ERRCODE = '22023';\n" +
          "    END IF;\n",
      );
      let n = 400;
      for (const estado of ["concluida", "recebida"]) {
        await recusa(
          await fixture(estado, n),
          enviarComCodigo(null),
          /^Só uma devolução aprovada pode ser marcada como enviada\.$/,
          `enviar ${estado}`,
        );
        n += 10;
      }
      await aceita(
        await fixture("aprovada", n),
        enviarComCodigo(null),
        "aprovada",
        "em_transito",
      );
    }),
);

prova(
  "codigo de rastreio fora do formato e recusado sem escrever; o valido vira maiusculo",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      await mutar(
        "devolucao-em-transito-codigo-livre",
        "public.admin_devolucao_registrar(uuid,text,text,text)",
        "    IF v_codigo IS NOT NULL AND v_codigo !~ '^[A-Z0-9-]{5,40}$' THEN\n" +
          "      RAISE EXCEPTION 'Código de rastreio inválido.' USING ERRCODE = '22023';\n" +
          "    END IF;\n",
      );
      let n = 500;
      // curto demais, simbolo, espaco no meio e longo demais (41 caracteres).
      for (const codigo of [
        "AB-1",
        "BR!!123456",
        "BR 123 456",
        "A".repeat(41),
      ]) {
        await recusa(
          await fixture("aprovada", n),
          enviarComCodigo(codigo),
          /^Código de rastreio inválido\.$/,
          `rastreio ${codigo}`,
        );
        n += 10;
      }
      const fx = await fixture("aprovada", n);
      await aceita(
        fx,
        enviarComCodigo("  br-12345-xx "),
        "aprovada",
        "em_transito",
      );
      assert.equal(
        (
          await P.conexao().query(
            "SELECT codigo_rastreio FROM public.devolucoes WHERE id=$1",
            [fx.alvo],
          )
        ).rows[0].codigo_rastreio,
        "BR-12345-XX",
        "o codigo valido fica em maiusculo e sem as pontas",
      );
    }),
);

prova(
  "inspecao recusa motivo em branco, vazio ou nulo sem mudar linha/eventos/saldo; recebida segue recebida",
  () =>
    P.emTransacao(async () => {
      await pessoas();
      await mutar(
        "devolucao-reprova-sem-motivo",
        "public.admin_devolucao_reprovar(uuid,text)",
        "  IF v_msg IS NULL THEN\n" +
          "    RAISE EXCEPTION 'Explique ao cliente por que o produto não foi aceito.' USING ERRCODE = '22023';\n" +
          "  END IF;\n",
      );
      let n = 600;
      for (const motivo of ["   ", "", null]) {
        const fx = await fixture("recebida", n);
        await recusa(
          fx,
          reprovarComMotivo(motivo),
          /^Explique ao cliente por que o produto não foi aceito\.$/,
          `reprovar com motivo ${JSON.stringify(motivo)}`,
        );
        const alvo = (await foto(fx.pedido)).devolucoes.find(
          (d) => d.id === fx.alvo,
        );
        assert.equal(alvo.status, "recebida", "a devolucao continua recebida");
        assert.equal(alvo.mensagem_loja, null, "nenhuma mensagem foi gravada");
        n += 10;
      }
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("devolucao encerrada nao reabre");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
