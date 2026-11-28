import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { limparTelefoneBrasileiro } from "@/lib/telefone-br";
import { haptic } from "@/utils/haptic";

/**
 * "Meus pedidos" de quem está na conta: o pedido que não aparece nela
 * A consulta também acha o pedido sem conta quando há um e-mail salvo nele.
 * Sem esse e-mail, o WhatsApp só abre uma conversa com a loja.
 *
 * Só elementos de linha: vive dentro do `<p>` da lista vazia (OrderList) e do
 * rodapé da conta com pedidos (CartView). Módulo próprio: os testes que trocam
 * a OrderList por um dublê não levam este pedaço junto.
 */
export function PedidoQueNaoApareceAqui({
  whatsappDaLoja,
  onConsultarOutraConta,
}: Readonly<{
  whatsappDaLoja?: string | null;
  onConsultarOutraConta?: () => void;
}>) {
  // Mesma régua e mesmo link do "Falar com a loja" do detalhe do pedido:
  // sem número que abra conversa, nenhum botão (wa.me sem destinatário).
  const falarComALoja = lojaTemWhatsapp(whatsappDaLoja)
    ? () => {
        haptic.light();
        let numero = limparTelefoneBrasileiro(whatsappDaLoja);
        if (numero.length === 10 || numero.length === 11)
          numero = `55${numero}`;
        abrirWhatsapp(
          `https://wa.me/${numero}?text=${encodeURIComponent(
            "Olá! Fiz um pedido sem entrar na conta e quero acompanhar. Podem me ajudar a localizar o pedido?",
          )}`,
        );
      }
    : null;
  return (
    <>
      Comprou sem entrar na conta? Esse pedido não aparece nesta lista. Se você
      deixou seu e-mail, consulte com ele, o WhatsApp da compra e o número do
      pedido; vamos mandar um código para esse e-mail. Se não deixou, fale com a
      loja e informe o número do pedido.
      {falarComALoja && (
        <span className="mt-3 block">
          <button
            type="button"
            onClick={falarComALoja}
            className="min-h-11 px-2 text-sm font-semibold text-foreground underline underline-offset-4"
          >
            Falar com a loja no WhatsApp
          </button>
        </span>
      )}
      {onConsultarOutraConta && (
        <span className="mt-3 block">
          <button
            type="button"
            onClick={onConsultarOutraConta}
            className="min-h-11 px-2 text-sm font-semibold text-foreground underline underline-offset-4"
          >
            Consultar pedido
          </button>
        </span>
      )}
    </>
  );
}
