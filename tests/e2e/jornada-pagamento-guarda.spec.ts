import { type Page, expect, test } from "@playwright/test";
import {
  abrirLoja,
  exigirRedeSemImprevistos,
  instalarLojaFixtura,
  requisicoesNaoPrevistas,
} from "./kit-jornadas";
import { instalarPagamentoSimulado } from "./pagamento-kit";

/**
 * CONTROLE DA GUARDA DE REDE (04/10/2026). As jornadas só valem se o que NÃO
 * tem stub for barrado: estes testes disparam, de dentro da página, chamadas
 * que nenhuma jornada prevê — RPC de estorno, tabela desconhecida, edge sem
 * stub, escrita no pedido, a RPC de pedido "na entrega" no fluxo pago,
 * método errado num caminho conhecido, origem externa, caminho local que não
 * é estático do build, websocket estranho — e provam que:
 *
 *  1. cada uma é ABORTADA (o `fetch` da página rejeita: nada respondeu);
 *  2. cada uma é REGISTRADA, sem o VALOR de parâmetro nenhum (só o nome);
 *  3. a função do `afterEach` (`exigirRedeSemImprevistos`) FALHA com a lista.
 *
 * No fim, o controle esvazia a lista DE PROPÓSITO para o próprio `afterEach`
 * passar. O mutante que tira esse esvaziamento prova que o `afterEach`
 * derruba o teste (ver o relatório da frente).
 */

test.afterEach(exigirRedeSemImprevistos);

const BANCO = "https://jornadase2efixture01.supabase.co";
const PREVIEW = "http://127.0.0.1:4173";

/** Dispara cada chamada da página e diz se ela foi RESPONDIDA ou REJEITADA. */
async function dispararDaPagina(
  page: Page,
  chamadas: { url: string; metodo: string }[],
): Promise<string[]> {
  return page.evaluate(async (lista) => {
    const desfechos: string[] = [];
    for (const { url, metodo } of lista) {
      try {
        const resposta = await fetch(url, {
          method: metodo,
          ...(metodo === "GET" ? {} : { body: "{}" }),
        });
        desfechos.push(`respondida ${resposta.status}`);
      } catch {
        desfechos.push("rejeitada");
      }
    }
    return desfechos;
  }, chamadas);
}

test("kit da loja: RPC, tabela, edge, origem externa e caminho local não previstos são abortados, registrados sem valores e derrubam o afterEach", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  await abrirLoja(page);
  // O boot inteiro passou sem nada imprevisto (o catálogo tem stub).
  expect(requisicoesNaoPrevistas(page)).toEqual([]);

  const desfechos = await dispararDaPagina(page, [
    { metodo: "POST", url: `${BANCO}/rest/v1/rpc/estornar_pedido` },
    {
      metodo: "GET",
      url: `${BANCO}/rest/v1/tabela_desconhecida?select=*&apikey=valor-que-nao-pode-vazar`,
    },
    { metodo: "POST", url: `${BANCO}/functions/v1/estorno` },
    // Leitura com stub, mas por método de ESCRITA: não passa.
    { metodo: "DELETE", url: `${BANCO}/rest/v1/favorites?id=eq.1` },
    {
      metodo: "GET",
      url: "https://coleta-externa.example/pixel?token=valor-que-nao-pode-vazar",
    },
    { metodo: "POST", url: `${PREVIEW}/api/qualquer` },
    { metodo: "GET", url: `${PREVIEW}/version.json` },
  ]);
  expect(desfechos).toEqual(Array(7).fill("rejeitada"));

  const registradas = requisicoesNaoPrevistas(page);
  expect(registradas).toEqual([
    `POST ${BANCO}/rest/v1/rpc/estornar_pedido`,
    `GET ${BANCO}/rest/v1/tabela_desconhecida?{select,apikey}`,
    `POST ${BANCO}/functions/v1/estorno`,
    `DELETE ${BANCO}/rest/v1/favorites?{id}`,
    "GET https://coleta-externa.example/pixel?{token}",
    `POST ${PREVIEW}/api/qualquer`,
    `GET ${PREVIEW}/version.json`,
  ]);
  expect(registradas.join("\n")).not.toContain("valor-que-nao-pode-vazar");

  // A função do afterEach FALHA com a lista na mensagem.
  await expect(exigirRedeSemImprevistos({ page })).rejects.toThrow(
    /estornar_pedido/,
  );

  // Esvaziado de propósito: o afterEach deste controle tem de passar.
  registradas.length = 0;
});

test("kit de pagamento: v23 no fluxo pago, escrita no pedido, método errado na edge e websocket estranho são abortados e registrados — nenhum chega ao simulador", async ({
  page,
}) => {
  const sim = await instalarPagamentoSimulado(page);
  await abrirLoja(page);
  expect(sim.naoPrevistas).toEqual([]);

  const desfechos = await dispararDaPagina(page, [
    {
      metodo: "POST",
      url: `${BANCO}/rest/v1/rpc/create_marketplace_order_v23`,
    },
    {
      metodo: "PATCH",
      url: `${BANCO}/rest/v1/marketplace_orders?id=eq.00000000-0000-4000-8000-000000e2e001`,
    },
    { metodo: "GET", url: `${BANCO}/functions/v1/criar-pagamento` },
    { metodo: "POST", url: `${BANCO}/functions/v1/estornar-pagamento` },
    { metodo: "POST", url: "https://api.mercadopago.com/v1/payments" },
  ]);
  expect(desfechos).toEqual(Array(5).fill("rejeitada"));

  await page.evaluate(() => {
    new WebSocket("wss://socket-externo.example/canal?chave=valor-secreto");
  });
  await expect.poll(() => sim.naoPrevistas.length).toBe(6);

  expect(sim.naoPrevistas).toEqual([
    `POST ${BANCO}/rest/v1/rpc/create_marketplace_order_v23`,
    `PATCH ${BANCO}/rest/v1/marketplace_orders?{id}`,
    `GET ${BANCO}/functions/v1/criar-pagamento`,
    `POST ${BANCO}/functions/v1/estornar-pagamento`,
    "POST https://api.mercadopago.com/v1/payments",
    "WEBSOCKET wss://socket-externo.example/canal?{chave}",
  ]);
  expect(sim.naoPrevistas.join("\n")).not.toContain("valor-secreto");
  // Nada disso virou pedido nem cobrança no simulador.
  expect(sim.criacoesDePedido).toEqual([]);
  expect(sim.chamadasDoPagamento).toEqual([]);

  await expect(exigirRedeSemImprevistos({ page })).rejects.toThrow(
    /create_marketplace_order_v23/,
  );
  sim.naoPrevistas.length = 0;
});
