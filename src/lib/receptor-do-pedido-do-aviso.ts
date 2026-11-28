/**
 * Lado do APP do toque num aviso do painel que aponta para um pedido
 * (`/admin-orders?id=X`): "Pedido novo", mas também "Pedido pago", "Cliente
 * cancelou", "Contestação de pagamento para conferir", "Cobrança de cartão
 * duplicada?"…
 *
 * Com o painel já aberto em Pedidos, o Service Worker não recarrega mais a
 * janela (recarregar apagava a anotação ou o código de rastreio digitados e
 * não salvos, e uma gravação em curso perdia a resposta): ele foca a janela e
 * manda `TIPO_ABRIR_PEDIDO_DO_AVISO`, com o título e o corpo da notificação
 * (que o toque já tirou da bandeja). Aqui o app decide:
 *
 * - sem trabalho em andamento: abre o pedido do aviso por dentro do roteador;
 * - com trabalho em andamento (`haOperacaoSensivel`: a ficha registra
 *   "anotacao-do-pedido" enquanto há texto não salvo ou gravação): NÃO troca
 *   de tela; repassa o aviso (o que o push dizia, de qual pedido) com um
 *   `abrir` que reconfere a MESMA guarda no toque.
 *
 * Nos dois casos CONFIRMA o recebimento pelo canal que veio na mensagem. Sem
 * confirmação (app de antes desta mudança, aba travada) o Service Worker volta
 * ao comportamento antigo e navega a janela. Mensagem desconhecida é ignorada
 * sem erro: o canal do Service Worker também carrega o pulso (`HEARTBEAT_ACK`).
 */
import { toast } from "sonner";
import { TIPO_ABRIR_PEDIDO_DO_AVISO } from "./alvo-do-aviso";
import { haOperacaoSensivel } from "./atualizacao/operacao-sensivel";
import { numeroDoPedido } from "./numero-do-pedido";

/** O aviso tocado, como chega ao app. `titulo`/`corpo` são `null` quando o
 * Service Worker é de antes desta mudança (só mandava o pedido). */
export interface AvisoDoPedidoTocado {
  pedidoId: string;
  titulo: string | null;
  corpo: string | null;
  /** Abre o pedido do aviso se a guarda deixar AGORA; devolve se abriu. */
  abrir: () => boolean;
}

interface OpcoesDoReceptor {
  abrirPedido: (pedidoId: string) => void;
  avisarSemTrocarDeTela: (aviso: AvisoDoPedidoTocado) => void;
}

function textoDaMensagem(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto === "" ? null : texto;
}

function avisoDaMensagem(
  data: unknown,
): { pedidoId: string; titulo: string | null; corpo: string | null } | null {
  if (typeof data !== "object" || data === null) return null;
  const { tipo, pedidoId, titulo, corpo } = data as {
    tipo?: unknown;
    pedidoId?: unknown;
    titulo?: unknown;
    corpo?: unknown;
  };
  if (tipo !== TIPO_ABRIR_PEDIDO_DO_AVISO) return null;
  if (typeof pedidoId !== "string" || pedidoId === "") return null;
  return {
    pedidoId,
    titulo: textoDaMensagem(titulo),
    corpo: textoDaMensagem(corpo),
  };
}

/**
 * O texto do aviso na tela. O `id` é POR PEDIDO: dois toques seguidos em
 * avisos de pedidos diferentes ficam os dois na tela (um `id` fixo fazia o
 * segundo apagar o primeiro); o mesmo pedido de novo só atualiza o seu.
 * Sem título do push (SW de antes), diz que é aviso DESTE pedido — nunca
 * "pedido novo", que mentia para contestação, cancelamento e pagamento.
 */
export function avisoNaTelaDoPedido({
  pedidoId,
  titulo,
  corpo,
}: Pick<AvisoDoPedidoTocado, "pedidoId" | "titulo" | "corpo">) {
  const numero = `#${numeroDoPedido(pedidoId)}`;
  return {
    id: `aviso-do-pedido-${pedidoId}`,
    titulo: titulo ?? `Aviso do pedido ${numero}`,
    descricao: corpo ?? `Pedido ${numero}`,
    rotuloDaAcao: `Abrir pedido ${numero}`,
    aindaOcupado: `Salve ou descarte o que está fazendo antes de abrir o pedido ${numero}.`,
  };
}

/**
 * Mostra o aviso tocado na tela do painel ocupado. Fica até a lojista agir (o
 * da bandeja já se foi). "Abrir pedido" usa `aviso.abrir`, que reconfere a
 * guarda: com o texto ainda por salvar não abre, o aviso continua na tela
 * (`preventDefault` segura o fechamento do sonner) e um segundo aviso diz por
 * quê. Abrindo, quem navega é o `handleNavigate` do App, que ainda pergunta
 * antes de descartar formulário sujo.
 */
export function mostrarAvisoDoPedidoNaTela(aviso: AvisoDoPedidoTocado): void {
  const texto = avisoNaTelaDoPedido(aviso);
  toast.info(texto.titulo, {
    id: texto.id,
    description: texto.descricao,
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: texto.rotuloDaAcao,
      onClick: (evento) => {
        if (aviso.abrir()) return;
        evento.preventDefault();
        toast.info(texto.aindaOcupado, { id: `${texto.id}-ocupado` });
      },
    },
  });
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
  avisarSemTrocarDeTela,
}: OpcoesDoReceptor): () => void {
  const servico =
    typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!servico) return () => {};

  const aoReceber = (event: MessageEvent) => {
    const aviso = avisoDaMensagem(event.data);
    if (aviso === null) return;
    const { pedidoId } = aviso;

    if (haOperacaoSensivel()) {
      // Confirma ANTES de avisar: uma falha do aviso na tela não pode virar
      // recarga da janela com o texto ainda por salvar.
      confirmar(event);
      try {
        avisarSemTrocarDeTela({
          ...aviso,
          // O toque em "Abrir pedido" pode vir muito depois: a guarda é
          // relida no toque, não a desta chegada.
          abrir: () => {
            if (haOperacaoSensivel()) return false;
            abrirPedido(pedidoId);
            return true;
          },
        });
      } catch (err) {
        console.error(
          "[AvisoDoPedido] Falha ao mostrar o aviso do pedido:",
          err,
        );
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
