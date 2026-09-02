import { Button } from "@/components/ui/button";
import type { Order } from "@/types";
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Botão de alerta do header + dropdown de detalhes (pedido do Gabriel de
 * 02/09 à tarde): a pílula colapsável da manhã ainda ocupava uma faixa
 * inteira da tela — agora é um BOTÃO redondo com o ícone de alerta no canto
 * direito da linha do título "Pedidos" (o ponto de conexão mudou para junto
 * do título, para liberar o canto), e o clique desce um DROPDOWN com os
 * detalhes. O ponto de conexão saiu, o botão entrou, os blocos de dentro
 * não mudaram UMA palavra (a história completa deles está nos comentários
 * de cada bloco, abaixo).
 *
 * FECHADO (o padrão): botão redondo âmbar com badge de contagem e a
 * frase-resumo no aria-label/title — o lembrete continua SEMPRE visível e
 * o botão é o único sinal permanente (antes era a faixa aberta).
 *
 * ABERTO (clique): os mesmos três blocos da pílula, palavra por palavra —
 * os textos honestos que as revisões lapidaram não mudaram, só o espaço.
 * O balde de MERCADORIA aparece inclusive para pedido nunca cobrado e o de
 * DINHEIRO só com pagamento entrado; as duas listas são derivadas na view
 * (`pedidosCancelados`), nunca gravadas — este componente é APRESENTAÇÃO:
 * nenhuma consulta, nenhum estado de pedido.
 *
 * Fecha no 2º clique, num clique FORA e no Escape. Sem pendência nenhuma E
 * lista completa, nem o botão nasce (mesma regra dos blocos antigos).
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
   * RPC) — o aviso fica dentro do dropdown, junto de quem ele descreve. */
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
  const raizRef = useRef<HTMLDivElement>(null);

  const temDinheiroPreso = pagoCanceladoCount > 0;
  const temPendencia =
    temDinheiroPreso ||
    pedidosEsperandoRetorno.length > 0 ||
    pedidosParaDevolverAgora.length > 0;

  // Fecha num clique fora e no Escape — comportamento de dropdown de
  // verdade. `pointerdown` (e não `click`) para fechar ANTES de qualquer
  // outro clique da página surtir efeito.
  useEffect(() => {
    if (!aberto) return;
    const clicouFora = (evento: PointerEvent | MouseEvent) => {
      if (
        raizRef.current &&
        evento.target instanceof Node &&
        !raizRef.current.contains(evento.target)
      ) {
        setAberto(false);
      }
    };
    const apertouTecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };
    document.addEventListener("pointerdown", clicouFora);
    document.addEventListener("keydown", apertouTecla);
    return () => {
      document.removeEventListener("pointerdown", clicouFora);
      document.removeEventListener("keydown", apertouTecla);
    };
  }, [aberto]);

  if (!temPendencia && !incompleto) return null;

  const titulo = temDinheiroPreso
    ? avisoPagoAposCancelado
    : "Pedidos cancelados pendentes";

  const resumoBadges = [
    pedidosEsperandoRetorno.length > 0 &&
      `produto a voltar (${pedidosEsperandoRetorno.length})`,
    pedidosParaDevolverAgora.length > 0 &&
      `estorno devido (${pedidosParaDevolverAgora.length})`,
  ]
    .filter(Boolean)
    .join(" · ");
  const descricaoBotao = resumoBadges ? `${titulo}. ${resumoBadges}` : titulo;

  // Badge = pedidos DISTINTOS com mercadoria/estorno pendentes. Quando a
  // única pendência é o dinheiro preso (lista não derivada aqui, só a
  // contagem do servidor), o badge mostra essa contagem — max dos dois
  // nunca mostra 0 com pendência viva nem inventa pedido que não está
  // em lista nenhuma. O número exato por balde segue no dropdown.
  const pedidosNasListas = new Set(
    [...pedidosEsperandoRetorno, ...pedidosParaDevolverAgora].map(
      (pedido) => pedido.id,
    ),
  ).size;
  const badge = Math.max(pedidosNasListas, pagoCanceladoCount);

  // O aviso de lista incompleta mora dentro do dropdown DESDE o desenho de
  // botão: quando as duas listas vazias podem ser MENTIRA (erro/truncagem na
  // RPC de cancelados — "ausência do card não pode significar 'falhou'",
  // teste painel-lista-estorno-devido), o sinal permanente é o próprio
  // botão, que nasce mesmo sem pendência; o texto completo fica a um clique.
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

  return (
    <div ref={raizRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="alertas-cancelados-alavanca"
        aria-expanded={aberto}
        {...(aberto ? { "aria-controls": "alertas-cancelados-conteudo" } : {})}
        aria-label={descricaoBotao}
        title={descricaoBotao}
        onClick={() => setAberto((antes) => !antes)}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 transition-all duration-300 hover:border-amber-500/50 hover:bg-amber-500/20 active:scale-95"
      >
        <AlertTriangle className="size-4" />
        {badge > 0 && (
          <span
            data-testid="alertas-cancelados-badge"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-black/20 bg-amber-500 px-1 text-[9px] font-black leading-none text-black"
          >
            {badge}
          </span>
        )}
      </button>

      {aberto && (
        <div
          id="alertas-cancelados-conteudo"
          className="absolute right-0 top-full z-50 mt-3 max-h-[min(70vh,640px)] w-[min(calc(100vw-3rem),640px)] space-y-4 overflow-y-auto rounded-[2rem] border border-white/10 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-2xl"
        >
          {avisoIncompleto}

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
                  onClick={() => {
                    onVerPedidos();
                    // Fechar antes de rolar: o dropdown não pode ficar
                    // cobrindo exatamente a lista para onde a página vai.
                    setAberto(false);
                  }}
                  className="h-11 shrink-0 rounded-xl border-amber-500/30 bg-amber-500/10 px-5 text-[10px] font-black uppercase tracking-widest text-amber-500 transition-all hover:bg-amber-500 hover:text-black"
                >
                  Ver pedidos
                </Button>
              </div>
            </div>
          )}

          {/* Produtos que ainda não voltaram — lista DERIVADA de
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
