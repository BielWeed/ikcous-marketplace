/**
 * Lado do APP da loja fora do ar (caça de 26/11/2026).
 *
 * Quando o porteiro responde que a loja está `adormecida` ou `encerrada`, o
 * Service Worker apaga TODAS as páginas guardadas e manda `TIPO_LOJA_FECHADA`
 * a cada aba. Sem isto, a aba que já estava aberta (ou que acabou de abrir a
 * vitrine guardada) seguia vendendo: o carrinho e o PIX vão direto ao banco
 * da loja, num pedido que ninguém atende. A aba recarrega, e a recarga (já sem
 * página guardada) mostra a página da loja fechada.
 *
 * A recarga passa pelo MESMO veto de toda recarga do app
 * (`recarregarSeSeguro`): com gravação em curso ou pedido pendente do
 * checkout, ela não interrompe — fica pendente para o próximo ponto seguro.
 * Mensagem desconhecida é ignorada sem erro: o canal do Service Worker também
 * carrega o pulso (`HEARTBEAT_ACK`) e o aviso de pedido.
 */
import { recarregarSeSeguro } from "./atualizacao/veto-de-recarga";
import { TIPO_LOJA_FECHADA } from "./aviso-da-loja-fechada";

function ehAvisoDaLojaFechada(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as { tipo?: unknown }).tipo === TIPO_LOJA_FECHADA;
}

/** Devolve a função que remove o ouvinte. */
export function instalarReceptorDaLojaFechada(
  recarregar: () => void = () => window.location.reload(),
): () => void {
  const servico =
    typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!servico) return () => {};

  const aoReceber = (event: MessageEvent) => {
    if (!ehAvisoDaLojaFechada(event.data)) return;
    recarregarSeSeguro(recarregar);
  };

  servico.addEventListener("message", aoReceber as EventListener);
  return () =>
    servico.removeEventListener("message", aoReceber as EventListener);
}
