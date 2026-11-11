import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarComprovantePedido } from "./comprovante.ts";

const PEDIDO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEDIDO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REMETENTE_DE_TESTE = {
  origem: "ambiente",
  usuario: "loja@example.org",
  senha: "senha-ficticia",
  motivo: null,
  reserva: null,
};

type Linha = Record<string, unknown>;
type Filtro = { tabela: string; coluna: string; valor: unknown };
type Mensagem = { para: string; assunto: string; html: string };

/** Sem eq, o select mantém todas as linhas, como uma consulta sem filtro. */
function consultaFiltrada(tabela: string, linhas: Linha[], filtros: Filtro[]) {
  let selecionadas = [...linhas];
  const consulta = {
    eq(coluna: string, valor: unknown) {
      filtros.push({ tabela, coluna, valor });
      selecionadas = selecionadas.filter((linha) => new Map(Object.entries(linha)).get(coluna) === valor);
      return consulta;
    },
    limit(n: number) {
      selecionadas = selecionadas.slice(0, n);
      return consulta;
    },
    async maybeSingle() {
      return selecionadas.length > 1
        ? { data: null, error: { message: "maybeSingle recebeu mais de uma linha" } }
        : { data: selecionadas[0] ?? null, error: null };
    },
    then(resolve: (resultado: { data: Linha[]; error: null }) => unknown) {
      return Promise.resolve({ data: selecionadas, error: null }).then(resolve);
    },
  };
  return consulta;
}

async function enviarPedidoA() {
  const filtros: Filtro[] = [];
  const enviados: Mensagem[] = [];
  // B vem primeiro: nem devolver a primeira linha pode acertar por acaso.
  const tabelas = new Map<string, Linha[]>([
    ["marketplace_orders", [
      {
        id: PEDIDO_B,
        customer_data: { email: "cliente-b@example.org" },
        subtotal: 987.65,
        total: 987.65,
        payment_method: "cash",
      },
      {
        id: PEDIDO_A,
        customer_data: { email: "cliente-a@example.org" },
        subtotal: 123.45,
        total: 123.45,
        payment_method: "cash",
      },
    ]],
    ["marketplace_order_items", [
      { order_id: PEDIDO_B, product_name: "Produto exclusivo B", quantity: 1, price: 987.65 },
      { order_id: PEDIDO_A, product_name: "Produto exclusivo A", quantity: 1, price: 123.45 },
    ]],
    ["store_config", [{ store_name: "Loja Fictícia" }]],
  ]);
  const supabase = {
    from(tabela: string) {
      const linhas = tabelas.get(tabela);
      if (!linhas) throw new Error(`Tabela inesperada: ${tabela}`);
      return { select: () => consultaFiltrada(tabela, linhas, filtros) };
    },
    rpc: async (nome: string) => {
      if (nome !== "reivindicar_email_de_confirmacao") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return { data: true, error: null };
    },
  };

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: PEDIDO_A,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (mensagem) => { enviados.push(mensagem); },
    },
  });
  return { desfecho, enviados, filtros };
}

Deno.test("dois pedidos: comprovante de A usa somente o e-mail, total e assunto de A", async () => {
  const { desfecho, enviados, filtros } = await enviarPedidoA();

  assertEquals(desfecho, { ok: true });
  assertEquals(enviados.length, 1);
  assertEquals(enviados[0].para, "cliente-a@example.org");
  assertEquals(enviados[0].assunto, "Pedido #AAAAAA · Loja Fictícia");
  assertStringIncludes(enviados[0].html, "123,45");
  assertEquals(enviados[0].html.includes("987,65"), false);
  assertEquals(filtros.filter((f) => f.tabela === "marketplace_orders"), [
    { tabela: "marketplace_orders", coluna: "id", valor: PEDIDO_A },
  ]);
});

Deno.test("itens de dois pedidos: e-mail de A não inclui nenhum produto de B", async () => {
  const { desfecho, enviados, filtros } = await enviarPedidoA();

  assertEquals(desfecho, { ok: true });
  assertEquals(enviados.length, 1);
  assertStringIncludes(enviados[0].html, "1× Produto exclusivo A");
  assertEquals(enviados[0].html.includes("Produto exclusivo B"), false);
  assertEquals(filtros.filter((f) => f.tabela === "marketplace_order_items"), [
    { tabela: "marketplace_order_items", coluna: "order_id", valor: PEDIDO_A },
  ]);
});
