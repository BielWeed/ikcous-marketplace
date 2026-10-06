import { expect, test } from "@playwright/test";
import { abrirLoja, exigirRedeSemImprevistos } from "./kit-jornadas";
import {
  type PedidoSimulado,
  esperarTelaAssentar,
  instalarPagamentoSimulado,
  respostaPixComQr,
} from "./pagamento-kit";

/**
 * JORNADA DA RETOMADA DO PAGAMENTO (F4, 04/10/2026) no navegador de verdade,
 * contra o SIMULADOR do `pagamento-kit.ts`: o cliente sai do checkout com o
 * PIX pendente e volta pelo pedido (Perfil → "Pedidos em Andamento" → "Ver
 * Detalhes" → "Retomar pagamento"). A PRIMEIRA leitura do pedido falha; a
 * tela tem de avisar, NÃO cobrar nada, e o "Tentar de novo" tem de reler.
 *
 * AFIRMA: a mensagem, a releitura por toque e que nenhuma cobrança sai antes
 * da leitura dar certo. NÃO prova: a RLS real de `marketplace_orders`, o
 * tempo limite de 15 s da leitura (aqui a falha é um 500 imediato) nem a
 * reconsulta do MESMO QR pela edge real.
 *
 * O `user_id` no select (048d2572): a leitura é a MESMA para o toque e para a
 * recarga da aba, e só a RECARGA confere o dono na linha (pedido de outra
 * conta sai calado — a RLS deixa o admin ler pedido alheio). Esta jornada é
 * o TOQUE: ela fixa o select exato, mas não exercita a conferência do dono;
 * quem prova o descarte de pedido de outra conta é
 * `tests/front/checkout-retomada-recarga.test.tsx`.
 */

test.afterEach(exigirRedeSemImprevistos);

const PEDIDO_PENDENTE: PedidoSimulado = {
  id: "00000000-0000-4000-8000-00000000a001",
  total: 40,
  status: "pending",
  payment_status: "aguardando",
  metodo_online: "pix",
  gateway_payment_id: "pix-anterior-simulado-01",
  expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  created_at: new Date().toISOString(),
};

/** O select EXATO da leitura da retomada, na ordem que a tela pede. */
const SELECT_DA_RETOMADA =
  "total,metodo_online,gateway_payment_id,payment_status,status,user_id";

test('retomar pagamento com a leitura do pedido falhando: avisa sem cobrar, e "Tentar de novo" relê e abre o PIX', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page, {
    pedidosIniciais: [PEDIDO_PENDENTE],
  });
  sim.falharLeiturasDaRetomada = 1;
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "pix"
      ? respostaPixComQr(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };
  const leiturasDaRetomada = () =>
    sim.leiturasDePedido.filter((l) => l.select.includes("metodo_online"));

  const errosNoFim = await abrirLoja(page);
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: "Perfil" })
    .click();
  await expect(page.getByText("Pedidos em Andamento")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Ver Detalhes" }).click();
  await page
    .getByRole("button", { name: "Retomar pagamento" })
    .click({ timeout: 30_000 });

  // A leitura falhou: aviso honesto, "Tentar de novo" e "Ver meus pedidos".
  await expect(
    page.getByRole("heading", { name: "Retomar o pagamento do pedido" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveText(
    "Não foi possível abrir o pagamento deste pedido agora. Nada foi cobrado nesta tentativa.",
  );
  await expect(
    page.getByRole("button", { name: "Ver meus pedidos" }),
  ).toBeVisible();
  const tentarDeNovo = page.getByRole("button", { name: "Tentar de novo" });
  await expect(tentarDeNovo).toBeVisible();

  // Nada cobra e nada relê sozinho enquanto o cliente não toca: com a tela
  // assentada, UMA leitura (a que falhou) e nenhuma cobrança.
  await esperarTelaAssentar(page);
  expect(leiturasDaRetomada()).toEqual([
    { select: SELECT_DA_RETOMADA, falhou: true },
  ]);
  expect(sim.chamadasDoPagamento).toEqual([]);

  await tentarDeNovo.click();
  await expect(page.getByAltText("QR code do PIX")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);

  expect(leiturasDaRetomada().map((l) => l.falhou)).toEqual([true, false]);
  // A releitura do "Tentar de novo" pede o MESMO select (com o dono).
  expect(leiturasDaRetomada()).toEqual([
    { select: SELECT_DA_RETOMADA, falhou: true },
    { select: SELECT_DA_RETOMADA, falhou: false },
  ]);
  // UMA cobrança, do pedido retomado — nunca pedido novo.
  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: PEDIDO_PENDENTE.id, metodo: "pix" },
  ]);
  expect(sim.contagemPorMetodo()).toEqual({ pix: 1 });
  expect(sim.criacoesDePedido).toEqual([]);
  expect(errosNoFim().erros).toEqual([]);
});
