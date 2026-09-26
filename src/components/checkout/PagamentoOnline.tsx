import type {
  ArgsCriarPagamento,
  RespostaCriarPagamento,
} from "@/hooks/useOrders";
import { useOrders } from "@/hooks/useOrders";
import { type ConfigDoCartao, cartaoLigado } from "@/lib/config-do-cartao";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { cn, formatCurrency } from "@/lib/utils";
import { AlertCircle, Check, Clock, Copy, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PagamentoComCartao } from "./PagamentoComCartao";

// O carregador do SDK mora em módulo próprio desde o cartão (26/09/2026) —
// ver o comentário lá. Reexportado para quem já o importava daqui.
export { carregarSdkMercadoPago } from "./sdk-mercado-pago";

/**
 * De que tipo é a falha que `onErro` está reportando — ver CHECKOUT-050.
 *
 * "recuperavel": tentar de novo pode dar um resultado diferente. Cobre dois
 * casos bem distintos: a cobrança pode não ter chegado a existir (rede caiu,
 * SDK não carregou, Brick do cartão não montou) — aí `criar-pagamento` cria
 * do zero, sem `gateway_payment_id` gravado; OU o PIX voltou sem QR code num
 * 200 que JÁ CRIOU a cobrança (o UPDATE grava `gateway_payment_id` antes de
 * responder) — aí a próxima tentativa cai em `reconsultar`, que pode trazer
 * o QR que a criação não trouxe. Nos dois casos insistir é seguro; muda só o
 * caminho que `criar-pagamento` escolhe.
 *
 * "terminal": a cobrança já existe e está morta para este pedido (vencida,
 * estornada, com status que o banco não reconhece, cartão recusado sem nova
 * tentativa possível) OU a reserva do pedido já venceu. Tentar de novo bate
 * na MESMA resposta.
 *
 * Cartão recusado COM nova tentativa possível não é erro para esta tela: o
 * `PagamentoComCartao` mostra o motivo com "Tentar outro cartão" e "Pagar
 * com PIX" (spec do cartão, decisão 3).
 */
export type CategoriaErroPagamento = "recuperavel" | "terminal";

type CriarPagamento = (
  args: ArgsCriarPagamento,
) => Promise<RespostaCriarPagamento>;

type DadosDoPix = {
  qrCodeBase64?: string;
  qrCode?: string;
  expiraEm: string;
  ticketUrl?: string;
};

type ResultadoClassificacaoPagamento =
  | { tipo: "erro"; mensagem: string; categoria: CategoriaErroPagamento }
  | { tipo: "pix"; pix: DadosDoPix };

/**
 * Traduz a resposta de `criarPagamento` do PIX para o que a tela deve fazer —
 * erro (com categoria) ou QR. Até 26/09/2026 servia também ao `onSubmit` do
 * Payment Brick (`montarBrick`, CHECKOUT-080, #213); o Payment Brick saiu de
 * cena (PIX direto desde 25/09, cartão pelo Card Payment Brick desde 26/09,
 * com classificação própria em `classificarRespostaCartao`), e sobrou o PIX.
 */
function classificarRespostaPagamento(
  r: RespostaCriarPagamento,
): ResultadoClassificacaoPagamento {
  // A-1 da revisão final, vocabulário atualizado na CHECKOUT-080 (#213):
  // recusa é resultado normal de um pagamento CRIADO (o MP responde 201), não
  // erro HTTP — criarPagamento devolve `ok`. `statusPagamento` vem no
  // vocabulário FECHADO do banco ('aguardando'/'pago'/'recusado'/'expirado'/
  // 'estornado' — useOrders.ts, `StatusPagamentoConhecido`), não mais no
  // vocabulário cru do MP: a edge function já traduziu.
  if (r.statusPagamento === "recusado") {
    // `podeCobrar` (criar-pagamento/index.ts) manda para `reconsultar`
    // sempre que o pedido já tem gateway_payment_id — o que devolve o
    // status da MESMA cobrança recusada, sem criar outra. 'recusado' cobre
    // os dois desfechos que o vocabulário clássico separava em
    // "rejected"/"cancelled" — este banco não tem um valor 'cancelado'
    // distinto de 'recusado' (ver o comentário de MAPA_STATUS_ORDER em
    // supabase/functions/_shared/mercadopago.ts).
    return {
      tipo: "erro",
      mensagem:
        "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
      categoria: "terminal",
    };
  }
  if (r.statusPagamento === "expirado") {
    // CHECKOUT-080 (#213): o QR deste PIX venceu no Mercado Pago (não
    // necessariamente porque a reserva de 30 min do PEDIDO também venceu —
    // os dois prazos podem divergir, ver expiracaoRealinhavel em
    // criar-pagamento/index.ts). `reconsultar` devolve a MESMA order vencida
    // para sempre: só um pedido novo gera um QR novo.
    return {
      tipo: "erro",
      mensagem:
        "O prazo deste PIX venceu antes do pagamento ser confirmado. Faça um pedido novo para gerar um QR code novo.",
      categoria: "terminal",
    };
  }
  if (r.statusPagamento === "estornado") {
    // Um estorno desfaz um pagamento que chegou a ser aprovado — não há
    // "tentar de novo" que reverta isso para o MESMO pedido.
    return {
      tipo: "erro",
      mensagem:
        "Este pagamento foi estornado e não pode ser confirmado neste pedido. Faça um pedido novo ou fale com a loja.",
      categoria: "terminal",
    };
  }
  const statusConhecido =
    r.statusPagamento === "aguardando" || r.statusPagamento === "pago";
  if (!statusConhecido) {
    // Rede de segurança OBRIGATÓRIA (item 4 da CHECKOUT-080, #213): status
    // novo/desconhecido do MP (ou AUSENTE — function antiga ainda no ar, ver
    // teste dedicado) não pode virar sucesso silencioso, e reconsultar não
    // muda o que o MP já respondeu.
    return {
      tipo: "erro",
      mensagem: "Não foi possível confirmar o pagamento.",
      categoria: "terminal",
    };
  }
  if (!r.qrCode && !r.qrCodeBase64) {
    // Nunca sinaliza sucesso sem QR de verdade — sem QR o cliente ficaria
    // preso numa tela vazia, sem volta, com o pedido morrendo em 30 min de
    // reserva. Recuperável: a cobrança em si não existe de forma útil, e uma
    // nova tentativa cria/reconsulta do zero sem risco de duplicar cobrança.
    return {
      tipo: "erro",
      mensagem: "Não foi possível gerar o QR code do PIX.",
      categoria: "recuperavel",
    };
  }
  return {
    tipo: "pix",
    pix: {
      qrCodeBase64: r.qrCodeBase64,
      qrCode: r.qrCode,
      expiraEm: r.expiraEm,
      ticketUrl: r.ticketUrl,
    },
  };
}

/**
 * Promessas de `criarPagamento` em voo (ou já resolvidas, até o `finally`
 * limpar), por `orderId` — mesmo padrão de `promessaSdk` acima, aplicado a um
 * problema análogo: o StrictMode do React 18 monta → desmonta → remonta o
 * efeito de forma SÍNCRONA, tudo antes de qualquer microtarefa rodar. Sem
 * este cache, a segunda montagem chamaria `criarPagamento` de novo ANTES da
 * primeira resposta voltar — duas cobranças para o mesmo pedido.
 *
 * A entrada some do mapa assim que a promessa assenta (sucesso OU falha): é
 * isso que faz "Tentar de novo" (CheckoutView troca a tela de erro por um
 * `<PagamentoOnline>` NOVO, remontando o componente do zero) disparar uma
 * chamada de verdade — pelo momento em que o cliente consegue clicar, a
 * tentativa anterior já assentou e já saiu do mapa.
 */
const promessasPagamentoPix = new Map<
  string,
  Promise<RespostaCriarPagamento>
>();

/**
 * Dispara a cobrança PIX direto — sem Brick, sem pedir e-mail de novo.
 *
 * Pedido do dono (25/09/2026): depois de escolher "Pagar agora com PIX", o
 * cliente caía na tela do Payment Brick do Mercado Pago pedindo para
 * escolher Pix DE NOVO e digitar um e-mail que a conta já tem. Como o Brick
 * de então só oferecia PIX (o cartão, Fase 3.5, voltou em 26/09/2026 pelo
 * Card Payment Brick — `PagamentoComCartao.tsx`), a Brick inteira era uma
 * etapa a mais sem função: `email` e
 * `documento` são OPCIONAIS em `criarPagamento` (useOrders.ts) — o servidor
 * já resolve o e-mail por `body.email ?? pedido.customer_data.email ?? emailDoToken(...) ?? "sem-email@ikcous.com.br"`
 * (criar-pagamento/index.ts) — então não há nada que só o Brick soubesse
 * coletar.
 *
 * A classificação da resposta (recusado/expirado/estornado/desconhecido/QR
 * ausente) mora em `classificarRespostaPagamento`, acima.
 *
 * Exportada para teste — não é API pública do componente.
 */
export function dispararPagamentoPix({
  orderId,
  criarPagamento,
  onErro,
  onPix,
}: {
  orderId: string;
  criarPagamento: CriarPagamento;
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
  onPix: (pix: DadosDoPix) => void;
}): () => void {
  let cancelado = false;

  let promessa = promessasPagamentoPix.get(orderId);
  if (!promessa) {
    promessa = criarPagamento({ orderId, metodo: "pix" });
    promessasPagamentoPix.set(orderId, promessa);
    const removerDoCache = () => {
      // Só remove se ninguém trocou a entrada por uma promessa mais nova
      // enquanto esta estava em voo (corta a corrida com uma chamada futura
      // que já tenha substituído o valor do mapa).
      if (promessasPagamentoPix.get(orderId) === promessa) {
        promessasPagamentoPix.delete(orderId);
      }
    };
    // `.then(f, f)` e não `.finally(f)`: `.finally` devolve uma promessa
    // DERIVADA que continua rejeitando quando a original rejeita — sem
    // ninguém para dar `.catch` nela, vira rejeição não tratada. Os dois
    // branches de `.then` CONSOMEM a rejeição, e o resultado (usado ou não)
    // nunca sobra pendurado.
    promessa.then(removerDoCache, removerDoCache);
  }

  promessa
    .then((r) => {
      if (cancelado) return;
      const resultado = classificarRespostaPagamento(r);
      if (resultado.tipo === "erro") {
        onErro(resultado.mensagem, resultado.categoria);
        return;
      }
      onPix(resultado.pix);
    })
    .catch((err: any) => {
      if (cancelado) return;
      // Contrato do CHECKOUT-050: `.terminal`
      // vindo de `criarPagamento` (useOrders.ts) é um DADO lido do corpo do
      // 409/etc. da edge function, nunca reconstruído a partir do texto da
      // mensagem — texto que muda quebraria uma comparação por igualdade.
      const terminal = err?.terminal === true;
      onErro(
        err?.message ?? "Não foi possível gerar a cobrança.",
        terminal ? "terminal" : "recuperavel",
      );
    });

  return () => {
    cancelado = true;
  };
}

function formatarHora(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Por onde o cliente paga pelo app: PIX (padrão) ou cartão (Fase 3.5). */
export type MetodoOnline = "pix" | "cartao";

/**
 * A tela de pagamento pelo app, depois de o pedido nascer.
 *
 * `metodo="pix"` (padrão): gera a cobrança PIX sozinho, ao montar.
 * `metodo="cartao"`: mostra o Card Payment Brick e NUNCA cria PIX sozinho —
 * o PIX só nasce se o cliente tocar em "Pagar com PIX" (depois de uma
 * recusa, por exemplo), na mesma tela e na mesma reserva de 30 minutos.
 * `onTrocarParaPix` avisa o pai dessa troca, para um "Tentar de novo" do
 * CheckoutView remontar já no PIX.
 */
export function PagamentoOnline({
  orderId,
  valor,
  onErro,
  metodo = "pix",
  configDoCartao = null,
  emailDoPagador,
  onTrocarParaPix,
}: {
  orderId: string;
  valor: number;
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
  metodo?: MetodoOnline;
  configDoCartao?: ConfigDoCartao | null;
  emailDoPagador?: string | null;
  onTrocarParaPix?: () => void;
}) {
  const [trocouParaPix, setTrocouParaPix] = useState(false);
  const pagarComPix = () => {
    setTrocouParaPix(true);
    onTrocarParaPix?.();
  };

  if (metodo === "cartao" && !trocouParaPix) {
    if (configDoCartao && cartaoLigado(configDoCartao)) {
      return (
        <PagamentoComCartao
          orderId={orderId}
          valor={valor}
          config={configDoCartao}
          emailDoPagador={emailDoPagador}
          onErro={onErro}
          onPagarComPix={pagarComPix}
        />
      );
    }
    // A loja desligou o cartão entre a escolha e a tela de pagamento (ou a
    // config sumiu). Não cria PIX por conta própria: o cliente escolhe.
    return (
      <div className="mx-auto w-full max-w-md space-y-3 rounded-2xl border border-zinc-100 bg-white p-4 text-center sm:p-6">
        <p className="text-sm text-zinc-700">
          O pagamento com cartão não está disponível nesta loja agora.
        </p>
        <button
          type="button"
          onClick={pagarComPix}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white active:bg-zinc-700"
        >
          Pagar com PIX
        </button>
      </div>
    );
  }

  return <PagamentoComPix orderId={orderId} valor={valor} onErro={onErro} />;
}

function PagamentoComPix({
  orderId,
  valor,
  onErro,
}: {
  orderId: string;
  valor: number;
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
}) {
  // Achado 4 da revisão do CHECKOUT-090 (16/08/2026): `isAdmin=false`, não
  // `true` — este componente é do CLIENTE. Era inofensivo porque
  // `enabled=false` desliga o efeito inteiro antes de `isAdmin` importar
  // (useOrders.ts), mas era a mesma forma do bug que a tarefa corrigiu em
  // CheckoutView. `enabled=false` continua CORRETO aqui: este componente só
  // usa `criarPagamento` e não precisa de realtime — quem detecta a
  // confirmação de pagamento é o CheckoutView, não ele.
  const { criarPagamento } = useOrders(false, false);
  // `expiraEm` vem junto do PIX, da resposta da edge function — é o prazo que
  // está gravado na linha do pedido, o mesmo que o pg_cron vai ler.
  const [pix, setPix] = useState<DadosDoPix | null>(null);

  // Padrão de ref para callback em recurso imperativo. `onErro` é tipicamente
  // um closure inline de quem consome o componente (`onErro={(m) =>
  // setErro(m)}`), e MUDA de identidade a cada re-render do pai — um toast,
  // um evento realtime do useOrders, o aviso estimado de prazo. Se
  // `onErro` estivesse nas deps do efeito abaixo, cada re-render do pai
  // dispararia `criarPagamento` de novo, silenciosamente (na época do
  // Payment Brick, desmontava o Brick vivo com o formulário digitado — o
  // cartão, `PagamentoComCartao.tsx`, usa o mesmo padrão pelo mesmo motivo).
  //
  // A atualização do `.current` vai num `useEffect` sem deps (roda depois de
  // TODO render), não direto no corpo do componente: mutar ref durante o
  // render é erro do `eslint-plugin-react-hooks` ("Cannot access refs during
  // render") — o valor só precisa estar atualizado antes da PRÓXIMA vez que
  // um callback assíncrono o ler, nunca durante a renderização.
  const onErroRef = useRef(onErro);
  useEffect(() => {
    onErroRef.current = onErro;
  });

  // Relógio do prazo — AVISO ESTIMADO, nunca decisão. `agora` é o relógio
  // DESTE aparelho, e relógio de celular erra (o mesmo risco que o
  // CheckoutView documenta no comentário de TETO_TICKS_VERIFICACAO_PAGAMENTO):
  // um aparelho 40 min adiantado veria o horário "passar" com o Pix ainda
  // valendo no servidor. Por isso, passado o horário previsto, a tela só
  // AVISA com prudência — QR, código, botão de copiar e link continuam
  // funcionando até o servidor decidir; o CheckoutView acompanha a confirmação
  // do pagamento. Nada aqui muda status de pagamento, reserva nem
  // cria cobrança.
  const [agora, setAgora] = useState(() => Date.now());
  // Postgres pode devolver frações com 1 a 6 dígitos, enquanto o formato
  // interoperável de Date.parse usa milissegundos (3). Completar/truncar a
  // fração preserva o instante e o fuso sem depender de parsers permissivos.
  const expiraEmMs = pix
    ? Date.parse(
        pix.expiraEm.replace(
          /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/i,
          (_, fracao: string) => `.${fracao.padEnd(3, "0").slice(0, 3)}`,
        ),
      )
    : Number.NaN;
  const prazoConhecido = Number.isFinite(expiraEmMs);
  const horarioPrevistoPassou = prazoConhecido && agora >= expiraEmMs;

  useEffect(() => {
    if (!prazoConhecido) return;
    const atualizar = () => setAgora(Date.now());
    // Sem contagem regressiva: a resposta não traz a hora do servidor, então
    // um aparelho atrasado inventaria minutos de validade. A checagem local
    // serve só para mostrar ou retirar o aviso prudente. Continua ativa
    // depois do horário para reagir se o próprio relógio for corrigido.
    const id = setInterval(atualizar, 10_000);
    document.addEventListener("visibilitychange", atualizar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", atualizar);
    };
  }, [prazoConhecido]);

  useEffect(() => {
    return dispararPagamentoPix({
      orderId,
      criarPagamento,
      onErro: (msg, categoria) => onErroRef.current(msg, categoria),
      // `agora` nasce na montagem, que pode ter sido minutos antes do QR
      // chegar: sincroniza junto do Pix para o aviso começar correto.
      onPix: (dados) => {
        setAgora(Date.now());
        setPix(dados);
      },
    });
    // `onErro` de propósito fora das deps — ver o comentário do onErroRef
    // acima. O disparo só repete se `orderId` (primitivo) ou `criarPagamento`
    // (useCallback(..., []) em useOrders.ts) mudarem de identidade — na
    // prática, só remontando o componente inteiro (CheckoutView troca a
    // tela de erro por um `<PagamentoOnline>` novo em "Tentar de novo").
  }, [orderId, criarPagamento]);

  // Brief "o app não mente quando copia" (08/09/2026): o botão chamava
  // `navigator.clipboard.writeText(...)` sem await, sem catch e sem NENHUM
  // aviso — nem quando dava certo. Agora `copiarParaClipboard` (mesma peça do
  // painel) diz o que aconteceu de verdade: sucesso muda o próprio texto do
  // botão por ~2s (o botão está no centro da atenção nesta tela — um toast
  // sumiria sem ninguém notar); falha mostra o código num campo selecionável,
  // porque sem cópia automática o cliente ainda precisa conseguir pagar.
  const [pixCopiado, setPixCopiado] = useState(false);
  const [pixFalhouCopia, setPixFalhouCopia] = useState(false);
  // Um timer só por vez: dois toques seguidos em "Copiar" deixavam o timer do
  // PRIMEIRO apagar o "Copiado!" do segundo antes dos 2s, e o timer
  // sobrevivia à desmontagem da tela.
  // `montadoRef` fecha a janela do `await` da cópia: se a tela desmontar com
  // o clipboard ainda respondendo, o timer não chega a ser armado depois da
  // limpeza (achado 3 da revisão independente, 24/09/2026).
  const timerCopiadoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const montadoRef = useRef(false);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      if (timerCopiadoRef.current) clearTimeout(timerCopiadoRef.current);
      timerCopiadoRef.current = null;
    };
  }, []);

  const handleCopiarPix = async (codigo: string) => {
    // Laudo Opus A-1 (08/09/2026): `classificarRespostaPagamento` só recusa
    // o PIX quando faltam OS DOIS campos — a edge extrai `qr_code` e
    // `qr_code_base64` em separado, então o estado `{qrCodeBase64,
    // qrCode: undefined}` é alcançável. Sem esta guarda,
    // `copiarParaClipboard("")` resolveria `true` e o botão diria "Copiado!"
    // sem ter copiado nada. O botão já não renderiza quando `!pix.qrCode`
    // (abaixo); esta é a segunda trava, para uma refatoração futura que volte
    // a renderizar o botão sem QR não reabrir o mesmo defeito.
    //
    // SEM trava de horário aqui, de propósito: o relógio do aparelho não é
    // prova de vencimento (ver o comentário do relógio do prazo, acima).
    const ok = codigo !== "" && (await copiarParaClipboard(codigo));
    if (!montadoRef.current) return;
    if (!ok) {
      setPixFalhouCopia(true);
      return;
    }
    setPixFalhouCopia(false);
    setPixCopiado(true);
    if (timerCopiadoRef.current) clearTimeout(timerCopiadoRef.current);
    timerCopiadoRef.current = setTimeout(() => {
      timerCopiadoRef.current = null;
      setPixCopiado(false);
    }, 2000);
  };

  const idTitulo = useId();
  const idAvisoHorario = useId();

  if (pix) {
    const valorConhecido = Number.isFinite(valor) && valor > 0;
    const descritoPeloAviso = horarioPrevistoPassou
      ? idAvisoHorario
      : undefined;

    // Ordem pensada para o CELULAR (24/09/2026): quem paga no mesmo aparelho
    // não consegue escanear a própria tela — o caminho dele é copiar e colar
    // no app do banco. Por isso valor → prazo → botão de copiar vêm antes do
    // QR; o QR fica logo abaixo para quem paga lendo com outro aparelho.
    return (
      <section
        aria-labelledby={idTitulo}
        className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-zinc-100 bg-white p-4 sm:p-6"
      >
        <header className="space-y-1 text-center">
          <h2
            id={idTitulo}
            className="text-xs font-bold uppercase tracking-wider text-zinc-500"
          >
            Pagamento via Pix
          </h2>
          {valorConhecido && (
            <p className="text-3xl font-black tabular-nums text-zinc-900">
              {formatCurrency(valor)}
            </p>
          )}
          {orderId && (
            <p className="text-xs text-zinc-500">
              Pedido #{orderId.slice(0, 8)}
            </p>
          )}
        </header>

        {/* Prazo. Só o horário INFORMADO, sem contagem regressiva: a
            resposta não traz a hora do servidor, e um aparelho atrasado
            inventaria minutos de validade (ver o efeito do relógio acima).
            Passado o horário previsto, esta caixa sai e fica só o aviso
            abaixo, que já traz o horário — duas caixas âmbar empilhadas
            diziam a mesma coisa duas vezes na tela pequena. */}
        {!horarioPrevistoPassou && (
          <p className="flex items-start gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-700">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {prazoConhecido ? (
              <span>
                Prazo informado: até{" "}
                <strong className="tabular-nums">
                  {formatarHora(expiraEmMs)}
                </strong>
                . Confira a validade no app do seu banco.
              </span>
            ) : (
              // Prazo ilegível: não inventar horário nem declarar vencido —
              // o botão continua valendo e o banco do cliente mostra a
              // validade.
              <span>
                Não conseguimos ler o prazo deste Pix. Confira a validade no app
                do seu banco antes de pagar.
              </span>
            )}
          </p>
        )}

        {/* Região viva SEMPRE montada (mesmo motivo do Laudo Opus A-2,
            abaixo): o aviso do horário previsto aparece DENTRO dela, e o
            leitor de tela só anuncia mudança em região que já existia. Sem
            `role="status"` de propósito — esse papel é da região de falha de
            cópia, e há teste que a acha pelo papel.

            O texto é PRUDENTE de propósito: quem sabe se o Pix venceu é o
            servidor, não o relógio deste aparelho. Nada de "expirou". */}
        <div aria-live="polite">
          {horarioPrevistoPassou && (
            <div
              id={idAvisoHorario}
              className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
            >
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-amber-600"
              />
              <div className="space-y-1 text-sm text-amber-800">
                <p className="font-semibold">
                  O horário previsto para pagar já passou.
                </p>
                <p>
                  O prazo informado era até {formatarHora(expiraEmMs)}, e pelo
                  relógio deste aparelho esse horário já passou. Se você já
                  pagou, continue nesta tela: a confirmação aparece aqui. Se
                  ainda não pagou, o banco pode recusar este código — nesse
                  caso, faça um pedido novo.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Laudo Opus A-1 (08/09/2026): sem `qrCode` não existe código para
            copiar — não oferecer o botão nem o campo de falha. O cliente
            segue pelo QR abaixo e pelo link "Pagar pelo Mercado Pago", que
            já são condicionais ao próprio campo existir. */}
        {pix.qrCode && (
          <div className="space-y-2">
            {/* Alvo de toque de 48px (min-h-12) e texto de 14px: é a ação
                principal no celular. */}
            <button
              type="button"
              aria-describedby={descritoPeloAviso}
              onClick={() => handleCopiarPix(pix.qrCode ?? "")}
              className={cn(
                "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-colors",
                pixCopiado
                  ? "bg-emerald-700"
                  : "bg-zinc-900 active:bg-zinc-700",
              )}
            >
              {pixCopiado ? (
                <Check aria-hidden="true" className="size-5" />
              ) : (
                <Copy aria-hidden="true" className="size-5" />
              )}
              <span aria-live="polite">
                {pixCopiado
                  ? "Copiado! Cole no app do seu banco"
                  : "Copiar código PIX"}
              </span>
            </button>
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Código copia e cola
              </p>
              {/* O clamp mora no <span>: no <p> com padding, a sobra da
                  3ª linha aparecia cortada ao meio dentro do padding. */}
              <p className="select-all break-all rounded-xl border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs text-zinc-800">
                <span className="line-clamp-2">{pix.qrCode}</span>
              </p>
            </div>
            {/* Laudo Opus A-2 (08/09/2026): container SEMPRE montado (vazio
                por padrão) com `role="status"`/`aria-live="polite"` — antes
                o <div> só entrava no DOM quando `pixFalhouCopia` virava true,
                e o leitor de tela precisa que a região JÁ EXISTA para
                anunciar o texto que aparece nela; inseri-la depois do fato
                silenciava exatamente o caso que precisa de aviso. */}
            <div role="status" aria-live="polite" className="space-y-1.5">
              {pixFalhouCopia && (
                <>
                  <p className="text-center text-sm text-zinc-600">
                    Não consegui copiar sozinho. Toque no código abaixo, segure
                    e copie.
                  </p>
                  <textarea
                    readOnly
                    aria-label="Código Pix para copiar manualmente"
                    value={pix.qrCode ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-2 font-mono text-sm text-zinc-900"
                  />
                </>
              )}
            </div>
          </div>
        )}

        {pix.qrCodeBase64 ? (
          <figure className="space-y-2">
            {pix.qrCode && (
              <figcaption className="text-center text-xs text-zinc-500">
                Pagando por outro aparelho? Escaneie o QR code.
              </figcaption>
            )}
            <img
              src={`data:image/png;base64,${pix.qrCodeBase64}`}
              alt="QR code do PIX"
              aria-describedby={descritoPeloAviso}
              className="mx-auto size-60 max-w-full rounded-xl border border-zinc-100 bg-white p-2"
            />
          </figure>
        ) : (
          // Degrada com honestidade: a edge extrai a imagem e o código em
          // separado, então pode faltar um dos dois — dizer o que existe em
          // vez de deixar um buraco na tela.
          <p className="rounded-xl bg-zinc-50 p-3 text-center text-sm text-zinc-600">
            A imagem do QR code não veio nesta cobrança.
            {pix.qrCode
              ? " Use o código copia e cola acima."
              : pix.ticketUrl
                ? " Use o link do Mercado Pago abaixo."
                : ""}
          </p>
        )}

        <ol className="list-inside list-decimal space-y-1 text-sm text-zinc-600">
          <li>Abra o app do seu banco e escolha pagar com Pix.</li>
          <li>Cole o código copia e cola ou escaneie o QR code.</li>
          <li>Confira o valor e confirme. A confirmação aparece nesta tela.</li>
        </ol>

        {pix.ticketUrl && (
          <a
            href={pix.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={descritoPeloAviso}
            className="flex min-h-11 items-center justify-center text-center text-sm font-medium text-zinc-600 underline"
          >
            Pagar pelo Mercado Pago
          </a>
        )}
      </section>
    );
  }

  // Pedido do dono (25/09/2026): sem Brick, este espaço nunca é preenchido
  // por um script de terceiro — precisa da própria tela dizer que está
  // gerando a cobrança, ou fica em branco até o QR chegar.
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-100 bg-white p-8">
      <Loader2
        aria-hidden="true"
        className="size-6 animate-spin text-zinc-400"
      />
      <p className="text-sm text-zinc-500">Gerando o QR code do Pix...</p>
    </div>
  );
}
