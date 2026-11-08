/**
 * Lado do APP do toque no aviso "Pedido novo" (painel).
 *
 * Com o painel já aberto em Pedidos, o Service Worker não recarrega mais a
 * janela (recarregar apagava a anotação ou o código de rastreio digitados e
 * não salvos, e uma gravação em curso perdia a resposta): ele foca a janela e
 * manda `TIPO_ABRIR_PEDIDO_DO_AVISO`. Aqui o app decide:
 *
 * - sem trabalho em andamento: abre o pedido do aviso por dentro do roteador;
 * - com trabalho em andamento (`haOperacaoSensivel`: a ficha registra
 *   "anotacao-do-pedido" enquanto há texto não salvo ou gravação): NÃO troca
 *   de tela, só avisa que chegou pedido novo.
 *
 * Nos dois casos CONFIRMA o recebimento pelo canal que veio na mensagem. Sem
 * confirmação (app de antes desta mudança, aba travada) o Service Worker volta
 * ao comportamento antigo e navega a janela. Mensagem desconhecida é ignorada
 * sem erro: o canal do Service Worker também carrega o pulso (`HEARTBEAT_ACK`).
 */
import { TIPO_ABRIR_PEDIDO_DO_AVISO } from "./alvo-do-aviso";
import { haOperacaoSensivel } from "./atualizacao/operacao-sensivel";

interface OpcoesDoReceptor {
  abrirPedido: (pedidoId: string) => void;
  avisarPedidoNovo: () => void;
}

function pedidoDaMensagem(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { tipo, pedidoId } = data as { tipo?: unknown; pedidoId?: unknown };
  if (tipo !== TIPO_ABRIR_PEDIDO_DO_AVISO) return null;
  return typeof pedidoId === "string" && pedidoId !== "" ? pedidoId : null;
}

function confirmar(event: MessageEvent): void {
  try {
    event.ports?.[0]?.postMessage({ ok: true });
  } catch {
    // Sem confirmação o Service Worker navega a janela: o aviso não se perde.
  }
}

/** Devolve a função que remove o ouvinte. */
export function instalarReceptorDoPedidoDoAviso({
  abrirPedido,
  avisarPedidoNovo,
}: OpcoesDoReceptor): () => void {
  const servico =
    typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!servico) return () => {};

  const aoReceber = (event: MessageEvent) => {
    const pedidoId = pedidoDaMensagem(event.data);
    if (pedidoId === null) return;

    if (haOperacaoSensivel()) {
      // Confirma ANTES de avisar: uma falha do aviso na tela não pode virar
      // recarga da janela com o texto ainda por salvar.
      confirmar(event);
      try {
        avisarPedidoNovo();
      } catch (err) {
        console.error("[AvisoDoPedido] Falha ao avisar o pedido novo:", err);
      }
      return;
    }

    try {
      abrirPedido(pedidoId);
    } catch (err) {
      // Sem confirmação: o Service Worker navega (nada digitado em jogo aqui).
      console.error("[AvisoDoPedido] Falha ao abrir o pedido do aviso:", err);
      return;
    }
    confirmar(event);
  };

  servico.addEventListener("message", aoReceber as EventListener);
  return () =>
    servico.removeEventListener("message", aoReceber as EventListener);
}
