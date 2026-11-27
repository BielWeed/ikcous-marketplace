// Só da bancada da lista premium (`e2e/lista-premium.vite.config.ts`): o
// cliente do Supabase de mentira. A bancada monta as telas de verdade do painel,
// e muitas delas importam `@/lib/supabase` (direto ou por um hook); aqui toda
// consulta responde na hora, da tabela abaixo, SEM rede e SEM chave nenhuma.
// O que não está na tabela devolve lista vazia.

type Resposta = {
  readonly data: unknown;
  readonly error: null;
  readonly count: number | null;
  readonly status: number;
};

// O cartão pelo app ligado, em até 12x: sem isto o "Parcelar em até" nem aparece.
const TABELAS = new Map<string, unknown>([
  [
    "config_pagamento_cartao",
    [{ credito: true, debito: true, parcelas_max: 12 }],
  ],
]);

const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";

// Um extrato curto de novembro, para o chip do Extrato não abrir em tela vazia.
const RPCS = new Map<string, unknown>([
  [
    "fin_extrato",
    [
      {
        id: "l1",
        data: "2026-11-25",
        valor: 189.9,
        tipo: "entrada",
        status: "realizado",
        origem: "venda",
        descricao: "Venda #1042",
        conta_id: BANCO,
        conta_nome: "Conta no banco",
        categoria_nome: "Vendas",
      },
      {
        id: "l2",
        data: "2026-11-24",
        valor: -45,
        tipo: "saida",
        status: "realizado",
        origem: "manual",
        descricao: "Embalagens",
        conta_id: CAIXA,
        conta_nome: "Caixa da loja",
        categoria_nome: "Embalagens",
      },
      {
        id: "l3",
        data: "2026-11-24",
        valor: 320,
        tipo: "entrada",
        status: "previsto",
        origem: "manual",
        descricao: "Pedido de atacado",
        conta_id: BANCO,
        conta_nome: "Conta no banco",
        categoria_nome: "Vendas",
      },
    ],
  ],
]);

/** Encadeia qualquer filtro (`select().eq().order()…`) e responde no `await`. */
function consulta(linhas: unknown): unknown {
  let unica = false;
  const cadeia: unknown = new Proxy(() => {}, {
    get(_alvo, nome) {
      if (typeof nome === "symbol") return undefined;
      if (nome === "then") {
        const lista = Array.isArray(linhas) ? linhas : [];
        const resposta: Resposta = {
          data: unica ? (lista[0] ?? null) : linhas,
          error: null,
          count: lista.length,
          status: 200,
        };
        const pronta = Promise.resolve(resposta);
        return pronta.then.bind(pronta);
      }
      if (nome === "single" || nome === "maybeSingle") {
        return () => {
          unica = true;
          return cadeia;
        };
      }
      return () => cadeia;
    },
  });
  return cadeia;
}

const canal = {
  on: () => canal,
  subscribe: () => canal,
  unsubscribe: async () => "ok",
  send: async () => "ok",
  track: async () => "ok",
};

export const supabase = {
  from: (tabela: string) => consulta(TABELAS.get(tabela) ?? []),
  rpc: (nome: string) => consulta(RPCS.get(nome) ?? []),
  channel: () => canal,
  removeChannel: async () => "ok",
  removeAllChannels: async () => [],
  getChannels: () => [],
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    refreshSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe() {} } },
    }),
    signOut: async () => ({ error: null }),
  },
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      remove: async () => ({ data: [], error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
    }),
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
};
