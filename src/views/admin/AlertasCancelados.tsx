import { Button } from "@/components/ui/button";
import type { Order } from "@/types";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";

/**
 * Pílula colapsável dos avisos de pedido cancelado (pedido do Gabriel de
 * 02/09: os três blocos — aviso de dinheiro preso, mercadoria a voltar e
 * estorno devido — eram GIGANTES e ficavam permanentemente abertos,
 * empurrando a lista real de pedidos para fora da tela).
 *
 * FECHADA (o padrão): uma linha com ícone de alerta, a contagem no título e
 * badges por tipo ("produto a voltar (N)", "estorno devido (M)") — o
 * lembrete continua SEMPRE visível, só deixa de ocupar a tela.
 *
 * ABERTA (clique): os mesmos três blocos de antes, palavra por palavra — os
 * textos honestos que as revisões lapidaram não mudaram, só o espaço que
 * ocupavam. O balde de MERCADORIA aparece inclusive para pedido nunca
 * cobrado e o de DINHEIRO só com pagamento entrado; as duas listas são
 * derivadas na view (`pedidosCancelados`), nunca gravadas — este componente
 * é APRESENTAÇÃO: nenhuma consulta, nenhum estado de pedido.
 *
 * Colapsa de volta no segundo clique. Sem pendência nenhuma, não renderiza
 * nada (mesma regra dos blocos antigos).
 */

interface PedidoDaLista {
  id: string;
  total?: number | null;
  customer?: { name?: string | null } | null;
}

interface AlertasCanceladosProps {
  /** Contagem do servidor (`analyticsStats.paidOnCancelled`): dinheiro
   * ENTROU e o pedido está cancelado — cobre as três portas de pagamento. */
  readonly pagoCanceladoCount: number;
  /** Frase já no singular/plural certo, montada na view. */
  readonly avisoPagoAposCancelado: string;
  readonly pedidosEsperandoRetorno: readonly Order[];
  readonly pedidosParaDevolverAgora: readonly Order[];
  /** A consulta de cancelados pode ter vindo truncada (erro/truncagem na
   * RPC) — o aviso fica dentro do expandido, junto de quem ele descreve. */
  readonly incompleto: boolean;
  readonly confirmandoRetornoId: string | null;
  readonly onConfirmarRetorno: (orderId: string) => void;
  readonly estornandoId: string | null;
  readonly onRegistrarEstorno: (pedido: PedidoDaLista) => void;
  /** Grava os filtros de cancelados e rola até a lista — o clique do lojista
   * tem resposta visível (era o "botão que não funciona" do relato). */
  readonly onVerPedidos: () => void;
}

export function AlertasCancelados({
  pagoCanceladoCount,
  avisoPagoAposCancelado,
  pedidosEsperandoRetorno,
  pedidosParaDevolverAgora,
  incompleto,
  confirmandoRetornoId,
  onConfirmarRetorno,
  estornandoId,
  onRegistrarEstorno,
  onVerPedidos,
}: AlertasCanceladosProps) {
  const [aberto, setAberto] = useState(false);

  const temDinheiroPreso = pagoCanceladoCount > 0;
  const temPendencia =
    temDinheiroPreso ||
    pedidosEsperandoRetorno.length > 0 ||
    pedidosParaDevolverAgora.length > 0;

  // O aviso de lista incompleta NÃO mora dentro da pílula nem depende de
  // pendência: ele existe justamente para o caso em que as duas listas
  // vazias podem ser MENTIRA (erro/truncagem na RPC de cancelados —
  // "ausência do card não pode significar 'falhou'", teste
  // painel-lista-estorno-devido). Se ficasse atrás da pílula — que nem
  // nasce sem pendência — o aviso ficaria invisível no único cenário em
  // que ele importa.
  const avisoIncompleto = incompleto ? (
    <div className="admin-glass relative overflow-hidden rounded-[2rem] border-amber-500/20 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
          <AlertTriangle className="size-4" />
        </div>
        <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-amber-500">
          Não foi possível confirmar a lista completa de pedidos cancelados
          agora. Os painéis de mercadoria e estorno abaixo podem estar
          incompletos.
        </p>
      </div>
    </div>
  ) : null;

  if (!temPendencia) return avisoIncompleto;

  const titulo = temDinheiroPreso
    ? avisoPagoAposCancelado
    : "Pedidos cancelados pendentes";

  return (
    <div className="space-y-3">
      {avisoIncompleto}
      <button
        type="button"
        data-testid="alertas-cancelados-alavanca"
        aria-expanded={aberto}
        aria-controls="alertas-cancelados-conteudo"
        onClick={() => setAberto((antes) => !antes)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left transition-all hover:bg-amber-500/10"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
            <AlertTriangle className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-black uppercase tracking-widest text-amber-500">
              {titulo}
            </span>
            {(pedidosEsperandoRetorno.length > 0 ||
              pedidosParaDevolverAgora.length > 0) && (
              <span className="mt-0.5 block truncate text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                {pedidosEsperandoRetorno.length > 0 &&
                  `produto a voltar (${pedidosEsperandoRetorno.length})`}
                {pedidosEsperandoRetorno.length > 0 &&
                  pedidosParaDevolverAgora.length > 0 &&
                  " · "}
                {pedidosParaDevolverAgora.length > 0 &&
                  `estorno devido (${pedidosParaDevolverAgora.length})`}
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-amber-500 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>

      {aberto && (
        <div id="alertas-cancelados-conteudo" className="space-y-4">
          {/* Aviso fixo: dinheiro recebido em pedido cancelado. Não some
              sozinho (sem botão de dispensar) — foi exatamente isso que fez
              o defeito passar despercebido antes, escondido só numa
              etiqueta do cartão que rola para fora de vista. */}
          {temDinheiroPreso && (
            <div className="admin-glass relative overflow-hidden rounded-[2rem] border-amber-500/30 bg-amber-500/5 p-6">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent" />
              <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
                    <AlertTriangle className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-500">
                      {avisoPagoAposCancelado}
                    </h3>
                    <p className="mt-1.5 text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
                      O dinheiro entrou e o pedido está cancelado. Veja abaixo,
                      em Estorno devido, quais já podem ser devolvidos no painel
                      do Mercado Pago — os que ainda esperam a mercadoria voltar
                      aparecem em Produtos que ainda não voltaram.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={onVerPedidos}
                  className="h-11 shrink-0 rounded-xl border-amber-500/30 bg-amber-500/10 px-5 text-[10px] font-black uppercase tracking-widest text-amber-500 transition-all hover:bg-amber-500 hover:text-black"
                >
                  Ver pedidos
                </Button>
              </div>
            </div>
          )}

          {/* Produtos que ainda não voltam — lista DERIVADA de
              `pedidosCancelados`, nunca gravada, e trata só de MERCADORIA:
              nenhuma palavra sobre dinheiro devido (a lojista que lia
              "Estorno devido" sobre pedido nunca cobrado concluía que devia
              R$ 100 a quem nunca pagou nada). Some sozinha assim que
              `confirmarRetornoDoProduto` resolve o pedido. */}
          {pedidosEsperandoRetorno.length > 0 && (
            <div className="admin-glass relative overflow-hidden rounded-[2rem] border-white/5 p-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Produtos que ainda não voltaram
              </h3>
              <p className="mt-1.5 max-w-2xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                O pedido já saiu para entrega e foi cancelado. Confirme aqui só
                quando a mercadoria voltar de verdade à sua mão — é isso que
                devolve o item ao estoque. Isto não fala de dinheiro: aparece
                mesmo em pedido que nunca foi cobrado ou que já teve o pagamento
                estornado.
              </p>

              <div className="mt-5">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                  Esperando o produto voltar ({pedidosEsperandoRetorno.length})
                </h4>
                <ul className="mt-3 space-y-2">
                  {pedidosEsperandoRetorno.map((pedido) => (
                    <li
                      key={pedido.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-[10px] font-black uppercase tracking-widest text-white">
                          #{pedido.id.slice(-6).toUpperCase()}
                        </span>
                        <span className="block truncate text-[9px] font-bold uppercase text-zinc-500">
                          {pedido.customer?.name || "Cliente"} · R${" "}
                          {(pedido.total || 0).toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onConfirmarRetorno(pedido.id)}
                        disabled={confirmandoRetornoId === pedido.id}
                        className="h-9 shrink-0 rounded-xl border-emerald-500/30 bg-emerald-500/10 px-4 text-[9px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-black disabled:opacity-50"
                      >
                        {confirmandoRetornoId === pedido.id
                          ? "Confirmando..."
                          : "O produto voltou"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Estorno devido — lista DERIVADA de `pedidosCancelados`, nunca
              gravada, e trata só de DINHEIRO: só existe pedido aqui quando
              `baldeDeEstorno` confirma que o pagamento ENTROU. Some sozinha
              assim que `payment_status` vira 'estornado' (webhook do Mercado
              Pago) ou o lojista registra o estorno feito à mão. O mesmo
              pedido pode aparecer nos dois baldes, cada um respondendo uma
              pergunta diferente (BLOQUEIA 2 da revisão de 26/08/2026). */}
          {pedidosParaDevolverAgora.length > 0 && (
            <div className="admin-glass relative overflow-hidden rounded-[2rem] border-white/5 p-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Estorno devido
              </h3>
              {/* A frase que não pode virar promessa falsa: o app não
                  estorna sozinho. Quem devolve o dinheiro é a lojista, no
                  painel do Mercado Pago — esta lista só lembra o que ela
                  ainda deve. */}
              <p className="mt-1.5 max-w-2xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                Estornar é uma ação sua, feita direto no painel do Mercado Pago
                — esta tela não devolve dinheiro nenhum, só lembra o que ainda
                falta resolver. O item some sozinho assim que você registra o
                estorno lá.
              </p>

              <div className="mt-5">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-rose-500">
                  Devolver agora ({pedidosParaDevolverAgora.length})
                </h4>
                <ul className="mt-3 space-y-2">
                  {pedidosParaDevolverAgora.map((pedido) => (
                    <li
                      key={pedido.id}
                      className="rounded-xl border border-white/5 bg-black/20 px-4 py-3"
                    >
                      <span className="block truncate text-[10px] font-black uppercase tracking-widest text-white">
                        #{pedido.id.slice(-6).toUpperCase()}
                      </span>
                      <span className="block truncate text-[9px] font-bold uppercase text-zinc-500">
                        {pedido.customer?.name || "Cliente"} · R${" "}
                        {(pedido.total || 0).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                      {/* Laudo #2 (L-2): a saída manual que faltava — quando
                          a notificação do MP nunca chega, era estagnado para
                          sempre. A confirmação evita registrar por engano. */}
                      <button
                        type="button"
                        disabled={estornandoId === pedido.id}
                        onClick={() => onRegistrarEstorno(pedido)}
                        className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[8.5px] font-black uppercase tracking-widest text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                      >
                        {estornandoId === pedido.id
                          ? "Registrando..."
                          : "Já estornei no Mercado Pago"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
