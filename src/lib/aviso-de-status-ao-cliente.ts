import { caminhoDoPedidoNoAviso } from "@/lib/alvo-do-aviso";
import { rotuloDoStatusParaACliente } from "@/lib/mensagem-do-status-no-whatsapp";
import {
  descricaoDePushSemConfirmacao,
  falhaDePushSemConfirmacao,
  motivoDaFalhaEmPortugues,
} from "@/lib/motivo-da-falha-de-push";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { CAMPO_DO_CARIMBO_DO_AVISO } from "@/lib/ordem-do-aviso-do-pedido";
import { supabase } from "@/lib/supabase";
import type { Order, OrderStatus } from "@/types";
import { toast } from "sonner";

/** O que o aviso precisa saber do pedido: para quem vai e se é retirada. O
 *  `updatedAt` (a última gravação que a tela conhece) é opcional: só serve de
 *  piso ao carimbo quando a hora do banco desta mudança não veio. */
export type PedidoDoAviso = Pick<Order, "userId" | "retiradaNaLoja"> &
  Partial<Pick<Order, "updatedAt">>;

/** O último carimbo que ESTE aparelho pôs num aviso de cada pedido: o piso do
 *  próximo aviso sem a hora do banco (ver `avisarOClienteDoStatus`). */
const ultimoCarimboDoPedido = new Map<string, number>();

/** O `updated_at` da linha que a gravação do status devolveu (as RPCs do
 *  painel devolvem a linha do pedido inteira) ou que a releitura do pedido
 *  leu (gravação confirmada sem a resposta, cancelamento pela edge), ou
 *  `null` quando a linha não o traz (resposta vazia, versão antiga). */
export function horaGravadaNoBanco(linhaGravada: unknown): string | null {
  if (
    linhaGravada === null ||
    typeof linhaGravada !== "object" ||
    Array.isArray(linhaGravada)
  ) {
    return null;
  }
  const hora = (linhaGravada as { updated_at?: unknown }).updated_at;
  return typeof hora === "string" && hora !== "" ? hora : null;
}

/** Push de "seu pedido agora está: …" depois de o status ser gravado. Nunca
 *  lança: a falha vira aviso amarelo para a lojista.
 *
 *  Fonte única do aviso de status: a ficha do pedido
 *  (AdminOrdersView.handleStatusChange) chama ao gravar com rede, e a fila
 *  offline (useOrders, `processarFilaOfflineDePedidos`) chama quando a
 *  mudança guardada sem internet é gravada ao reconectar. Quem chama decide
 *  SE avisa (silencioso, pedido sem conta); o texto e o envio moram aqui. */
export async function avisarOClienteDoStatus(
  orderId: string,
  newStatus: OrderStatus,
  alvo: PedidoDoAviso,
  /** `updated_at` que o BANCO gravou nesta mudança (ver `horaGravadaNoBanco`).
   *  Nunca o `updatedAt` do pedido da tela: esse é de ANTES da mudança. Pode
   *  vir como promessa (o cancelamento pela edge lê a hora DEPOIS de
   *  devolver, para a ficha não esperar): o aviso espera por ela. */
  gravadoNoBancoEm?: string | null | PromiseLike<string | null>,
) {
  // Relógio local tirado AGORA (status já gravado), antes de qualquer espera.
  const agora = Date.now();
  // A promessa que falha é "sem hora do banco": o aviso nunca lança.
  const horaGravada = await Promise.resolve(gravadoNoBancoEm).catch(() => null);
  // Carimbo de ordem do aviso: os avisos de status do mesmo pedido são
  // disparados sem esperar um pelo outro e podem chegar trocados. O aparelho
  // mantém na bandeja o de carimbo maior (`ordem-do-aviso-do-pedido.ts`).
  // Vale a hora em que o BANCO gravou a mudança: o relógio do aparelho da
  // lojista pode estar adiantado, e um aviso de um PC adiantado passava por
  // cima do aviso mais novo dado de um celular de relógio certo. Sem ela,
  // o relógio local, tirado antes de qualquer espera de rede — mas nunca
  // abaixo do que já se sabe do pedido (o último aviso deste aparelho e a
  // última gravação que a tela conhece), +1 ms: com o relógio ATRASADO, o
  // aviso sem hora do banco saía mais "velho" que o anterior (que saiu com
  // ela) e o celular da cliente o descartava. Mesmo campo, mesmo número em
  // ms: o service worker já instalado nas clientes não muda nada.
  const horaDoBanco =
    typeof horaGravada === "string" ? Date.parse(horaGravada) : Number.NaN;
  const ultimoDoAparelho =
    ultimoCarimboDoPedido.get(orderId) ?? Number.NEGATIVE_INFINITY;
  const piso = Math.max(
    ultimoDoAparelho,
    Date.parse(alvo.updatedAt ?? "") || Number.NEGATIVE_INFINITY,
  );
  const emitidoEm = Number.isFinite(horaDoBanco)
    ? horaDoBanco
    : Math.max(agora, piso + 1);
  ultimoCarimboDoPedido.set(orderId, Math.max(emitidoEm, ultimoDoAparelho));
  // Os avisos amarelos dizem DE QUAL pedido são: a passada da fila offline
  // chama isto em qualquer tela do painel, um por item, e avisos iguais
  // empilhados não diziam à lojista a quem mandar WhatsApp.
  const numero = numeroDoPedido(orderId);
  try {
    const title = "Status do Pedido Atualizado";
    const body = `Seu pedido #${numero} agora está: ${rotuloDoStatusParaACliente(newStatus, alvo.retiradaNaLoja)}`;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    const { data: envio, error: erroDoInvoke } =
      await supabase.functions.invoke("send-push", {
        body: {
          targetUserId: alvo.userId,
          title,
          body,
          // Sem `url` o toque no aviso caía na vitrine ("/").
          url: caminhoDoPedidoNoAviso(orderId),
          data: {
            orderId,
            type: "order_status",
            [CAMPO_DO_CARIMBO_DO_AVISO]: emitidoEm,
          },
        },
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {},
      });

    if (erroDoInvoke) throw erroDoInvoke;

    // `enviados` só existe na send-push depois da PUSH-010 (#80). O teste de
    // tipo é de propósito: contra a versão antiga da função, que respondia
    // `{ success: true }` sem contagem, isto não faz nada — em vez de acusar
    // falha em todo envio. `total` 0 = a cliente nunca ligou as notificações
    // (nenhum aparelho inscrito): não é falha, então não há o que acusar.
    if (
      typeof envio?.enviados === "number" &&
      envio.enviados === 0 &&
      envio.total !== 0
    ) {
      if (envio.falhas?.some(falhaDePushSemConfirmacao)) {
        toast.warning(
          `Status do pedido #${numero} atualizado, mas não foi possível confirmar o envio do aviso`,
          {
            description: descricaoDePushSemConfirmacao(
              envio.falhas,
              "O aviso ainda pode chegar à cliente",
            ),
          },
        );
        return;
      }

      // O motivo cru vem em inglês técnico ("push service respondeu 410
      // Gone"): a lojista lê a tradução, com a inicial maiúscula.
      const motivo = envio?.falhas?.[0]
        ? motivoDaFalhaEmPortugues(envio.falhas[0])
        : null;
      toast.warning(
        `Status do pedido #${numero} atualizado, mas o push não chegou`,
        {
          description: motivo
            ? motivo.charAt(0).toUpperCase() + motivo.slice(1)
            : "Nenhum dispositivo deste cliente recebeu a notificação.",
        },
      );
    }
  } catch (err) {
    console.error("Error sending status push:", err);
    toast.warning(`Status do pedido #${numero} atualizado, mas o push falhou`, {
      description: "O cliente não foi notificado da mudança.",
    });
  }
}
