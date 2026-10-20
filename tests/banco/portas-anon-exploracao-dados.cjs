"use strict";

/**
 * A5b — O QUE UM ESTRANHO LÊ E ESCREVE DE DADO PESSOAL (auditoria de pagamento e
 * segurança, 10/10/2026). MEDIÇÃO, não portão: sempre sai 0 e imprime uma linha
 * `PORTA <recurso> -> escreveu|vazou|recusou|executou|inconclusivo|AUSENTE
 * <detalhe>` por caso. O motor e o significado de cada veredito estão em
 * portas-anon-exploracao-comum.cjs.
 *
 * Cada função é chamada, no banco efêmero e numa transação desfeita, como o
 * visitante sem login (`anon`) com o EXECUTE reaberto de propósito (reproduz um
 * banco restaurado sem as permissões). Os dados são SINTÉTICOS e criados aqui
 * (CPF, e-mail, telefone, custo, fornecedor): nenhum dado real é lido. Cobre:
 * get_orders_by_whatsapp_v3 (o CPF do pedido sai?), get_my_cpf e set_my_cpf,
 * check_user_confirmation_status (descobre se um e-mail tem conta), a
 * get_active_products_internal e a vw_produtos_admin (custo e fornecedor), quantas
 * linhas de public_profiles o visitante vê e a escrita em v_store_config (A-7).
 * Vira teste de regressão das correções B3/B5.
 *
 * USO (no rpc-ci.yml, depois das migrations):
 *   node tests/banco/rodar-isolado.cjs tests/banco/portas-anon-exploracao-dados.cjs
 */

const {
  P_PRODUTO,
  U_CLIENTE,
  U_VITIMA,
  chamar,
  pedidoSintetico,
  rodar,
  umaLinha,
} = require("./portas-anon-exploracao-comum.cjs");

// CPF de teste conhecido (passa nos dígitos verificadores, não é de ninguém).
const CPF_SENTINELA = "52998224725";
const CPF_VALIDO_PARA_GRAVAR = "11144477735";
const EMAIL_VITIMA = "vitima.sintetica@teste.invalid";
const FONE_VITIMA = "5539999990001";
const CUSTO_SENTINELA = "7777.77";
const CUSTO_OCULTO = "5555.55";
const FORNECEDOR_SENTINELA = "a5ffffff-0000-4000-8000-000000000001";

const CASOS = [
  {
    porta:
      "get_orders_by_whatsapp_v3 (só e-mail + telefone + 6 caracteres do pedido)",
    assinatura: "public.get_orders_by_whatsapp_v3(text,text,text)",
    leitura: true,
    preparar: async (c) => {
      await c.query("UPDATE auth.users SET phone = $2 WHERE id = $1", [
        U_VITIMA,
        FONE_VITIMA,
      ]);
      const p = await pedidoSintetico(c, {
        userId: U_VITIMA,
        nome: "Vitima Sintetica Pedido",
        telefone: FONE_VITIMA,
        dados: {
          cpf: CPF_SENTINELA,
          email: EMAIL_VITIMA,
          address: { cep: "38500-000", rua: "Rua Sintetica da Vitima" },
        },
      });
      return { fragmento: p.id.slice(-8) };
    },
    controle: chamar(
      "service",
      "SELECT * FROM public.get_orders_by_whatsapp_v3($1, $2, $3)",
      (ctx) => [FONE_VITIMA, EMAIL_VITIMA, ctx.fragmento],
    ),
    ataque: chamar(
      "anon",
      "SELECT * FROM public.get_orders_by_whatsapp_v3($1, $2, $3)",
      (ctx) => [FONE_VITIMA, EMAIL_VITIMA, ctx.fragmento],
    ),
    marcadores: () => [
      CPF_SENTINELA,
      "Vitima Sintetica Pedido",
      "Rua Sintetica da Vitima",
    ],
  },
  {
    porta: "get_my_cpf (sem sessão)",
    assinatura: "public.get_my_cpf()",
    leitura: true,
    preparar: async (c) => {
      await c.query("UPDATE public.profiles SET cpf = $2 WHERE id = $1", [
        U_CLIENTE,
        CPF_SENTINELA,
      ]);
      return {};
    },
    controle: chamar("cliente", "SELECT public.get_my_cpf() AS r"),
    ataque: chamar("anon", "SELECT public.get_my_cpf() AS r"),
    marcadores: () => [CPF_SENTINELA],
  },
  {
    porta: "set_my_cpf (sem sessão)",
    assinatura: "public.set_my_cpf(text)",
    preparar: async () => ({}),
    controle: chamar("cliente", "SELECT public.set_my_cpf($1)", [
      CPF_VALIDO_PARA_GRAVAR,
    ]),
    ataque: chamar("anon", "SELECT public.set_my_cpf($1)", [
      CPF_VALIDO_PARA_GRAVAR,
    ]),
    observar: async (c) => {
      const r = await umaLinha(
        c,
        "SELECT count(*) FILTER (WHERE cpf IS NOT NULL) AS com_cpf FROM public.profiles",
      );
      return `perfis_com_cpf=${r.com_cpf}`;
    },
  },
  {
    porta: "check_user_confirmation_status (o e-mail tem conta?)",
    assinatura: "public.check_user_confirmation_status(text)",
    leitura: true,
    preparar: async () => ({}),
    controle: chamar(
      "service",
      "SELECT public.check_user_confirmation_status($1) AS r",
      [EMAIL_VITIMA],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.check_user_confirmation_status($1) AS r",
      [EMAIL_VITIMA],
    ),
    vazouSe: (dados) => {
      const r = dados?.[0]?.r;
      return r && r.exists === true
        ? `oráculo de conta: o e-mail existe (exists=true, confirmed=${r.confirmed})`
        : null;
    },
  },
  {
    porta: "get_active_products_internal (custo e fornecedor dos produtos)",
    assinatura: "public.get_active_products_internal()",
    leitura: true,
    preparar: async (c) => {
      await c.query(
        "UPDATE public.produtos SET custo = $2, fornecedor_id = $3 WHERE id = $1",
        [P_PRODUTO, CUSTO_SENTINELA, FORNECEDOR_SENTINELA],
      );
      return {};
    },
    controle: chamar(
      "service",
      "SELECT * FROM public.get_active_products_internal()",
    ),
    ataque: chamar(
      "anon",
      "SELECT * FROM public.get_active_products_internal()",
    ),
    marcadores: () => [CUSTO_SENTINELA, FORNECEDOR_SENTINELA],
  },
  {
    porta:
      "SELECT em vw_produtos_admin (view sem security_invoker; custo, fornecedor, produto inativo)",
    leitura: true,
    preparar: async (c) => {
      await c.query(
        "UPDATE public.produtos SET custo = $2, fornecedor_id = $3 WHERE id = $1",
        [P_PRODUTO, CUSTO_SENTINELA, FORNECEDOR_SENTINELA],
      );
      await c.query(
        `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
         VALUES ('a5aaaaaa-0000-4000-8000-000000000002', 'Produto Oculto Sintetico', $1, 80, 5, false)`,
        [CUSTO_OCULTO],
      );
      return {};
    },
    controle: chamar(
      "admin",
      "SELECT id, nome, custo, fornecedor_id, ativo FROM public.vw_produtos_admin",
    ),
    ataque: chamar(
      "anon",
      "SELECT id, nome, custo, fornecedor_id, ativo FROM public.vw_produtos_admin",
    ),
    marcadores: () => [
      CUSTO_SENTINELA,
      CUSTO_OCULTO,
      FORNECEDOR_SENTINELA,
      "Produto Oculto Sintetico",
    ],
  },
  {
    porta:
      "SELECT em produtos (a tabela de baixo, como contraste da vw_produtos_admin)",
    leitura: true,
    preparar: async (c) => {
      await c.query("UPDATE public.produtos SET custo = $2 WHERE id = $1", [
        P_PRODUTO,
        CUSTO_SENTINELA,
      ]);
      return {};
    },
    // O controle lê só colunas que o admin pode ler (a coluna `custo` não é do
    // authenticated: é por isso que o painel usa a view); o ataque pede o custo.
    controle: chamar(
      "admin",
      "SELECT id, nome, preco_venda FROM public.produtos",
    ),
    ataque: chamar("anon", "SELECT id, nome, custo FROM public.produtos"),
    marcadores: () => [CUSTO_SENTINELA],
  },
  {
    porta: "SELECT em public_profiles (quantos perfis o visitante vê)",
    leitura: true,
    preparar: async (c) => {
      // Só a cliente escreveu algo na vitrine (uma avaliação). A vítima e o admin
      // nunca avaliaram nem perguntaram nada.
      await c.query(
        `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
         VALUES ($1, $2, 5, 'avaliacao sintetica', 'publicada')`,
        [P_PRODUTO, U_CLIENTE],
      );
      const r = await umaLinha(
        c,
        `SELECT (SELECT count(*) FROM public.profiles) AS perfis,
                (SELECT count(DISTINCT user_id) FROM (
                   SELECT user_id FROM public.reviews WHERE status = 'publicada'
                   UNION ALL SELECT user_id FROM public.questions) a) AS autores`,
      );
      return { perfis: Number(r.perfis), autores: Number(r.autores) };
    },
    controle: chamar(
      "admin",
      "SELECT id, full_name, avatar_url FROM public.public_profiles",
    ),
    ataque: chamar(
      "anon",
      "SELECT id, full_name, avatar_url FROM public.public_profiles",
    ),
    vazouSe: (dados, ctx) =>
      dados.length > ctx.autores
        ? `o anônimo lê ${dados.length} de ${ctx.perfis} perfis (nome e foto), mas só ${ctx.autores} escreveu algo na vitrine`
        : null,
  },
  {
    porta: "UPDATE em v_store_config (escrita pela view, sem sessão) — A-7",
    dml: true,
    preparar: async () => ({}),
    controle: chamar(
      "admin",
      "UPDATE public.v_store_config SET share_text = 'ALTERADO-SINTETICO' WHERE id = 1",
    ),
    ataque: chamar(
      "anon",
      "UPDATE public.v_store_config SET share_text = 'ALTERADO-SINTETICO' WHERE id = 1",
    ),
    observar: async (c) => {
      const r = await umaLinha(
        c,
        "SELECT COALESCE(share_text, '(nulo)') AS t FROM public.store_config WHERE id = 1",
      );
      return `share_text_da_loja=${r.t}`;
    },
  },
];

rodar("dados pessoais", CASOS).catch((erro) => {
  console.log(`[dados pessoais] ERRO DA MEDIÇÃO: ${erro.message}`);
  process.exitCode = 0;
});
