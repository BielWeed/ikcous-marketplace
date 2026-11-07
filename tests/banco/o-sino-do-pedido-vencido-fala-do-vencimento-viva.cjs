"use strict";

/**
 * Prova VIVA da migration 20261399920000 (o sino do pedido vencido fala do vencimento: `notifica_cliente_de_mudanca_de_status`, a funcao
 * da trigger `tr_pedido_avisa_o_cliente`, no ramo `cancelled`), num Postgres EFEMERO local, sem rede, com a varredura de verdade
 * (`expirar_pedidos_vencidos`) e os papeis de verdade. Esqueleto de migration em `prova-de-troca-de-corpo.cjs` (com `aclAberta`: a funcao
 * de gatilho e' aberta por heranca do PUBLIC).
 *
 *  ANTES      controle: o corpo da 20261233000000 manda ao sino do pedido que VENCEU a frase "fale com a loja" (o defeito).
 *  DEPOIS     a varredura real (como service_role) e o UPDATE direto de payment_status 'expirado' + status 'cancelled' avisam "Prazo do pagamento
 *             terminou" com a frase da tela do pedido (inclui o aviso de quem ja pagou); retirada tambem; em dois UPDATEs (payment_status antes,
 *             status depois) tambem; qualquer OUTRO cancelamento (aguardando, pago, recusado, estornado, pago_apos_expirar, recebido_na_entrega,
 *             NULL) segue com a frase de hoje; processing/shipping/delivered (entrega e retirada) iguais com payment_status expirado e sem; o
 *             convidado segue sem aviso; cancelar de novo nao duplica; mudar so o payment_status nao avisa; a falha do aviso nao derruba o pedido.
 *  DIFEREN.   para os fluxos que nao sao "vencido", o sino de depois e' IDENTICO ao de antes.
 *  DADO       com avisos e pedidos que ja existiam (inclusive o aviso antigo de um pedido vencido), aplicar a migration nao muda NENHUMA linha de
 *             pedido nem de aviso; so as mudancas DEPOIS usam o texto novo; reaplicar e' idempotente; a trigger e' a mesma.
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA.
 *  MIGRATION  ver o esqueleto.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-sino-do-pedido-vencido-fala-do-vencimento-viva.cjs
 */

const assert = require("node:assert/strict");
const { criar } = require("./prova-de-troca-de-corpo.cjs");

const ARQ = "20261399920000_o_sino_do_pedido_vencido_fala_do_vencimento.sql";
const FN = "notifica_cliente_de_mudanca_de_status";
const SIG = "public.notifica_cliente_de_mudanca_de_status()";
const H233 = "fc8fd54a2fa1533f0d926744aab8ff58";
const H_DESTA = "dd76f4442bcb0a3b05bcede6d80fc406";

// O ramo do cancelamento como esta no corpo VIVO (o da 20261233000000), escrito a parte: o inverso devolve o corpo vivo byte a byte.
const CANCELADO_DE_ANTES =
  "            WHEN 'cancelled' THEN\n" +
  "                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
  "                VALUES (NEW.user_id, 'warning', 'Pedido cancelado',\n" +
  "                        'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',\n" +
  "                        jsonb_build_object('order_id', NEW.id));\n";
const MARCA =
  "                -- 20261399920000: o pedido que a varredura cancelou porque o prazo do pagamento terminou";
const GUARDA =
  "                IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN\n";
const FIM_DO_RAMO = "                END IF;\n";

/** Desfaz a troca (escrita a parte, do zero): do WHEN 'cancelled' novo ate o END IF do ramo, devolve o INSERT unico de antes. */
function inverso(corpo) {
  const ini = corpo.indexOf(`            WHEN 'cancelled' THEN\n${MARCA}`);
  assert.ok(ini >= 0, "a troca nao foi achada no corpo novo");
  const fim = corpo.indexOf(FIM_DO_RAMO, ini);
  assert.ok(fim > ini, "o fim do ramo nao foi achado");
  assert.ok(
    corpo.slice(ini, fim).includes(GUARDA),
    "a guarda do vencimento nao esta no ramo",
  );
  return (
    corpo.slice(0, ini) +
    CANCELADO_DE_ANTES +
    corpo.slice(fim + FIM_DO_RAMO.length)
  );
}

const ROTULO_ATRIBUTOS =
  "notifica_cliente_de_mudanca_de_status: uma assinatura so, atributos, trigger e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno trigger; tr_pedido_avisa_o_cliente AFTER UPDATE OF status por linha; EXECUTE aberto por heranca do PUBLIC)";
const ROTULO_MARCA =
  "notifica_cliente_de_mudanca_de_status: o corpo traz o aviso do pedido vencido (uma vez)";
const ESTRAGOS = [];
const T = criar({
  arq: ARQ,
  origem: {
    arquivo: "20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql",
  },
  fn: FN,
  delim: "$$",
  sig: SIG,
  hAntes: H233,
  hDepois: H_DESTA,
  volatil: "v",
  aclAberta: true,
  // A ACL de sempre no clone: as quatro concessoes de fabrica (PUBLIC, anon, authenticated, service_role) e o dono.
  aclDeSempre: [
    "=X/postgres",
    "anon=X/postgres",
    "authenticated=X/postgres",
    "postgres=X/postgres",
    "service_role=X/postgres",
  ],
  consulta: {
    a: "127a-conferir-o-sino-do-pedido-vencido-fala-do-vencimento-aplicado",
    b: "127b-antes-o-sino-do-pedido-vencido-fala-do-vencimento-base-vigente",
    rotulos: [
      "controle: funcoes de public visiveis a este papel",
      "notifica_cliente_de_mudanca_de_status: corpo exato (md5)",
      ROTULO_MARCA,
      ROTULO_ATRIBUTOS,
    ],
    fixos: [
      "controle: funcoes de public visiveis a este papel",
      ROTULO_ATRIBUTOS,
    ],
    attr: ROTULO_ATRIBUTOS,
    acl: ROTULO_ATRIBUTOS,
  },
  inverso,
  estragosDaConsulta: ESTRAGOS,
  estadosRuinsExtras: {
    // A trigger tem de estar ligada a funcao: sem ela o aviso nunca nasce, e o pre-voo recusa.
    "trigger fora do lugar (sem a trigger)": () =>
      T.C.query(
        "DROP TRIGGER tr_pedido_avisa_o_cliente ON public.marketplace_orders",
      ),
    "coluna que o corpo le ausente (payment_status)": async () => {
      // O corpo novo le payment_status: sem a coluna o PL/pgSQL so acusaria na primeira execucao. Outras views/funcoes dependem dela:
      // CASCADE dentro do savepoint do estado ruim (desfeito).
      await T.C.query(
        "ALTER TABLE public.marketplace_orders DROP COLUMN payment_status CASCADE",
      );
    },
  },
});
// Sabotagem da marca: o comentario da troca repetido (o corpo muda e a marca aparece 2x).
{
  const dup = T.NOVA.corpo.replace(MARCA, () => `${MARCA} (copia)\n${MARCA}`);
  assert.notEqual(dup, T.NOVA.corpo);
  ESTRAGOS.push([T.decl(T.NOVA, dup), ROTULO_MARCA]);
}

// ---------------------------------------------------------------------------
// Os textos, escritos por extenso: o teste NUNCA os le do arquivo da migration (senao um erro de digitacao la passaria pela prova).
// ---------------------------------------------------------------------------
const VENCIDO = [
  "warning",
  "Prazo do pagamento terminou",
  "O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.",
];
const CANCELADO = [
  "warning",
  "Pedido cancelado",
  "Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.",
];
const PREPARO = [
  "info",
  "Pedido em preparo",
  "Seu pedido já está em preparo pela loja.",
];
const A_CAMINHO = ["info", "Pedido a caminho", "Seu pedido saiu para entrega!"];
const ENTREGUE = [
  "success",
  "Pedido entregue",
  "Seu pedido foi entregue. Obrigado por comprar com a gente!",
];
const PRONTO = [
  "info",
  "Pedido pronto para retirar",
  "Seu pedido está pronto! Venha retirar na loja.",
];
const RETIRADO = [
  "success",
  "Pedido retirado",
  "Seu pedido foi retirado na loja. Obrigado por comprar com a gente!",
];
const DADOS_ENTREGA = {
  whatsapp: "(34) 99999-1234",
  shipping_option_id: "local-delivery",
};
const DADOS_RETIRADA = {
  whatsapp: "(34) 99999-1234",
  shipping_option_id: "store-pickup",
  pickup_address: "Rua da Loja, 100 - Centro",
};

// ---------------------------------------------------------------------------
// Semente: 2 clientes. Cada cenario cria o PROPRIO pedido (o sino e' lido por pedido).
// ---------------------------------------------------------------------------
const CLIENTE = "e3999200-0000-4000-8000-0000000000c1";
const OUTRA = "e3999200-0000-4000-8000-0000000000c2";

async function semear() {
  await T.C.query(
    `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
       ($1,'cliente399920@fixture.test','{}'),($2,'outra399920@fixture.test','{}')`,
    [CLIENTE, OUTRA],
  );
  await T.C.query(
    `INSERT INTO public.profiles(id,full_name,role) VALUES
       ($1,'Cliente fixture','customer'),($2,'Outra fixture','customer')`,
    [CLIENTE, OUTRA],
  );
}

/** Pedido novo. `vencidoHa`: minutos que o prazo (expires_at) ja passou (para a varredura real). */
async function pedido({
  usuario = CLIENTE,
  status = "pending",
  pagamento = "aguardando",
  dados = DADOS_ENTREGA,
  vencidoHa = null,
  metodo = null,
  vaga = null,
} = {}) {
  const r = await T.C.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status,
        expires_at, metodo_online, gateway_payment_id)
     VALUES ($1, 'Cliente Sino 3999', $2::jsonb, 100, 100, $3, 'online', 'online', $4,
             CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(mins => $5::int) END, $6, $7)
     RETURNING id`,
    [
      usuario,
      JSON.stringify(dados),
      status,
      pagamento,
      vencidoHa,
      metodo,
      vaga,
    ],
  );
  return r.rows[0].id;
}
const mudar = (id, status) =>
  T.C.query("UPDATE public.marketplace_orders SET status = $2 WHERE id = $1", [
    id,
    status,
  ]);
const mudarJunto = (id, status, pagamento) =>
  T.C.query(
    "UPDATE public.marketplace_orders SET status = $2, payment_status = $3 WHERE id = $1",
    [id, status, pagamento],
  );

/** O sino do pedido, na ordem de nascimento: [tipo, titulo, mensagem]. */
async function sino(id) {
  const r = await T.C.query(
    `SELECT tipo, titulo, mensagem FROM public.notificacoes
      WHERE dados->>'order_id' = $1 ORDER BY created_at, ctid`,
    [id],
  );
  return r.rows.map((l) => [l.tipo, l.titulo, l.mensagem]);
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Compara o sino de um pedido com o esperado; devolve a falha com o prefixo da verificacao. */
async function conferir(falhas, prefixo, id, esperado) {
  const vivo = await sino(id);
  if (!igual(vivo, esperado))
    falhas.push(
      `${prefixo}: ${JSON.stringify(vivo.map((l) => l[1]))} (esperado ${JSON.stringify(esperado.map((l) => l[1]))})`,
    );
}

const CHECKS = {
  /** A varredura REAL (service_role, o papel do agendador) cancela o pedido vencido e o sino diz o prazo. */
  async varredura() {
    const f = [];
    const pix = await pedido({
      vencidoHa: 60,
      metodo: "pix",
      vaga: "ORD-3999-1",
    });
    const semCobranca = await pedido({ vencidoHa: 60 });
    const retirada = await pedido({ vencidoHa: 60, dados: DADOS_RETIRADA });
    const vivo = await pedido({ vencidoHa: -30 }); // o prazo ainda nao passou: a varredura nao toca
    await T.C.query("SAVEPOINT varre");
    let n;
    try {
      await T.C.query("SET LOCAL ROLE service_role");
      n = (await T.C.query("SELECT public.expirar_pedidos_vencidos() AS n"))
        .rows[0].n;
    } finally {
      await T.C.query("RESET ROLE");
    }
    await T.C.query("RELEASE SAVEPOINT varre");
    if (Number(n) !== 3) f.push(`varredura: cancelou ${n} (esperado 3)`);
    for (const [nome, id] of [
      ["PIX com vaga", pix],
      ["sem cobranca", semCobranca],
      ["retirada", retirada],
    ]) {
      const o = (
        await T.C.query(
          "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (o.status !== "cancelled" || o.payment_status !== "expirado")
        f.push(`varredura(${nome}): pedido ${JSON.stringify(o)}`);
      await conferir(f, `varredura(${nome})`, id, [VENCIDO]);
    }
    await conferir(f, "varredura(prazo nao passou)", vivo, []);
    return f;
  },
  /** O UPDATE direto: os dois campos juntos, ou o payment_status ANTES e o status depois, avisa o vencimento. */
  async vencidoDireto() {
    const f = [];
    const junto = await pedido();
    await mudarJunto(junto, "cancelled", "expirado");
    await conferir(f, "vencidoDireto(junto)", junto, [VENCIDO]);
    const separado = await pedido();
    await T.C.query(
      "UPDATE public.marketplace_orders SET payment_status = 'expirado' WHERE id = $1",
      [separado],
    );
    await conferir(f, "vencidoDireto(so o pagamento: nao avisa)", separado, []);
    await mudar(separado, "cancelled");
    await conferir(f, "vencidoDireto(status depois)", separado, [VENCIDO]);
    const retirada = await pedido({ dados: DADOS_RETIRADA });
    await mudarJunto(retirada, "cancelled", "expirado");
    await conferir(f, "vencidoDireto(retirada)", retirada, [VENCIDO]);
    const andou = await pedido();
    await mudar(andou, "processing");
    await mudarJunto(andou, "cancelled", "expirado");
    await conferir(f, "vencidoDireto(depois do preparo)", andou, [
      PREPARO,
      VENCIDO,
    ]);
    return f;
  },
  /** QUALQUER outro cancelamento segue com a frase de hoje (a cliente, a lojista, recusa, estorno, pago, sem pagamento). */
  async outrosCancelamentos() {
    const f = [];
    for (const pagamento of [
      "aguardando",
      "pago",
      "recusado",
      "estornado",
      "pago_apos_expirar",
      "recebido_na_entrega",
      null,
    ]) {
      const id = await pedido({ pagamento });
      await mudar(id, "cancelled");
      await conferir(f, `outrosCancelamentos(${pagamento ?? "NULL"})`, id, [
        CANCELADO,
      ]);
    }
    // Cancelado no meio do caminho, nos dois tipos de pedido
    for (const dados of [DADOS_ENTREGA, DADOS_RETIRADA]) {
      const id = await pedido({ pagamento: "pago", dados });
      await mudar(id, "processing");
      await mudar(id, "cancelled");
      await conferir(
        f,
        `outrosCancelamentos(${dados.shipping_option_id}, no preparo)`,
        id,
        [PREPARO, CANCELADO],
      );
    }
    // O pedido que foi vencido, pago tarde (pago_apos_expirar) e depois cancelado pela lojista: a frase do cancelamento comum.
    const tarde = await pedido();
    await mudarJunto(tarde, "cancelled", "expirado");
    await mudarJunto(tarde, "processing", "pago_apos_expirar");
    await mudar(tarde, "cancelled");
    // A trigger irma do PAGAMENTO (20261027) avisa "Pagamento recebido apos o cancelamento" na virada para pago_apos_expirar: outro sino, fora
    // desta prova; aqui so os avisos do STATUS.
    const doStatus = (await sino(tarde)).filter(
      (l) => l[1] !== "Pagamento recebido após o cancelamento",
    );
    if (!igual(doStatus, [VENCIDO, PREPARO, CANCELADO]))
      f.push(
        `outrosCancelamentos(pago tarde e cancelado): ${JSON.stringify(doStatus.map((l) => l[1]))}`,
      );
    return f;
  },
  /** Os outros status nao mudam, com ou sem payment_status 'expirado' (entrega e retirada). */
  async restoIgual() {
    const f = [];
    for (const pagamento of ["expirado", "pago", "aguardando", null]) {
      const e = await pedido({ pagamento, dados: DADOS_ENTREGA });
      for (const s of ["processing", "shipping", "delivered"])
        await mudar(e, s);
      await conferir(f, `restoIgual(entrega, ${pagamento ?? "NULL"})`, e, [
        PREPARO,
        A_CAMINHO,
        ENTREGUE,
      ]);
      const r = await pedido({ pagamento, dados: DADOS_RETIRADA });
      for (const s of ["processing", "shipping", "delivered"])
        await mudar(r, s);
      await conferir(f, `restoIgual(retirada, ${pagamento ?? "NULL"})`, r, [
        PREPARO,
        PRONTO,
        RETIRADO,
      ]);
    }
    return f;
  },
  /** Convidado sem aviso, cancelar de novo nao duplica, outro status sem frase nao inventa aviso. */
  async guardas() {
    const f = [];
    const convidado = await pedido({ usuario: null });
    await mudarJunto(convidado, "cancelled", "expirado");
    const nConv = (
      await T.C.query(
        "SELECT count(*)::int AS n FROM public.notificacoes WHERE dados->>'order_id' = $1",
        [convidado],
      )
    ).rows[0].n;
    if (nConv !== 0) f.push(`guardas(convidado): ${nConv} avisos (esperado 0)`);
    const duas = await pedido();
    await mudarJunto(duas, "cancelled", "expirado");
    await mudar(duas, "cancelled");
    await mudarJunto(duas, "cancelled", "expirado");
    await conferir(f, "guardas(cancelar de novo)", duas, [VENCIDO]);
    const outra = await pedido({ usuario: OUTRA });
    await mudarJunto(outra, "cancelled", "expirado");
    const dono = (
      await T.C.query(
        "SELECT usuario_id FROM public.notificacoes WHERE dados->>'order_id' = $1",
        [outra],
      )
    ).rows.map((l) => l.usuario_id);
    if (!igual(dono, [OUTRA])) f.push(`guardas(dono do aviso): ${dono}`);
    const pend = await pedido();
    await mudarJunto(pend, "pending", "expirado");
    await conferir(f, "guardas(pending nao inventa aviso)", pend, []);
    return f;
  },
  /** O aviso e' best-effort: se ele nao consegue nascer, o pedido cancela do mesmo jeito (so loga). */
  async melhorEsforco() {
    const f = [];
    await T.C.query(
      "ALTER TABLE public.notificacoes ADD CONSTRAINT sino_3999_recusa CHECK (false) NOT VALID",
    );
    const id = await pedido();
    await mudarJunto(id, "cancelled", "expirado");
    const o = (
      await T.C.query(
        "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
        [id],
      )
    ).rows[0];
    if (o.status !== "cancelled" || o.payment_status !== "expirado")
      f.push(`melhorEsforco: o pedido nao cancelou (${JSON.stringify(o)})`);
    return f;
  },
};

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------
T.prova(
  "ANTES: com o corpo antigo (o da 20261233000000, byte a byte) o pedido que VENCEU sozinho manda ao sino 'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.' (o defeito); o cancelamento comum e o resto ja eram assim",
  () =>
    T.emTransacao(async () => {
      assert.equal(await T.prosrcVivo(), T.ANTIGA.corpo);
      await semear();
      const venceu = await pedido({
        vencidoHa: 60,
        metodo: "pix",
        vaga: "ORD-3999-0",
      });
      await T.C.query("SET LOCAL ROLE service_role");
      await T.C.query("SELECT public.expirar_pedidos_vencidos()");
      await T.C.query("RESET ROLE");
      assert.deepEqual(
        await sino(venceu),
        [CANCELADO],
        "o defeito sumiu sozinho?",
      );
      const comum = await pedido();
      await mudar(comum, "cancelled");
      assert.deepEqual(await sino(comum), [CANCELADO]);
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------
T.prova(
  "DEPOIS: a varredura real e o UPDATE direto avisam o vencimento (entrega e retirada, juntos ou em dois UPDATEs); qualquer outro cancelamento segue com a frase de hoje; os outros status, o convidado, o cancelar de novo e a falha do aviso seguem",
  async () => {
    const falhas = await T.todasAsVerificacoes(CHECKS, T.instalarNova, semear);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

T.prova(
  "DIFERENCIAL: para todo fluxo que NAO e 'cancelado com pagamento expirado' (todos os status, pagamentos, entrega e retirada, convidado, cancelar no meio, de novo), o sino de depois e' IDENTICO ao de antes",
  async () => {
    const roteiro = async () => {
      await semear();
      const saidas = [];
      for (const pagamento of [
        "aguardando",
        "pago",
        "recusado",
        "estornado",
        "pago_apos_expirar",
        "recebido_na_entrega",
        null,
      ])
        for (const dados of [DADOS_ENTREGA, DADOS_RETIRADA, {}])
          for (const caminho of [
            ["processing", "shipping", "delivered"],
            ["processing", "cancelled"],
            ["cancelled"],
            ["shipping", "cancelled", "cancelled"],
            ["delivered"],
          ]) {
            const id = await pedido({ pagamento, dados });
            for (const s of caminho) await mudar(id, s);
            saidas.push(await sino(id));
          }
      const convidado = await pedido({ usuario: null });
      await mudar(convidado, "cancelled");
      saidas.push(await sino(convidado));
      // Pagamento expirado mas o status NAO vira cancelled: igual ao de antes.
      for (const caminho of [["processing"], ["shipping"], ["delivered"]]) {
        const id = await pedido({ pagamento: "expirado" });
        for (const s of caminho) await mudar(id, s);
        saidas.push(await sino(id));
      }
      return saidas;
    };
    const antes = await T.emTransacao(roteiro, { estado: "antes" });
    const depois = await T.emTransacao(roteiro, { estado: "depois" });
    assert.deepEqual(
      depois,
      antes,
      "o sino mudou para um fluxo que nao e' o do pedido vencido",
    );
    assert.ok(antes.length > 100, "o roteiro ficou pequeno demais");
  },
);

// ---------------------------------------------------------------------------
// DADO EXISTENTE: nada que ja estava no banco muda ao aplicar
// ---------------------------------------------------------------------------
T.prova(
  "DADO EXISTENTE: com pedidos e avisos que ja existiam (inclusive o aviso antigo de um pedido vencido), aplicar a migration (1x, 2x e em CRLF) nao muda NENHUMA linha de pedido nem de aviso; a trigger e' a mesma; so a mudanca DEPOIS usa o texto novo",
  () =>
    T.emTransacao(async () => {
      await semear();
      const venceu = await pedido({
        vencidoHa: 60,
        metodo: "pix",
        vaga: "ORD-3999-9",
      });
      await T.C.query("SET LOCAL ROLE service_role");
      await T.C.query("SELECT public.expirar_pedidos_vencidos()");
      await T.C.query("RESET ROLE");
      const andando = await pedido({ pagamento: "pago" });
      await mudar(andando, "processing");
      const vivo = await pedido();
      assert.deepEqual(await sino(venceu), [CANCELADO]);
      const foto = async () => ({
        pedidos: (
          await T.C.query(
            "SELECT md5(coalesce(string_agg(o::text, '|' ORDER BY o.id), '')) AS h, count(*)::int AS n FROM public.marketplace_orders o",
          )
        ).rows[0],
        avisos: (
          await T.C.query(
            "SELECT md5(coalesce(string_agg(n::text, '|' ORDER BY n.id), '')) AS h, count(*)::int AS n FROM public.notificacoes n",
          )
        ).rows[0],
        trigger: (
          await T.C.query(
            `SELECT t.oid::text, t.tgname, t.tgfoid::regproc::text, t.tgtype, t.tgattr::text, t.tgenabled::text
               FROM pg_trigger t WHERE t.tgname = 'tr_pedido_avisa_o_cliente'`,
          )
        ).rows,
      });
      const antes = await foto();
      assert.equal(antes.trigger.length, 1);
      assert.equal(await T.aplicar(T.MIGRATION), null);
      assert.deepEqual(
        await foto(),
        antes,
        "aplicar mexeu em pedido, aviso ou trigger",
      );
      assert.equal(await T.aplicar(T.MIGRATION), null);
      assert.equal(await T.aplicar(T.emCRLF(T.MIGRATION)), null);
      assert.deepEqual(
        await foto(),
        antes,
        "reaplicar mexeu em pedido, aviso ou trigger",
      );
      // O aviso antigo FICA; so a mudanca depois usa o texto novo.
      assert.deepEqual(await sino(venceu), [CANCELADO]);
      await mudarJunto(vivo, "cancelled", "expirado");
      assert.deepEqual(await sino(vivo), [VENCIDO]);
      await mudar(andando, "cancelled");
      assert.deepEqual(await sino(andando), [PREPARO, CANCELADO]);
    }),
);

// ---------------------------------------------------------------------------
// A consulta do lote ANTERIOR (34a, sino da retirada) aceita o corpo desta migration como sucessor, e continua recusando corpo desconhecido
// ---------------------------------------------------------------------------
T.prova(
  "SUCESSORA: a 34a (o sino da retirada) fica POSITIVA nas sete linhas tanto com o corpo da 20261233000000 quanto com o desta migration, e reprova SO a linha do corpo com 1 byte a mais",
  async () => {
    const consulta34a = T.lerConsulta("34a-conferir-sino-da-retirada-aplicado");
    const rodar = async (estado, sabotar) =>
      T.emTransacao(
        async () => {
          if (sabotar) await T.C.query(sabotar);
          return (await T.C.query(consulta34a)).rows;
        },
        { estado },
      );
    for (const estado of ["antes", "depois"]) {
      const linhas = await rodar(estado);
      assert.equal(linhas.length, 7);
      assert.deepEqual(
        linhas.filter((l) => !l.ok),
        [],
        `34a ${estado}: ${JSON.stringify(linhas.filter((l) => !l.ok))}`,
      );
    }
    const mexido = await rodar(
      "depois",
      T.decl(
        T.NOVA,
        `${T.NOVA.corpo}
-- um byte a mais
`,
      ),
    );
    assert.deepEqual(
      mexido.filter((l) => !l.ok).map((l) => l.item),
      [
        "notifica_cliente_de_mudanca_de_status: corpo e o da 20261233000000, com o texto da retirada (md5)",
      ],
    );
  },
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------
const trocar = (de, para) => (corpo) => {
  assert.equal(
    corpo.split(de).length - 1,
    1,
    `a ancora do mutante nao e' unica: ${de}`,
  );
  return corpo.replace(de, () => para);
};
const FRASE_VENCIDO =
  "O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.";
T.mutantes(
  {
    "sem a troca (o corpo antigo)": {
      aplica: (corpo) => inverso(corpo),
      vermelho: ["varredura(", "vencidoDireto("],
    },
    "a guarda ao contrario (IS DISTINCT FROM)": {
      aplica: trocar(
        "IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
        "IF NEW.payment_status IS DISTINCT FROM 'expirado' THEN",
      ),
      vermelho: ["varredura(", "outrosCancelamentos("],
    },
    "toda recusa de pagamento vira vencimento (pagamento diferente de pago)": {
      aplica: trocar(
        "IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
        "IF COALESCE(NEW.payment_status, '') <> 'pago' THEN",
      ),
      vermelho: ["outrosCancelamentos("],
    },
    "o pagamento NULL conta como vencido": {
      aplica: trocar(
        "IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
        "IF COALESCE(NEW.payment_status, 'expirado') = 'expirado' THEN",
      ),
      vermelho: ["outrosCancelamentos(NULL)"],
    },
    "a guarda le o pagamento de ANTES do UPDATE (OLD)": {
      aplica: trocar(
        "IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
        "IF OLD.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
      ),
      vermelho: ["varredura(", "vencidoDireto(junto)"],
    },
    "todo cancelamento vira vencimento (a guarda sempre verdadeira)": {
      aplica: trocar(
        "IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
        "IF true THEN",
      ),
      vermelho: ["outrosCancelamentos("],
    },
    "nenhum cancelamento vira vencimento (a guarda sempre falsa)": {
      aplica: trocar(
        "IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN",
        "IF false THEN",
      ),
      vermelho: ["varredura(", "vencidoDireto("],
    },
    "o cancelamento comum fica sem aviso (o ELSE some)": {
      aplica: trocar(
        "                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
          "                    VALUES (NEW.user_id, 'warning', 'Pedido cancelado',\n" +
          "                            'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',\n" +
          "                            jsonb_build_object('order_id', NEW.id));\n",
        "                    NULL;\n",
      ),
      vermelho: ["outrosCancelamentos("],
    },
    "o aviso de quem ja pagou sai da frase (mandaria pagar duas vezes)": {
      aplica: trocar(
        FRASE_VENCIDO,
        "O prazo do pagamento terminou e o pedido foi cancelado. Se não pagou, é só comprar de novo.",
      ),
      vermelho: ["varredura(", "vencidoDireto("],
    },
    "o titulo do vencimento volta a ser 'Pedido cancelado'": {
      aplica: trocar("'Prazo do pagamento terminou'", "'Pedido cancelado'"),
      vermelho: ["varredura(", "vencidoDireto("],
    },
    "o vencimento nasce com o tipo errado (info)": {
      aplica: trocar(
        "VALUES (NEW.user_id, 'warning', 'Prazo do pagamento terminou',",
        "VALUES (NEW.user_id, 'info', 'Prazo do pagamento terminou',",
      ),
      vermelho: ["varredura(", "vencidoDireto("],
    },
    "o vencimento perde o order_id do aviso": {
      aplica: trocar(
        "                            'O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.',\n                            jsonb_build_object('order_id', NEW.id));",
        "                            'O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.',\n                            jsonb_build_object('pedido', NEW.id));",
      ),
      vermelho: ["varredura(", "vencidoDireto("],
    },
    "a retirada perde o texto de retirada (pedido pronto)": {
      aplica: trocar("'Pedido pronto para retirar'", "'Pedido a caminho'"),
      vermelho: ["restoIgual("],
    },
    "o convidado passa a receber aviso (a guarda do usuario some)": {
      aplica: trocar(
        "    IF NEW.user_id IS NULL THEN\n        RETURN NEW;\n    END IF;\n",
        "",
      ),
      vermelho: ["guardas(convidado)"],
    },
    "o aviso derruba o pedido quando falha (o bloco best-effort some)": {
      aplica: (corpo) => {
        const mutado = corpo.replace(
          "    EXCEPTION WHEN OTHERS THEN\n",
          "    EXCEPTION WHEN no_data_found THEN\n",
        );
        assert.notEqual(mutado, corpo);
        return mutado;
      },
      vermelho: ["melhorEsforco"],
    },
  },
  CHECKS,
  semear,
);

T.main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
