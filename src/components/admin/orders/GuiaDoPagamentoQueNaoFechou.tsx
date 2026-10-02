import { getPaymentStatusConfig } from "./OrderStatusBadge";

/**
 * C7 do ciclo de recuperação do cartão (02/10/2026): o que o LOJISTA faz nos
 * dois casos que o servidor deixa para uma pessoa resolver. Mora no modal
 * "Guia de Controle de Pedidos" (AdminOrdersView), que é a tela para onde o
 * push "Pagamento fora do fluxo" leva (`url: "/admin-orders"`,
 * webhook-mercadopago/index.ts).
 *
 * Cada frase abaixo é um fato do código de hoje — se um destes mudar, o texto
 * muda junto:
 *   - Cartão em dúvida aparece no painel igual a qualquer pedido aguardando:
 *     o `Order` do painel não carrega a vaga nem o método online
 *     (20261180000000, "FORA DO ESCOPO"), e o selo é o de `aguardando`.
 *   - O admin PODE cancelar esse pedido: a guarda do cartão vivo de
 *     `update_order_status_atomic` só vale para quem não é admin
 *     (20261180000000, dentro de `IF NOT v_is_admin`). O cancelamento devolve
 *     o estoque e só escreve `status` — não chama o Mercado Pago, nem mexe na
 *     vaga.
 *   - Se o banco aprovar depois, o webhook ADOTA a vaga sem olhar `status`
 *     (webhook-mercadopago/index.ts, bloco "ADOÇÃO") e `confirmar_pagamento`
 *     grava `pago_apos_expirar` para `aguardando` + `cancelled` ou para
 *     `expirado` (20260901000000) — e o push ao admin sai com o título
 *     "Pagamento fora do fluxo". A reconciliação também confirma, mas SEM
 *     push (reconciliar-pagamentos/index.ts, "SEM PUSH AQUI") — por isso
 *     "pode receber".
 *   - Sem cobrança, a varredura cancela sozinha e devolve o estoque
 *     (`expirar_pedidos_vencidos`, 20261186000000). O prazo NÃO entra no
 *     texto: depende de qual versão da varredura está no banco da loja.
 *   - Nada é devolvido sozinho em `pago_apos_expirar`: o pedido já está
 *     cancelado (sem botão "Cancelar pedido"), e a única linha de devolução
 *     que nasce sem clique é a do CANCELAMENTO de pedido pago — que aqui não
 *     acontece de novo. A devolução pelo app é o quadro "Devolução de
 *     dinheiro" (EstornoCard, `solicitar_estorno` aceita `pago_apos_expirar`).
 *   - O painel não reabre pedido cancelado: sem "Avançar" para `cancelled`
 *     (OrderDetail.tsx, `podeAvancar`) e o aviso "não pode prosseguir".
 *   - Aprovado no MP NÃO garante "Pago" no app (revisão financeira do C7):
 *     cartão capturado atrás do sentinela com valor divergente do pedido não
 *     é adotado (reconciliar-pagamentos/index.ts:508-518), e a reconciliação
 *     só olha a janela `expires_at > now() - interval '24 hours'` com
 *     `LIMIT 100` (20261010000000). Se a varredura cancelar o pedido nesse
 *     caso, o `payment_status` fica `expirado` — fora do balde de estorno
 *     (AdminOrdersView.tsx:204-224, `baldeDeEstorno` exige pago/
 *     pago_apos_expirar/recebido_na_entrega), fora do aviso de cancelados
 *     (AlertasCancelados.tsx:274-312 e 379-397) e sem o quadro de devolução
 *     (OrderDetail.tsx:1604-1610). Por isso o passo 2 manda devolver no MP.
 *   - Depois de ENVIAR um `pago_apos_expirar`, o pedido segue cancelado e
 *     pago: continua em "Estorno devido" (AlertasCancelados.tsx:379-397) e a
 *     ficha continua com "Devolver R$ …" (OrderDetail.tsx:1604-1610). O
 *     registro para quem vier depois é o campo "Anotações internas" da ficha.
 *
 * Os rótulos de selo vêm do MESMO config do selo, não de cópia; os rótulos
 * de botão/quadro são conferidos contra o arquivo que os desenha em
 * tests/front/admin-orders-guia-do-pagamento-que-nao-fechou.test.tsx.
 */
export function GuiaDoPagamentoQueNaoFechou() {
  const aguardando = getPaymentStatusConfig("aguardando").label;
  const pago = getPaymentStatusConfig("pago").label;
  const configPagoForaDoFluxo = getPaymentStatusConfig("pago_apos_expirar");
  const pagoForaDoFluxo = configPagoForaDoFluxo.label;
  // O rótulo curto é o que o card da lista mostra ("Pago fora do fluxo").
  const pagoForaDoFluxoCurto =
    configPagoForaDoFluxo.shortLabel ?? configPagoForaDoFluxo.label;

  return (
    <div className="space-y-3">
      <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
        Pagamento que não fechou sozinho
      </h4>

      <div className="space-y-2 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
        <p className="text-xs font-bold text-white">
          Cliente diz que pagou com cartão, mas o pedido segue “{aguardando}”
        </p>
        <p className="text-xs text-zinc-400">
          Às vezes o app não consegue confirmar com o banco se o cartão foi
          cobrado. Aqui, esse pedido aparece igual a um pedido que ainda não foi
          pago.
        </p>
        <ol className="list-inside list-decimal space-y-1.5 text-xs text-zinc-400">
          <li>
            Antes de cancelar, abra o painel do Mercado Pago da loja e procure
            pelo nome ou e-mail do cliente, na data do pedido, um pagamento com
            cartão.
          </li>
          <li>
            Achou o pagamento aprovado ou em análise? Não cancele. O app confere
            com o Mercado Pago sozinho: quando o banco confirmar, o pedido vira
            “{pago}”, ou “{pagoForaDoFluxoCurto}” se a confirmação chegar depois
            do prazo (veja abaixo). Se o app cancelar o pedido mesmo com o
            pagamento aprovado no Mercado Pago, ele não reconheceu essa
            cobrança: o dinheiro está na sua conta, mas aqui não aparece aviso
            nem botão de devolução. Devolva direto no painel do Mercado Pago, ou
            combine o envio com o cliente.
          </li>
          <li>
            Não achou nada? Pode esperar: se nenhuma cobrança aparecer, o app
            cancela o pedido sozinho e o estoque volta para a loja.
          </li>
          <li>
            Se você cancelar antes disso: cancelar aqui devolve o estoque, mas
            não cancela nada no Mercado Pago. Se o banco aprovar o cartão
            depois, o dinheiro entra mesmo assim e o pedido vira “
            {pagoForaDoFluxo}” (veja abaixo).
          </li>
        </ol>
      </div>

      <div className="space-y-2 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
        <p className="text-xs font-bold text-white">
          Pedido “{pagoForaDoFluxo}”
        </p>
        <p className="text-xs text-zinc-400">
          O pagamento (cartão ou PIX) foi confirmado depois que o pedido já
          estava cancelado. O dinheiro entrou na sua conta do Mercado Pago, mas
          o estoque já tinha voltado para a loja. Você pode receber o aviso
          “Pagamento fora do fluxo” no celular. Nada é devolvido sozinho: a
          decisão é sua.
        </p>
        <ol className="list-inside list-decimal space-y-1.5 text-xs text-zinc-400">
          <li>
            Fale com o cliente (o WhatsApp dele aparece na ficha do pedido) e
            combinem: devolver o dinheiro ou enviar o produto.
          </li>
          <li>
            Para devolver: abra o pedido, desça até “Devolução de dinheiro” e
            toque em “Devolver R$ …”. O app pede a devolução ao Mercado Pago e
            mostra ali quando ela terminar. Se preferir devolver direto no
            painel do Mercado Pago, depois toque em “Já estornei no Mercado
            Pago”, na lista “Devolver agora” (no aviso de pedidos cancelados,
            ícone ao lado do título Pedidos).
          </li>
          <li>
            Para enviar o produto: o painel não reabre pedido cancelado. O envio
            fica por sua conta, fora do app: o pedido continua cancelado aqui, e
            a peça já voltou ao estoque — tire as unidades enviadas à mão no
            cadastro do produto (campo “Quantidade em Estoque”). Esse pedido vai
            continuar no aviso de pedidos cancelados como “Estorno devido”, e a
            ficha dele vai continuar mostrando o botão “Devolver R$ …”. Não
            toque nele: depois de enviar, devolver é perder o produto e o
            dinheiro. Para quem abrir o pedido depois saber, escreva em
            “Anotações internas” da ficha: produto enviado em [data], combinado
            com o cliente, não devolver. Não toque em “Já estornei”: nenhum
            dinheiro foi devolvido.
          </li>
        </ol>
      </div>
    </div>
  );
}
