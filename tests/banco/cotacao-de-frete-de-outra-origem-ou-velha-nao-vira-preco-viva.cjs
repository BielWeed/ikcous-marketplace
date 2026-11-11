"use strict";

// So o clone descartavel de rodar-isolado.cjs. Nenhum SQL de producao muda.
// Sem cada filtro, a mesma cotacao passa e o pedido nasce: MUTANTE_R100 remove
// SOMENTE origem ou prazo de 24h do corpo VIVO. Tudo volta no ROLLBACK.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const CLIENTE = "b102f000-0000-4000-8000-000000000001";
const PRODUTO = "b102f000-0000-4000-8000-000000000010";
const CHAVE = "b102f000-0000-4000-8000-000000000020";
const ORIGEM = "38500-000";
const OUTRA_ORIGEM = "01001-000";
const DESTINO = "20000-000";
const OPCAO = "frenet-r102f";
const FN =
  "public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const ITENS = [{ product_id: PRODUTO, variant_id: null, quantity: 2 }];
const CART_HASH = `${PRODUTO}::2`;
const RECUSA =
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.";

async function mutar() {
  const nome = process.env.MUTANTE_R100;
  let trecho;
  if (nome === "cotacao-sem-filtro-de-origem") {
    trecho = `               AND regexp_replace(COALESCE(q.origin_cep, ''), '\\D', '', 'g')
                   = regexp_replace(COALESCE(v_store_config.origin_cep, ''), '\\D', '', 'g')
`;
  } else if (nome === "cotacao-sem-filtro-de-24h") {
    trecho = "               AND q.created_at > now() - interval '24 hours'\n";
  } else {
    return;
  }
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function montar() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'cliente@r102f.fixture.invalid','{}'::jsonb)",
    [CLIENTE],
  );
  await c.query(
    `INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,frete_gratis)
     VALUES ($1,'Produto ficticio',50,80,true,false)`,
    [PRODUTO],
  );
  // Mesmo preparo da prova o-frete-do-pedido-segue-a-regra-da-loja-viva:
  // nacional fora da faixa local, estrategia e revisao carimbadas validas.
  await c.query(
    `INSERT INTO public.store_config
       (id,origin_cep,local_cep_range,free_shipping_min,shipping_coverage,
        local_delivery_fee,pagamento_online)
     VALUES (1,$1,'38500000-38505000',0,'national',12.5,true)
     ON CONFLICT (id) DO UPDATE SET
       origin_cep=EXCLUDED.origin_cep,local_cep_range=EXCLUDED.local_cep_range,
       free_shipping_min=0,shipping_coverage='national',local_delivery_fee=12.5,
       pagamento_online=true`,
    [ORIGEM],
  );
  await c.query(
    `UPDATE public.store_config SET national_shipping_strategy='desligado',
       national_shipping_min=0,national_discount_type=NULL,
       national_discount_value=0,national_benefit_scope='mais_barata' WHERE id=1`,
  );
  await c.query(
    `INSERT INTO public.store_shipping_credentials (provider,credentials,updated_at)
     VALUES ('_revisao','{"revisao":"R102F"}'::jsonb,now())
     ON CONFLICT (provider) DO UPDATE SET credentials=EXCLUDED.credentials,updated_at=now()`,
  );
  await c.query("DELETE FROM public.shipping_quotes_cache");
}

async function gravarCotacao(origem) {
  await P.conexao().query(
    `INSERT INTO public.shipping_quotes_cache
       (origin_cep,destination_cep,cart_hash,options,created_at)
     VALUES ($1,$2,$3,$4::jsonb,now())`,
    [
      origem,
      DESTINO,
      CART_HASH,
      JSON.stringify([
        {
          id: OPCAO,
          price: 22,
          precoCheio: 22,
          revisaoCredenciais: "R102F",
          estrategiaNacional: {
            estrategia: "desligado",
            minimo: 0,
            tipoDesconto: null,
            valorDesconto: 0,
            alcance: "mais_barata",
          },
        },
      ]),
    ],
  );
}

async function foto() {
  return (
    await P.conexao().query(
      `SELECT (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
              (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
              (SELECT estoque FROM public.produtos WHERE id=$1) AS estoque`,
      [PRODUTO],
    )
  ).rows[0];
}

function pedir() {
  return P.tentar(
    "authenticated",
    `SELECT public.create_marketplace_order_v24(
      $1::jsonb,122::numeric,0::numeric,'online'::text,NULL::uuid,NULL::text,
      'Cliente ficticio'::text,'5539000000000'::text,NULL::text,$2::jsonb,
      $3::text,$4::text,$5::uuid) AS id`,
    [
      JSON.stringify(ITENS),
      JSON.stringify({ cep: DESTINO, rua: "Rua ficticia", numero: "1" }),
      DESTINO,
      OPCAO,
      CHAVE,
    ],
    { uid: CLIENTE },
  );
}

for (const caso of ["outra origem", "25 horas"]) {
  prova(
    `cotacao de ${caso} recusa sem efeitos; corrigir so esse campo aceita`,
    () =>
      P.emTransacao(async () => {
        await montar();
        const c = P.conexao();
        await gravarCotacao(caso === "outra origem" ? OUTRA_ORIGEM : ORIGEM);
        if (caso === "25 horas") {
          // A limpeza AFTER INSERT OR UPDATE apagaria a fixture de >2h.
          // Pausa SO esse gatilho durante o envelhecimento, no clone, e o
          // religa ANTES da RPC: o pedido roda com todos os gatilhos vivos.
          await c.query(
            "ALTER TABLE public.shipping_quotes_cache DISABLE TRIGGER shipping_quotes_cache_limpa_ao_gravar",
          );
          try {
            await c.query(
              "UPDATE public.shipping_quotes_cache SET created_at=now()-interval '25 hours'",
            );
          } finally {
            await c.query(
              "ALTER TABLE public.shipping_quotes_cache ENABLE TRIGGER shipping_quotes_cache_limpa_ao_gravar",
            );
          }
          assert.equal(
            (
              await c.query(
                "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.shipping_quotes_cache'::regclass AND tgname='shipping_quotes_cache_limpa_ao_gravar'",
              )
            ).rows[0].tgenabled,
            "O",
            "a limpeza deve estar ligada antes de chamar a RPC",
          );
        }
        const cotacoes = (
          await c.query(
            `SELECT origin_cep,destination_cep,cart_hash,
                    created_at=now()-interval '25 hours' AS tem_25h
             FROM public.shipping_quotes_cache`,
          )
        ).rows;
        assert.deepEqual(
          cotacoes,
          [
            {
              origin_cep: caso === "outra origem" ? OUTRA_ORIGEM : ORIGEM,
              destination_cep: DESTINO,
              cart_hash: CART_HASH,
              tem_25h: caso === "25 horas",
            },
          ],
          "a unica cotacao precisa existir, mesmo quando tem 25h",
        );
        const antes = await foto();
        assert.equal(antes.estoque, 80);
        await mutar();
        const recusa = await pedir();
        assert.equal(
          recusa.codigo,
          "P0001",
          `cotacao de ${caso} virou preco: o pedido nasceu sem cotacao valida`,
        );
        assert.equal(
          recusa.erro,
          RECUSA,
          "recusa deve ser por falta de cotacao valida",
        );
        assert.equal(
          recusa.detalhe,
          `Sem cotação válida nas últimas 24h para cep=20000000, opção=${OPCAO} -- ou a cotação encontrada era de OUTRO carrinho.`,
        );
        assert.deepEqual(
          await foto(),
          antes,
          "a recusa criou pedido/item ou mexeu no estoque",
        );

        // Mesmo payload e mesma linha; so a origem OU a data muda.
        if (caso === "outra origem") {
          await c.query(
            "UPDATE public.shipping_quotes_cache SET origin_cep=$1",
            [ORIGEM],
          );
        } else {
          await c.query(
            "UPDATE public.shipping_quotes_cache SET created_at=now()",
          );
        }
        const ok = await pedir();
        assert.equal(ok.codigo, undefined, ok.erro);
        assert.ok(ok.linhas[0].id, "controle precisa criar pedido");
        const pedido = (
          await c.query(
            "SELECT shipping::text,subtotal::text,total::text FROM public.marketplace_orders WHERE id=$1",
            [ok.linhas[0].id],
          )
        ).rows[0];
        assert.deepEqual(pedido, {
          shipping: "22.00",
          subtotal: "100.00",
          total: "122.00",
        });
        assert.deepEqual(
          await foto(),
          {
            pedidos: antes.pedidos + 1,
            itens: antes.itens + 1,
            estoque: 78,
          },
          "controle deve gravar pedido, item e reservar exatamente 2 unidades",
        );
      }),
  );
}

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("cotacao de outra origem ou velha nao vira preco");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
