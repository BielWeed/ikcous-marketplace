/**
 * Duas guardas de DINHEIRO da fila de devolucoes do cron, ambas sem prova ate
 * aqui (achados 1 e 2 da onda 119):
 *
 *  1. MARCA (solicitado -> em_processamento): e a trava entre o cron e o clique
 *     do lojista. Se o UPDATE condicional da marca devolve 0 linhas, o clique ja
 *     pegou a linha e o cron NAO pode chamar o MP, autorizar POST nem concluir.
 *     Mutante a derrubar: apagar `if (!Array.isArray(marcada) || marcada.length === 0)`.
 *
 *  2. `p_mp_refund_id`: o MP aprovou a devolucao mas a resposta nao trouxe o id
 *     do refund. O id vazio TEM de chegar a `concluir_estorno` como NULL (para o
 *     COALESCE da RPC preservar o id que a linha ja tinha), nunca como ''.
 *     Mutante a derrubar: trocar `|| null` por `?? ''`.
 *
 * Handler e executor REAIS; so banco e HTTP sao dubles (sem rede, sem banco).
 * O dublê de banco TEM ESTADO e aplica os filtros que a producao passa (copiado
 * do minimo de `index_fila_de_estornos_filtros_test.ts`): a corrida da marca e
 * REAL (o clique muda o status da linha depois que o cron leu a fila), nao um
 * `[]` plantado na resposta do UPDATE. Dados inventados; nenhum segredo.
 */
import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

type Linha = Record<string, unknown>;
type Resultado = { data: Linha[]; error: null };
type Rota = { metodo: string; trecho: string; status: number; corpo: unknown };

const SEGREDO = "segredo-ficticio-marca-e-refund-id";
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-ficticio-marca-e-refund-id");

function comparavel(linha: Linha, coluna: string): string | number {
  const valor = Reflect.get(linha, coluna);
  return typeof valor === "number" || typeof valor === "string" ? valor : "";
}

/** Consulta com estado: aplica os argumentos que a producao passou. */
function consulta(
  linhas: Linha[],
  aoExecutar: (selecionadas: Linha[]) => void = () => {},
  valores?: Linha,
) {
  let selecionadas = [...linhas];
  let colunas = "*";
  let limite = Infinity;
  const criterios: Array<{ coluna: string; ascendente: boolean }> = [];
  const executar = (): Resultado => {
    selecionadas.sort((a, b) => {
      for (const { coluna, ascendente } of criterios) {
        const va = comparavel(a, coluna);
        const vb = comparavel(b, coluna);
        if (va < vb) return ascendente ? -1 : 1;
        if (va > vb) return ascendente ? 1 : -1;
      }
      return 0;
    });
    const lote = selecionadas.slice(0, limite);
    aoExecutar(lote);
    if (valores) {
      for (const linha of lote) Object.assign(linha, valores);
    }
    const nomes = colunas.split(",").map((nome) => nome.trim());
    return {
      data: lote.map((linha) => colunas === "*"
        ? { ...linha }
        : Object.fromEntries(Object.entries(linha).filter(([nome]) => nomes.includes(nome)))),
      error: null,
    };
  };
  const q = {
    select(novasColunas = "*") { colunas = novasColunas; return q; },
    eq(coluna: string, valor: unknown) {
      selecionadas = selecionadas.filter((linha) => Reflect.get(linha, coluna) === valor);
      return q;
    },
    in(coluna: string, valoresAceitos: unknown[]) {
      selecionadas = selecionadas.filter((linha) => valoresAceitos.includes(Reflect.get(linha, coluna)));
      return q;
    },
    neq(coluna: string, valor: unknown) {
      selecionadas = selecionadas.filter((linha) => Reflect.get(linha, coluna) !== valor);
      return q;
    },
    lt(coluna: string, limiteExclusivo: string) {
      selecionadas = selecionadas.filter((linha) => comparavel(linha, coluna) < limiteExclusivo);
      return q;
    },
    gte(coluna: string, minimo: string) {
      selecionadas = selecionadas.filter((linha) => comparavel(linha, coluna) >= minimo);
      return q;
    },
    not(coluna: string, operador: string, valor: unknown) {
      assertEquals(operador, "is");
      return q.neq(coluna, valor);
    },
    order(coluna: string, opcoes?: { ascending?: boolean }) {
      criterios.push({ coluna, ascendente: opcoes?.ascending ?? true });
      return q;
    },
    limit(n: number) { limite = n; return q; },
    maybeSingle() {
      const resultado = executar();
      return Promise.resolve({ data: resultado.data[0] ?? null, error: null });
    },
    then(resolver: (resultado: Resultado) => unknown, rejeitar?: (erro: unknown) => unknown) {
      return Promise.resolve().then(executar).then(resolver, rejeitar);
    },
  };
  return q;
}

const AGORA = Date.now();
const CINCO_MIN = 5 * 60 * 1000;
const UM_DIA = 24 * 60 * 60 * 1000;

function linhaDeDevolucao(extras: Linha = {}): Linha {
  return {
    id: "rf1",
    order_id: "pedido-rf1",
    amount: 50,
    status: "solicitado",
    solicitado_por: "cliente-ficticio",
    tentativas: 0,
    mp_refund_id: null,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
    updated_at: new Date(AGORA - CINCO_MIN).toISOString(),
    created_at: new Date(AGORA - 60 * 60 * 1000).toISOString(),
    ...extras,
  };
}

function pedidoDe(linha: Linha, extras: Linha = {}): Linha {
  return {
    id: String(linha.order_id),
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(AGORA - UM_DIA).toISOString(),
    status: "cancelled",
    ...extras,
  };
}

interface Cenario {
  linha: Linha;
  pedido?: Linha;
  rotas: Rota[];
  /** O clique do lojista pega a linha DEPOIS de o cron ler a fila e ANTES da marca. */
  cliquePegaAntesDaMarca?: boolean;
}

async function rodar(cenario: Cenario) {
  const linhas = [{ ...cenario.linha }];
  const pedidos = [cenario.pedido ?? pedidoDe(cenario.linha)];
  const atualizacoes: Array<{ id: string; valores: Linha }> = [];
  const autorizacoes: string[] = [];
  const conclusoes: Linha[] = [];
  const diagnosticos: string[] = [];
  const chamadasMp: Array<{ url: string; metodo: string; chave: string | null }> = [];

  const supabase = {
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select: (colunas: string) => {
            const q = consulta(linhas).select(colunas);
            // A fila e o unico SELECT que pede `tentativas`.
            if (!cenario.cliquePegaAntesDaMarca || !colunas.includes("tentativas")) return q;
            const entregar = q.then.bind(q);
            q.then = (resolver, rejeitar) =>
              entregar((resultado) => {
                for (const linha of linhas) {
                  if (linha.status === "solicitado") linha.status = "em_processamento";
                }
                return resolver(resultado);
              }, rejeitar);
            return q;
          },
          update: (valores: Linha) =>
            consulta(
              linhas,
              (lote) => lote.forEach((linha) => atualizacoes.push({ id: String(linha.id), valores })),
              valores,
            ),
        };
      }
      if (tabela === "marketplace_orders") return consulta(pedidos);
      if (tabela === "app_settings" || tabela === "marketplace_order_history") return consulta([]);
      throw new Error(`Tabela inesperada: ${tabela}`);
    },
    rpc(nome: string, args: Linha = {}) {
      if (nome === "pagamentos_a_reconciliar") return Promise.resolve({ data: [], error: null });
      if (nome === "autorizar_post_do_estorno") {
        autorizacoes.push(String(args.p_refund_id));
        const linha = linhas.find((item) => item.id === args.p_refund_id);
        return Promise.resolve({
          data: { decisao: "autorizado", pedido: pedidos.find((pedido) => pedido.id === linha?.order_id) },
          error: null,
        });
      }
      if (nome === "concluir_estorno") {
        conclusoes.push({ ...args });
        const linha = linhas.find((item) => item.id === args.p_refund_id);
        if (linha) Object.assign(linha, { status: "concluido", mp_refund_id: args.p_mp_refund_id });
        return Promise.resolve({ data: { payment_status: "pago" }, error: null });
      }
      if (nome === "registrar_diagnostico_do_estorno") {
        diagnosticos.push(String(args.p_refund_id));
        return Promise.resolve({ data: { transitorios: 0, post_incerto: false }, error: null });
      }
      throw new Error(`RPC inesperada: ${nome}`);
    },
  };

  const fetchImpl: typeof fetch = (entrada, init) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    const metodo = (init?.method ?? "GET").toUpperCase();
    chamadasMp.push({ url, metodo, chave: new Headers(init?.headers).get("X-Idempotency-Key") });
    const rota = cenario.rotas.find((r) => r.metodo === metodo && url.includes(r.trecho));
    return Promise.resolve(new Response(JSON.stringify(rota?.corpo ?? {}), { status: rota?.status ?? 500 }));
  };

  const resposta = await handler(
    new Request("http://localhost/reconciliar-pagamentos", {
      method: "POST",
      headers: { "x-reconciliacao-secret": SEGREDO },
    }),
    {
      supabase: supabase as unknown as NonNullable<Parameters<typeof handler>[1]>["supabase"],
      fetchImpl,
    },
  );
  assertEquals(resposta.status, 200);
  return {
    corpo: await resposta.json(),
    linhaFinal: linhas[0],
    atualizacoes,
    autorizacoes,
    conclusoes,
    diagnosticos,
    chamadasMp,
  };
}

const postClassico = (status: number, corpo: unknown): Rota => ({
  metodo: "POST",
  trecho: "/v1/payments/123456789/refunds",
  status,
  corpo,
});

// ── 1. A MARCA ────────────────────────────────────────────────────────────

Deno.test("MARCA perde a corrida: o clique ja pegou a linha -> 0 linhas na marca, adiada, ZERO MP, ZERO autorizar, ZERO concluir", async () => {
  const linha = linhaDeDevolucao();
  const r = await rodar({
    linha,
    cliquePegaAntesDaMarca: true,
    // Se o codigo seguisse em frente, haveria roteiro para tudo: nada aqui
    // protege a linha alem da guarda da marca.
    rotas: [postClassico(201, { id: 999, status: "approved", amount: 50 })],
  });

  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(r.chamadasMp, [], "nenhuma chamada ao MP (nem GET, nem POST)");
  assertEquals(r.autorizacoes, [], "autorizar_post_do_estorno nao e chamada");
  assertEquals(r.conclusoes, [], "concluir_estorno nao e chamada");
  assertEquals(r.diagnosticos, [], "nenhum diagnostico de POST gravado");
  // O cron nao escreveu nada na linha do clique alem do carimbo de visita.
  assertEquals(r.atualizacoes.map((a) => Object.keys(a.valores)), [["updated_at"]]);
  assertEquals(r.linhaFinal.status, "em_processamento", "a linha segue como o clique deixou");
  assertEquals(r.linhaFinal.tentativas, 0, "o cron nao gastou tentativa da linha do clique");
});

Deno.test("MARCA ganha (contraprova): a marca devolve 1 linha -> o cron chama o MP, autoriza e conclui", async () => {
  const linha = linhaDeDevolucao();
  const r = await rodar({
    linha,
    rotas: [postClassico(201, { id: 999, status: "approved", amount: 50 })],
  });

  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(r.chamadasMp.map((c) => [c.metodo, c.chave]), [["POST", "rf1"]]);
  assertEquals(r.autorizacoes, ["rf1"]);
  assertEquals(r.conclusoes.map((c) => c.p_refund_id), ["rf1"]);
  // A marca foi gravada: solicitado -> em_processamento, tentativas + 1.
  assertEquals(
    r.atualizacoes.some((a) => a.valores.status === "em_processamento" && a.valores.tentativas === 1),
    true,
  );
});

// ── 2. p_mp_refund_id ─────────────────────────────────────────────────────

// MP aprovou, mas o corpo nao traz o id do refund: ausente, null ou ''.
for (
  const [nome, id] of [
    ["id ausente", undefined],
    ["id null", null],
    ["id vazio", ""],
  ] as const
) {
  Deno.test(`p_mp_refund_id - linha solicitado, classico, MP aprova com ${nome} -> concluir_estorno recebe NULL`, async () => {
    const corpoMp: Linha = { status: "approved", amount: 50 };
    if (id !== undefined) corpoMp.id = id;
    const r = await rodar({ linha: linhaDeDevolucao(), rotas: [postClassico(201, corpoMp)] });

    assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
    assertEquals(r.conclusoes.length, 1);
    assertStrictEquals(r.conclusoes[0].p_mp_refund_id, null);
  });
}

Deno.test("p_mp_refund_id - linha em_processamento COM mp_refund_id ja gravado, reenvio aprovado sem id -> NULL (a RPC preserva o id gravado)", async () => {
  const linha = linhaDeDevolucao({ status: "em_processamento", tentativas: 1, mp_refund_id: "REF-JA-GRAVADO" });
  const listaDoMp = {
    id: 123456789,
    status: "approved",
    transaction_amount_refunded: 0,
    // O refund que a linha ja tinha esta MORTO no MP: a consulta nao confirma
    // (tentar_depois) e a consulta antes do reenvio libera o POST (nao_achou).
    refunds: [{ id: "REF-JA-GRAVADO", amount: 50, status: "cancelled" }],
  };
  const r = await rodar({
    linha,
    rotas: [
      { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: listaDoMp },
      postClassico(201, { status: "approved", amount: 50 }),
    ],
  });

  // Prova de que o cenario e o prometido: houve POST de reenvio com a chave da linha.
  assertEquals(r.chamadasMp.filter((c) => c.metodo === "POST").map((c) => c.chave), ["rf1"]);
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(r.conclusoes.length, 1);
  assertStrictEquals(r.conclusoes[0].p_mp_refund_id, null);
});

Deno.test("p_mp_refund_id - linha classica em_processamento concluida pelo acumulado (sem refunds[]): NULL, nunca ''", async () => {
  const linha = linhaDeDevolucao({ status: "em_processamento", tentativas: 1 });
  const r = await rodar({
    linha,
    rotas: [{
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 50 },
    }],
  });

  assertEquals(r.chamadasMp.map((c) => c.metodo), ["GET"], "concluiu pela consulta, sem POST");
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(r.conclusoes.length, 1);
  assertStrictEquals(r.conclusoes[0].p_mp_refund_id, null);
});

Deno.test("p_mp_refund_id - PIX (Orders): POST de refund total devolve 'refunded' sem refunds[] -> NULL", async () => {
  const linha = linhaDeDevolucao({ amount: 100 });
  const r = await rodar({
    linha,
    pedido: pedidoDe(linha, { gateway_payment_id: "ORDTSTPIXFIXTURE01", total: 100 }),
    rotas: [
      {
        metodo: "GET",
        trecho: "/v1/orders/ORDTSTPIXFIXTURE01",
        status: 200,
        corpo: {
          id: "ORDTSTPIXFIXTURE01",
          status: "processed",
          transactions: { payments: [{ id: "PAY-FIXTURE-1", status: "processed" }] },
        },
      },
      {
        metodo: "POST",
        trecho: "/v1/orders/ORDTSTPIXFIXTURE01/refund",
        status: 201,
        corpo: { id: "ORDTSTPIXFIXTURE01", status: "refunded" },
      },
    ],
  });

  assertEquals(r.chamadasMp.filter((c) => c.metodo === "POST").length, 1, "o POST de refund da order saiu");
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(r.conclusoes.length, 1);
  assertStrictEquals(r.conclusoes[0].p_mp_refund_id, null);
});

Deno.test("p_mp_refund_id (contraprova) - MP traz o id do refund -> chega como string, sem virar null", async () => {
  const r = await rodar({
    linha: linhaDeDevolucao(),
    rotas: [postClassico(201, { id: 7001, status: "approved", amount: 50 })],
  });

  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertStrictEquals(r.conclusoes[0].p_mp_refund_id, "7001");
});
