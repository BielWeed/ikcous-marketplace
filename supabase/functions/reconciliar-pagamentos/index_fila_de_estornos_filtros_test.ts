/**
 * A fila decide quem pode devolver dinheiro ANTES do LIMIT 20.
 * Mutantes: tirar in(status), neq(solicitado_por) ou lt(updated_at) deve
 * derrubar, respectivamente, TERMINAIS, SISTEMA ou JANELA, sem TypeError.
 * Handler e executor reais; só banco e HTTP são dublês, sem rede.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

type Linha = Record<string, unknown>;
type Resultado = { data: Linha[]; error: null };

const SEGREDO = "segredo-ficticio-fila-de-estornos";
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-ficticio-fila-de-estornos");

function comparavel(linha: Linha, coluna: string): string | number {
  const valor = Reflect.get(linha, coluna);
  return typeof valor === "number" || typeof valor === "string" ? valor : "";
}

/**
 * Aplica os argumentos recebidos, nunca filtros embutidos no fixture.
 * Todos os métodos permanecem disponíveis: apagar um elo muda as linhas
 * retornadas, não a estrutura do dublê. Projeta só DEPOIS de filtrar/ordenar.
 */
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

function estorno(id: string, agora: number, extras: Linha = {}): Linha {
  return {
    id,
    order_id: `pedido-${id}`,
    amount: 10,
    status: "solicitado",
    solicitado_por: "cliente-ficticio",
    tentativas: 0,
    mp_refund_id: null,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
    updated_at: new Date(agora - 5 * 60 * 1000).toISOString(),
    created_at: new Date(agora - 60 * 60 * 1000).toISOString(),
    ...extras,
  };
}

async function rodar(linhasOriginais: Linha[]) {
  const linhas = linhasOriginais.map((linha) => ({ ...linha }));
  const leiturasDePedido: string[] = [];
  const atualizacoes: string[] = [];
  const conclusoes: string[] = [];
  const autorizacoes: string[] = [];
  const chamadasMp: Array<{ url: string; metodo: string; chave: string | null }> = [];
  const pedidos = linhas.map((linha, i) => ({
    id: String(linha.order_id),
    gateway_payment_id: String(123456789 + i),
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: "cancelled",
  }));
  const supabase = {
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select: (colunas: string) => consulta(linhas).select(colunas),
          update: (valores: Linha) => consulta(
            linhas,
            (lote) => atualizacoes.push(...lote.map((linha) => String(linha.id))),
            valores,
          ),
        };
      }
      if (tabela === "marketplace_orders") {
        return consulta(pedidos, (lote) => leiturasDePedido.push(...lote.map((pedido) => String(pedido.id))));
      }
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
        conclusoes.push(String(args.p_refund_id));
        const linha = linhas.find((item) => item.id === args.p_refund_id);
        if (linha) Object.assign(linha, { status: "concluido", mp_refund_id: args.p_mp_refund_id });
        return Promise.resolve({ data: { payment_status: "pago" }, error: null });
      }
      if (nome === "registrar_diagnostico_do_estorno") {
        return Promise.resolve({ data: { transitorios: 0, post_incerto: false }, error: null });
      }
      throw new Error(`RPC inesperada: ${nome}`);
    },
  };
  const fetchImpl: typeof fetch = (entrada, init) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    const metodo = init?.method ?? "GET";
    const chave = new Headers(init?.headers).get("X-Idempotency-Key");
    chamadasMp.push({ url, metodo, chave });
    return Promise.resolve(new Response(JSON.stringify(
      metodo === "POST"
        ? { id: `refund-${chave}`, status: "approved", amount: 10 }
        : { id: url.split("/").pop(), status: "approved", refunds: [] },
    ), { status: metodo === "POST" ? 201 : 200 }));
  };
  const resposta = await handler(new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": SEGREDO },
  }), {
    supabase: supabase as unknown as NonNullable<Parameters<typeof handler>[1]>["supabase"],
    fetchImpl,
  });
  assertEquals(resposta.status, 200);
  return {
    corpo: await resposta.json(),
    leiturasDePedido,
    atualizacoes,
    conclusoes,
    autorizacoes,
    chamadasMp,
  };
}

function conferirSoElegivel(resultado: Awaited<ReturnType<typeof rodar>>, id: string) {
  assertEquals(resultado.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(resultado.leiturasDePedido, [`pedido-${id}`], "excluídas nem têm o pedido consultado");
  assertEquals(resultado.atualizacoes, [id]);
  assertEquals(resultado.autorizacoes, [id]);
  assertEquals(resultado.conclusoes, [id]);
  assertEquals(resultado.chamadasMp.filter((chamada) => chamada.metodo === "POST").map((chamada) => chamada.chave), [id]);
  assertEquals(resultado.chamadasMp.every((chamada) => chamada.url.includes("/v1/payments/123456789/")), true,
    "nenhuma consulta ou POST para pagamentos das linhas excluídas");
}

Deno.test("TERMINAIS - 24 estornos encerrados não ocupam o lote de 20 nem impedem o pendente de devolver", async () => {
  const agora = Date.now();
  const terminais = [...Array(24).keys()].map((i) => estorno(`terminal-${i}`, agora, {
    status: ["concluido", "falhou", "cancelado"].at(i % 3),
    updated_at: new Date(agora - 10 * 60 * 1000).toISOString(),
    created_at: new Date(agora - (i + 2) * 60 * 60 * 1000).toISOString(),
  }));
  // Pendente primeiro na entrada; sem IN, ORDER coloca as terminais antes
  // dele e LIMIT o expulsa. Não basta o dublê cortar a entrada sem ordenar.
  const resultado = await rodar([estorno("pendente", agora), ...terminais]);
  conferirSoElegivel(resultado, "pendente");
});

Deno.test("SISTEMA - estorno externo pendente nunca autoriza nem envia outro POST; o de cliente devolve", async () => {
  const agora = Date.now();
  const resultado = await rodar([
    estorno("cliente", agora),
    estorno("externo", agora, { solicitado_por: "sistema" }),
  ]);
  conferirSoElegivel(resultado, "cliente");
});

Deno.test("JANELA - estorno de 30 segundos não disputa com o clique; o de cinco minutos devolve", async () => {
  const agora = Date.now();
  const resultado = await rodar([
    estorno("antigo", agora),
    estorno("recente", agora, { updated_at: new Date(agora - 30 * 1000).toISOString() }),
  ]);
  conferirSoElegivel(resultado, "antigo");
});
