import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { EstornoEmCurso } from "@/hooks/useEstornosEmCursoDosPedidos";
import { JANELA_PEDIDOS_CANCELADOS_DIAS } from "@/lib/janela-cancelados";
import {
  TERMO_EM_ANDAMENTO,
  devolvidoPeloMercadoPagoForaDaLista,
  valorDevolverAgora,
  valorDevolverAgoraDescontandoLedger,
} from "@/lib/valor-devolver-agora";
import type { CanalDaVenda, Order } from "@/types";
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

/** Valor em reais no formato da lista ("1.234,50"). */
const reais = (valor: number) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

interface PedidoDaLista {
  id: string;
  total?: number | null;
  customer?: { name?: string | null } | null;
  /** Canal da venda (C4.2): o confirm do estorno manual fala 'no balcão' quando presencial. */
  canal?: CanalDaVenda;
  /** Achado A4 (rodada 3): o confirm de "Já devolvi" mostra o que FALTA, não o total. */
  valorDevolvidoPorDevolucao?: number;
  valorEstornado?: number;
}

interface AlertasCanceladosProps {
  /** Contagem do servidor (`analyticsStats.paidOnCancelled`): dinheiro
   * ENTROU e o pedido está cancelado — cobre as três portas de pagamento. */
  readonly pagoCanceladoCount: number;
  /** Frase já no singular/plural certo, montada na view. */
  readonly avisoPagoAposCancelado: string;
  readonly pedidosEsperandoRetorno: readonly Order[];
  readonly pedidosParaDevolverAgora: readonly Order[];
  /** L3e': estorno que o Mercado Pago já está fazendo, por pedido de
   * `pedidosParaDevolverAgora` (`useEstornosEmCursoDosPedidos`). */
  readonly estornosEmCurso: ReadonlyMap<string, EstornoEmCurso>;
  /** A consulta de cancelados pode ter vindo truncada (erro/truncagem na
   * RPC) — o aviso fica dentro do dropdown, junto de quem ele descreve. */
  readonly incompleto: boolean;
  /** Pedidos cancelados há mais de 90 dias que AINDA têm pendência real
   * (dinheiro a devolver ou mercadoria que não voltou) — o servidor conta
   * ('fora_da_janela', regra da 20261380000000). Cancelado antigo sem nada a
   * fazer não entra. 0/undefined = nenhum. Sem este número, o recorte de 90
   * dias esconderia pendência antiga em silêncio. */
  readonly foraDaJanela?: number;
  /** Pede a varredura completa (p_dias null no servidor): o dropdown fecha
   * e a lista recarrega incluindo os antigos. */
  readonly onIncluirAntigos?: () => void;
  readonly confirmandoRetornoId: string | null;
  readonly onConfirmarRetorno: (orderId: string) => void;
  readonly estornandoId: string | null;
  /** Rodada 4 (F2c): o "Já estornei" deste pedido está lendo o ledger de
   * novo antes de perguntar — o botão mostra "Conferindo…". */
  readonly conferindoEstornoId?: string | null;
  /** Rodada 4 (F2a): chamado ao ABRIR o painel — quem mostra a lista relê o
   * ledger (devolução que começou sem mudar a lista não tem outro aviso). */
  readonly onAbrir?: () => void;
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
  estornosEmCurso,
  incompleto,
  foraDaJanela,
  onIncluirAntigos,
  confirmandoRetornoId,
  onConfirmarRetorno,
  estornandoId,
  conferindoEstornoId,
  onAbrir,
  onRegistrarEstorno,
  onVerPedidos,
}: AlertasCanceladosProps) {
  const [aberto, setAberto] = useState(false);
  // "O produto voltou" devolve o estoque, então o toque só abre esta pergunta;
  // a chamada sai no botão de confirmar. O estado mora AQUI (e não dentro da
  // lista que abre e fecha): a pergunta precisa sobreviver a qualquer fechamento
  // da lista. O pedido em pauta fica guardado à parte do "aberta" para o texto
  // não esvaziar durante a animação de saída.
  const [retornoParaConfirmar, setRetornoParaConfirmar] = useState<{
    id: string;
    numero: string;
  } | null>(null);
  const [perguntaAberta, setPerguntaAberta] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const alavancaRef = useRef<HTMLButtonElement>(null);

  const temDinheiroPreso = pagoCanceladoCount > 0;
  // Os antigos pendentes (dinheiro a devolver ou mercadoria que não voltou,
  // já filtrados pelo servidor) são pendência REAL que as listas de baixo
  // ainda NÃO mostram — o botão nasce por eles do mesmo jeito, e o bloco de
  // dentro explica e oferece "Mostrar esses pedidos".
  const temForaDaJanela = (foraDaJanela ?? 0) > 0;
  const temPendencia =
    temDinheiroPreso ||
    temForaDaJanela ||
    pedidosEsperandoRetorno.length > 0 ||
    pedidosParaDevolverAgora.length > 0;

  // Fecha num clique fora e no Escape — comportamento de dropdown de
  // verdade. `pointerdown` (e não `click`) para fechar ANTES de qualquer
  // outro clique da página surtir efeito.
  useEffect(() => {
    // Com a pergunta de "O produto voltou" aberta, ela é quem responde ao
    // toque e ao Escape: a pergunta mora num portal (fora do painel para o
    // DOM), e sem esta pausa o primeiro toque nela fecharia a lista por baixo.
    if (!aberto || perguntaAberta) return;
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
      if (evento.key === "Escape") {
        setAberto(false);
        // Padrão de disclosure: quem fechou pelo teclado volta o foco para
        // o botão que abriu (não fica órfão no body).
        alavancaRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", clicouFora);
    document.addEventListener("keydown", apertouTecla);
    return () => {
      document.removeEventListener("pointerdown", clicouFora);
      document.removeEventListener("keydown", apertouTecla);
    };
  }, [aberto, perguntaAberta]);

  if (!temPendencia && !incompleto) return null;

  const titulo = temDinheiroPreso
    ? avisoPagoAposCancelado
    : "Pedidos cancelados pendentes";

  const resumoBadges = [
    pedidosEsperandoRetorno.length > 0 &&
      `produto a voltar (${pedidosEsperandoRetorno.length})`,
    pedidosParaDevolverAgora.length > 0 &&
      `devolver ao cliente (${pedidosParaDevolverAgora.length})`,
  ]
    .filter(Boolean)
    .join(" · ");
  // No caso SÓ lista incompleta (sem pendência), o nome acessível tem que
  // contar a história sozinha — "Pedidos cancelados pendentes" diria menos
  // do que o lojista precisa ouvir antes de decidir abrir.
  const descricaoBotao =
    !temPendencia && incompleto
      ? "Não foi possível confirmar a lista completa de pedidos cancelados. Toque para ver os detalhes."
      : resumoBadges
        ? `${titulo}. ${resumoBadges}`
        : titulo;

  // Badge = pedidos DISTINTOS com pendência: os das listas (dentro da
  // janela) MAIS os antigos pendentes (fora dela). Os dois grupos nunca se
  // repetem — o servidor só conta como "fora" quem não está na lista, e com
  // a busca completa (p_dias null) "fora" vira 0 e os antigos passam para as
  // listas —, então SOMAM. O dinheiro preso (`paid_on_cancelled`) é histórico
  // total, sem janela e sem descontar o que já foi devolvido: PODE conter os
  // mesmos pedidos dos dois grupos, por isso não soma por cima; entra só como
  // piso (max) para o badge nunca mostrar menos do que ele nem 0 com
  // pendência viva. O número exato por balde segue no dropdown.
  const pedidosNasListas = new Set(
    [...pedidosEsperandoRetorno, ...pedidosParaDevolverAgora].map(
      (pedido) => pedido.id,
    ),
  ).size;
  const badge = Math.max(
    pedidosNasListas + (foraDaJanela ?? 0),
    pagoCanceladoCount,
  );

  // O aviso de lista incompleta mora dentro do dropdown DESDE o desenho de
  // botão: quando as duas listas vazias podem ser MENTIRA (erro/truncagem na
  // RPC de cancelados — "ausência do card não pode significar 'falhou'",
  // teste painel-lista-estorno-devido), o sinal permanente é o próprio
  // botão, que nasce mesmo sem pendência; o texto completo fica a um clique.
  const avisoIncompleto = incompleto ? (
    <div className="relative overflow-hidden rounded-[2rem] border border-amber-500/20 bg-zinc-950/40 p-5 shadow-2xl backdrop-blur-2xl">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
          <AlertTriangle className="size-4" />
        </div>
        <p className="text-[11px] font-bold uppercase leading-relaxed tracking-widest text-amber-500">
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
        ref={alavancaRef}
        data-testid="alertas-cancelados-alavanca"
        aria-expanded={aberto}
        {...(aberto ? { "aria-controls": "alertas-cancelados-conteudo" } : {})}
        aria-label={descricaoBotao}
        title={descricaoBotao}
        onClick={() => {
          // F2a: abrir relê o ledger (nunca dentro do updater do estado —
          // ele pode rodar duas vezes no StrictMode).
          if (!aberto) onAbrir?.();
          setAberto(!aberto);
        }}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 transition-all duration-300 hover:border-amber-500/50 hover:bg-amber-500/20 active:scale-95"
      >
        <AlertTriangle className="size-4" />
        {badge > 0 ? (
          <span
            data-testid="alertas-cancelados-badge"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-black/20 bg-amber-500 px-1 text-[11px] font-black leading-none text-black"
          >
            {badge}
          </span>
        ) : (
          // Sem pendência mas com lista incompleta: o sinal permanente é o
          // "!" pulsante — o botão não pode se parecer com um estado normal
          // justamente no único cenário em que as listas vazias são mentira.
          incompleto && (
            <span
              data-testid="alertas-cancelados-badge"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 animate-pulse items-center justify-center rounded-full border border-black/20 bg-amber-500 px-1 text-[11px] font-black leading-none text-black"
            >
              !
            </span>
          )
        )}
      </button>

      {/* Celular (< sm): véu leve atrás do painel; o toque nele fecha. */}
      {aberto && (
        <div
          aria-hidden="true"
          data-testid="alertas-cancelados-veu"
          onClick={() => setAberto(false)}
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
        />
      )}

      {aberto && (
        <div
          id="alertas-cancelados-conteudo"
          // Diálogo de verdade para o leitor de tela (era um <div> solto
          // atrás de um véu): nome acessível = o do botão. Sem aria-modal de
          // propósito: de `sm` pra cima é dropdown não modal, e o mesmo
          // markup serve aos dois. Escape e toque no véu já fecham.
          role="dialog"
          aria-label={titulo}
          // Celular: folha fixa inteira DENTRO da tela (12px de cada lado),
          // rolável. De `sm` pra cima volta ao dropdown ancorado à direita
          // do botão (o `right-0` sozinho cortava o painel no celular).
          className="fixed inset-x-3 top-[10dvh] z-50 max-h-[70dvh] space-y-4 overflow-y-auto rounded-[2rem] border border-admin-border bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 sm:max-h-[min(70vh,640px)] sm:w-[min(calc(100vw-3rem),640px)]"
        >
          {avisoIncompleto}

          {/* Pedidos cancelados há mais de {JANELA} dias que AINDA têm
              pendência (dinheiro a devolver ou produto que não voltou). A
              lista de baixo olha só os cancelamentos recentes; o servidor
              (20261164000000, regra refeita na 20261380000000) conta aqui só
              os antigos com pendência real — o mesmo critério dos dois
              baldes — e o botão busca esses pedidos. O motivo do bloco é o
              BLOQUEIA da revisão de 17/09: pendência antiga nunca some em
              silêncio. Texto normal (sem caixa alta nem espaçamento largo):
              é uma frase para ler, não uma etiqueta. */}
          {temForaDaJanela && (
            <div className="relative overflow-hidden rounded-[2rem] border border-amber-500/20 bg-zinc-950/40 p-6 shadow-2xl backdrop-blur-2xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-bold leading-snug text-amber-500">
                    {foraDaJanela === 1
                      ? `1 pedido cancelado há mais de ${JANELA_PEDIDOS_CANCELADOS_DIAS} dias ainda está pendente`
                      : `${foraDaJanela} pedidos cancelados há mais de ${JANELA_PEDIDOS_CANCELADOS_DIAS} dias ainda estão pendentes`}
                  </h3>
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">
                    Têm dinheiro a devolver ao cliente ou produto que ainda não
                    voltou para a loja.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    onIncluirAntigos?.();
                    // Fechar junto: a resposta do clique é a lista
                    // recarregando por trás, não o dropdown aberto sobre ela.
                    setAberto(false);
                  }}
                  className="h-11 shrink-0 rounded-xl border-amber-500/30 bg-amber-500/10 px-5 text-sm font-bold text-amber-500 transition-all hover:bg-amber-500 hover:text-black"
                >
                  Mostrar esses pedidos
                </Button>
              </div>
            </div>
          )}

          {/* Aviso fixo: dinheiro recebido em pedido cancelado. Não some
              sozinho (sem botão de dispensar) — foi exatamente isso que fez
              o defeito passar despercebido antes, escondido só numa
              etiqueta do cartão que rola para fora de vista. */}
          {temDinheiroPreso && (
            <div className="relative overflow-hidden rounded-[2rem] border border-amber-500/30 bg-amber-500/5 p-6 shadow-2xl backdrop-blur-2xl">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent" />
              <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
                    <AlertTriangle className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-amber-500">
                      {avisoPagoAposCancelado}
                    </h3>
                    <p className="mt-1.5 text-[11px] font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
                      O dinheiro entrou e o pedido está cancelado. Veja abaixo,
                      em Devolver ao cliente, quais já podem ser devolvidos no
                      painel do Mercado Pago — os que ainda esperam a mercadoria
                      voltar aparecem em Produtos que ainda não voltaram.
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
                  className="h-11 shrink-0 rounded-xl border-amber-500/30 bg-amber-500/10 px-5 text-[11px] font-black uppercase tracking-widest text-amber-500 transition-all hover:bg-amber-500 hover:text-black"
                >
                  Ver pedidos
                </Button>
              </div>
            </div>
          )}

          {/* Produtos que ainda não voltaram — lista DERIVADA de
              `pedidosCancelados`, nunca gravada, e trata só de MERCADORIA:
              nenhuma palavra sobre dinheiro devido (a lojista que lia o
              título de dinheiro a devolver sobre pedido nunca cobrado concluía
              que devia R$ 100 a quem nunca pagou nada). Some sozinha assim que
              `confirmarRetornoDoProduto` resolve o pedido. */}
          {pedidosEsperandoRetorno.length > 0 && (
            <div className="admin-glass relative overflow-hidden rounded-[2rem] border-admin-border p-6">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">
                Produtos que ainda não voltaram
              </h3>
              <p className="mt-1.5 max-w-2xl text-[11px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                O pedido já saiu para entrega e foi cancelado. Confirme aqui só
                quando a mercadoria voltar de verdade à sua mão — é isso que
                devolve o item ao estoque. Isto não fala de dinheiro: aparece
                mesmo em pedido que nunca foi cobrado ou que já teve o pagamento
                estornado.
              </p>

              <div className="mt-5">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-amber-500">
                  Esperando o produto voltar ({pedidosEsperandoRetorno.length})
                </h4>
                <ul className="mt-3 space-y-2">
                  {pedidosEsperandoRetorno.map((pedido) => (
                    // Painel simples (onda 3): abaixo de `sm` o botão desce
                    // para a linha de baixo — lado a lado, no celular de
                    // 360px, ele deixava ~15px para o número e o cliente, e a
                    // lojista não via de qual pedido era cada botão. Só o
                    // NOME encurta; o valor nunca some.
                    <li
                      key={pedido.id}
                      className="flex flex-col gap-3 rounded-xl border border-admin-border bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-[11px] font-black uppercase tracking-widest text-white">
                          #{pedido.id.slice(-6).toUpperCase()}
                        </span>
                        <span className="flex min-w-0 items-baseline gap-1 text-[11px] font-bold uppercase text-zinc-500">
                          <span className="min-w-0 truncate">
                            {pedido.customer?.name || "Cliente"} ·
                          </span>{" "}
                          <span className="shrink-0">
                            R${" "}
                            {(pedido.total || 0).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setRetornoParaConfirmar({
                            id: pedido.id,
                            numero: pedido.id.slice(-6).toUpperCase(),
                          });
                          setPerguntaAberta(true);
                        }}
                        disabled={confirmandoRetornoId === pedido.id}
                        className="h-9 shrink-0 rounded-xl border-emerald-500/30 bg-emerald-500/10 px-4 text-[11px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-black disabled:opacity-50"
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

          {/* Devolver ao cliente (era "Estorno devido") — lista DERIVADA de
              `pedidosCancelados`, nunca
              gravada, e trata só de DINHEIRO: só existe pedido aqui quando
              `baldeDeEstorno` confirma que o pagamento ENTROU. Some sozinha
              assim que `payment_status` vira 'estornado' (webhook do Mercado
              Pago) ou o lojista registra o estorno feito à mão. O mesmo
              pedido pode aparecer nos dois baldes, cada um respondendo uma
              pergunta diferente (BLOQUEIA 2 da revisão de 26/08/2026). */}
          {pedidosParaDevolverAgora.length > 0 && (
            <div className="admin-glass relative overflow-hidden rounded-[2rem] border-admin-border p-6">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">
                Devolver ao cliente
              </h3>
              {/* L3e (lacunas de pagamento, 02/10/2026): a frase antiga
                  ("esta tela não devolve dinheiro nenhum") deixou de ser
                  verdade em 07/09/2026 — cancelar pedido PAGO que ainda não
                  saiu grava a devolução em `order_refunds` e o cron a pede
                  ao Mercado Pago sozinho. Quem acreditava e devolvia por fora
                  pagava o cliente duas vezes. A frase nova é verdadeira nos
                  DOIS casos porque se apoia no aviso por pedido, que vem das
                  linhas reais (`estornosEmCurso`), não numa regra adivinhada
                  aqui. */}
              <p className="mt-1.5 max-w-2xl text-[11px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                Os pedidos marcados com “{TERMO_EM_ANDAMENTO}” têm dinheiro
                voltando ao cliente pelo Mercado Pago — o app pede isso sozinho
                quando um pedido já pago é cancelado antes de sair para entrega.
                Nesses, NÃO devolva por outro meio (PIX, dinheiro) o valor
                marcado: o cliente receberia duas vezes. Se o aviso disser que
                não consegui confirmar, confira no painel do Mercado Pago antes.
                Os outros dependem de você: devolva ao cliente — pelo painel do
                Mercado Pago, se ele pagou por lá — e toque em “Já estornei no
                Mercado Pago”. O item some sozinho quando o estorno fica
                registrado.
              </p>

              <div className="mt-5">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-rose-500">
                  Devolver agora ({pedidosParaDevolverAgora.length})
                </h4>
                <ul className="mt-3 space-y-2">
                  {pedidosParaDevolverAgora.map((pedido) => {
                    // L3e': sem leitura ainda (ou com leitura falha), o valor
                    // é o de sempre e o aviso diz que não conferiu — nunca
                    // "nada em curso" calado.
                    const ledger: EstornoEmCurso = estornosEmCurso.get(
                      pedido.id,
                    ) ?? { tipo: "conferindo" };
                    const conferido =
                      ledger.tipo === "conferido" ? ledger : null;
                    const valor = conferido
                      ? valorDevolverAgoraDescontandoLedger(pedido, conferido)
                      : valorDevolverAgora(pedido);
                    const concluidoForaDaLista = conferido
                      ? devolvidoPeloMercadoPagoForaDaLista(
                          pedido,
                          conferido.concluido,
                        )
                      : 0;
                    return (
                      <li
                        key={pedido.id}
                        data-testid={`devolver-agora-item-${pedido.id}`}
                        className="rounded-xl border border-admin-border bg-black/20 px-4 py-3"
                      >
                        <span className="block truncate text-[11px] font-black uppercase tracking-widest text-white">
                          #{pedido.id.slice(-6).toUpperCase()}
                        </span>
                        {/* Achado 1 (rodada 2): o valor que FALTA devolver,
                            não o total do pedido — descontado o que uma
                            devolução deste pedido já devolveu por fora, e
                            (L3e') o que o Mercado Pago já está devolvendo ou
                            acabou de devolver. Painel simples (onda 3): só o
                            NOME encurta com reticência; o valor nunca some
                            (no celular de 360px, nome longo escondia o R$). */}
                        <span className="flex min-w-0 items-baseline gap-1 text-[11px] font-bold uppercase text-zinc-500">
                          <span className="min-w-0 truncate">
                            {pedido.customer?.name || "Cliente"} ·
                          </span>{" "}
                          <span
                            data-testid="devolver-agora-valor"
                            className="shrink-0"
                          >
                            R$ {reais(valor)}
                          </span>
                        </span>
                        {/* Rodada 4 (F3): UMA região viva por pedido, montada
                            junto com o item e que NÃO some quando o aviso
                            muda — leitor de tela (NVDA/JAWS) não anuncia
                            região que já nasce com conteúdo. Releitura igual
                            não re-renderiza (mesmaLeitura), então não inunda. */}
                        <div role="status" data-testid="avisos-do-estorno">
                          {/* B1c: o "Conferindo…" do botão também é DITO —
                              o botão mantém o foco, e a região viva anuncia. */}
                          {conferindoEstornoId === pedido.id && (
                            <span className="sr-only">
                              Conferindo este pedido no Mercado Pago antes de
                              perguntar…
                            </span>
                          )}
                          {/* L3e' rodada 2: um aviso por ORIGEM do dinheiro em
                            curso, cada um dizendo só o que é verdade dele —
                            "o app pediu" só quando o app pediu; a linha do
                            próprio MP (contestação) não é pedido do app; a
                            travada (5+ tentativas) não tem confirmação. O
                            "Não devolva por fora" nomeia o VALOR, nunca o
                            pedido inteiro. */}
                          {conferido && conferido.pedidoPeloApp > 0 && (
                            <span
                              data-testid="estorno-em-curso"
                              className="mt-1 block text-[11px] font-black uppercase leading-relaxed tracking-widest text-emerald-400"
                            >
                              {TERMO_EM_ANDAMENTO}: o app já pediu ao Mercado
                              Pago a devolução de R${" "}
                              {reais(conferido.pedidoPeloApp)}. Não devolva por
                              fora estes R$ {reais(conferido.pedidoPeloApp)}.
                            </span>
                          )}
                          {conferido && conferido.sistema > 0 && (
                            <span
                              data-testid="estorno-em-curso-sistema"
                              className="mt-1 block text-[11px] font-black uppercase leading-relaxed tracking-widest text-emerald-400"
                            >
                              {TERMO_EM_ANDAMENTO}: o Mercado Pago tem uma
                              devolução ou disputa em andamento de R${" "}
                              {reais(conferido.sistema)}. Não devolva por fora
                              estes R$ {reais(conferido.sistema)}.
                            </span>
                          )}
                          {conferido && conferido.semConfirmacao > 0 && (
                            <span
                              data-testid="estorno-sem-confirmacao"
                              className="mt-1 block text-[11px] font-black uppercase leading-relaxed tracking-widest text-amber-500"
                            >
                              {TERMO_EM_ANDAMENTO} sem confirmação: não consegui
                              confirmar esta devolução de R${" "}
                              {reais(conferido.semConfirmacao)} — confira no
                              painel do Mercado Pago antes de devolver por outro
                              meio.
                            </span>
                          )}
                          {concluidoForaDaLista > 0 && (
                            <span
                              data-testid="estorno-concluido-recente"
                              className="mt-1 block text-[11px] font-black uppercase leading-relaxed tracking-widest text-emerald-400"
                            >
                              Já devolvido pelo Mercado Pago: R${" "}
                              {reais(concluidoForaDaLista)} (já descontado do
                              valor acima).
                            </span>
                          )}
                          {ledger.tipo === "conferindo" && (
                            <span
                              data-testid="estorno-conferindo"
                              className="mt-1 block text-[11px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500"
                            >
                              Conferindo se o Mercado Pago já está devolvendo…
                            </span>
                          )}
                          {ledger.tipo === "nao_conferido" && (
                            <span
                              data-testid="estorno-nao-conferido"
                              className="mt-1 block text-[11px] font-black uppercase leading-relaxed tracking-widest text-amber-500"
                            >
                              Não deu para conferir se o Mercado Pago já está
                              devolvendo este pedido. Abra o pedido antes de
                              enviar o produto ou de devolver por fora.
                            </span>
                          )}
                        </div>
                        {/* Laudo #2 (L-2): a saída manual que faltava — quando
                          a notificação do MP nunca chega, era estagnado para
                          sempre. A confirmação evita registrar por engano. */}
                        <button
                          type="button"
                          // B1c (revisão do front): enquanto confere, o botão
                          // NÃO usa `disabled` (tiraria o foco do teclado):
                          // aria-disabled + aria-busy, e o clique volta cedo.
                          disabled={estornandoId === pedido.id}
                          aria-disabled={
                            conferindoEstornoId === pedido.id ? true : undefined
                          }
                          aria-busy={
                            conferindoEstornoId === pedido.id ? true : undefined
                          }
                          onClick={() => {
                            if (conferindoEstornoId === pedido.id) return;
                            onRegistrarEstorno(pedido);
                          }}
                          className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                        >
                          {conferindoEstornoId === pedido.id
                            ? "Conferindo…"
                            : estornandoId === pedido.id
                              ? "Registrando..."
                              : "Já estornei no Mercado Pago"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* A pergunta do "O produto voltou". Mesmo molde de "Desfazer o
          recebimento" (DesfazerRecebimento): "Voltar" em foco, porque a ação
          padrão é não mexer no estoque. Cada frase é verdade do servidor:
          `confirmar_retorno_do_produto` devolve os itens do pedido ao estoque
          (devolver_estoque) e carimba o retorno; um segundo toque não soma de
          novo. */}
      <AlertDialog open={perguntaAberta} onOpenChange={setPerguntaAberta}>
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black tracking-tight text-white">
              O produto do pedido #{retornoParaConfirmar?.numero} voltou?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-zinc-400">
              O estoque será devolvido: os itens deste pedido voltam para o
              estoque da loja. Confirme só se a mercadoria já voltou de verdade
              para a sua mão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2">
            {/* O Radix põe o foco no "Cancel" ao abrir: a ação padrão é voltar. */}
            <AlertDialogCancel className="h-11 rounded-xl border border-admin-border bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10">
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (retornoParaConfirmar) {
                  onConfirmarRetorno(retornoParaConfirmar.id);
                }
              }}
              className="h-11 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20"
            >
              Sim, o produto voltou
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
