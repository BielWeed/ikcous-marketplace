import { Button } from "@/components/ui/button";
import { useOrders } from "@/hooks/useOrders";
import { AlertCircle, Check, Clock, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  desafioConcluido,
  origemDoMercadoPago,
  urlDoDesafioValida,
} from "./PagamentoComCartao";
import { comTempoLimite } from "./PagamentoOnline";

/**
 * C4 (M1, 02/10/2026) — a retomada de um pedido de CARTÃO EM DÚVIDA (a vaga
 * guarda o sentinela `verificando:...`). Antes, a tela não chamava nada e
 * prometia "daqui a alguns minutos (...) continua de onde parou" — falso:
 * nenhum componente resolvia o sentinela sozinho, e a retomada seguinte caía
 * na mesma trava (prova em scratchpad recuperacao/A1, desenho §4.4).
 *
 * Agora a tela pede à edge a CONSULTA sem cobrança
 * (`criarPagamento({ orderId, metodo: "verificar" })` — só GET no Mercado
 * Pago, só CAS/RPC de liberação no banco, nunca POST de cobrança) e mostra o
 * que ela responde, com texto verdadeiro:
 * - `sem_registro`: não dá para saber se houve cobrança. Nenhuma saída que
 *   cobra ou cancela (nem PIX, nem cartão novo, nem "Cancelar pedido", nem
 *   pedido novo — decisão do dono); "Falar com a loja" e a data REAL do
 *   cancelamento automático.
 * - `desafio3ds`: abre o desafio do banco (mesma validação de URL do cartão).
 * - `em_analise`: SÓ com `paymentId` (existe order). Sem ele, a tela nunca
 *   promete "em análise" — cai no indisponível.
 * - `pago`: decide pelo STATUS, nunca pela presença de `paymentId`. Texto
 *   conservador: a resposta não distingue `pago` de `pago_apos_expirar`, nem
 *   aprovação do MP ainda não gravada no banco — nada de "pedido confirmado".
 * - `livre`/`recusado`/`pix`: a vaga não está mais em dúvida; a retomada
 *   volta ao pai (`onRetomadaLiberada`), que pede a escolha da forma — nada é
 *   cobrado sem toque do cliente. Com o prazo da reserva vencido, a tela diz
 *   isso e não reabre nada.
 * - 503/rede/tempo limite: indisponível, "Verificar de novo". 404/409
 *   (`terminal`): a frase da edge, sem "Verificar de novo".
 *
 * CADÊNCIA: uma consulta sozinha ao abrir; depois, só pelo botão, com
 * `INTERVALO_ENTRE_VERIFICACOES_MS` entre consultas e no máximo
 * `MAXIMO_DE_VERIFICACOES_PELO_BOTAO` toques por tela. Sem `setInterval`, sem
 * repetição automática — nem quando o desafio 3DS termina (o cliente toca em
 * "Verificar de novo"). Nada vai para `localStorage`/`sessionStorage`.
 */

/** Espera mínima entre o início de duas consultas. */
export const INTERVALO_ENTRE_VERIFICACOES_MS = 30_000;

/** Toques em "Verificar de novo" por tela (fora a consulta automática). */
export const MAXIMO_DE_VERIFICACOES_PELO_BOTAO = 5;

/**
 * Teto local de uma consulta: a edge pode fazer busca + GET no MP. Estourou,
 * a tela vira "indisponível" em vez de ficar presa em "consultando" — a
 * consulta não cobra, então perguntar de novo é seguro.
 */
export const TEMPO_LIMITE_DA_VERIFICACAO_MS = 35_000;

/** O que a vaga virou quando deixou de estar em dúvida. */
export type DesfechoQueLiberaARetomada = "livre" | "recusado" | "pix";

/**
 * C5 (front B2, 02/10/2026): a verificação aberta DENTRO da sessão, logo
 * depois de um POST de cartão que voltou SEM order confirmada. A resposta
 * desse POST já é a primeira consulta: a tela começa por ela, sem chamar a
 * edge sozinha, e a espera do botão conta a partir de agora — "Verificar de
 * novo" segue a mesma cadência (30 s, no máximo 5) e só usa `verificar`.
 * - `sem_registro`: o 200 do C3 (com a data real do cancelamento automático)
 *   ou o `aguardando` sem `paymentId` (sem data — a tela não inventa uma).
 * - `indisponivel`: o 503 do C3, ou o 200 sem status conhecido e sem order.
 */
export type PontoDePartidaDaVerificacao =
  | {
      readonly verificacao: "sem_registro";
      readonly canceladoAutomaticamenteAte?: string;
    }
  | { readonly verificacao: "indisponivel" };

type Situacao =
  // C5 (revisão, a11y): o primeiro quadro de uma verificação aberta com
  // ponto de partida — a região de status nasce montada e VAZIA, e o ponto de
  // partida entra logo depois (o leitor de tela só anuncia mudança em região
  // que já existia). Sem texto, sem botão.
  | { readonly tipo: "abrindo" }
  | { readonly tipo: "consultando" }
  | { readonly tipo: "sem_registro"; readonly cancelamento: string | null }
  | { readonly tipo: "indisponivel" }
  | { readonly tipo: "terminal"; readonly mensagem: string }
  | { readonly tipo: "pago" }
  | { readonly tipo: "em_analise" }
  | { readonly tipo: "desafio"; readonly url: string }
  | { readonly tipo: "desafio-sem-pagina" }
  | { readonly tipo: "desafio-concluido" }
  | { readonly tipo: "prazo-acabou"; readonly recusado: boolean }
  | {
      readonly tipo: "liberada";
      readonly verificacao: DesfechoQueLiberaARetomada;
    };

const MENSAGEM_TERMINAL_PADRAO = "Este pedido não pode ser pago agora.";

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/** "03/10/2026 às 14:30" no relógio do aparelho; `null` se ilegível. */
function dataEHora(iso: unknown): string | null {
  if (!textoNaoVazio(iso)) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const dia = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dia} às ${hora}`;
}

function prazoVencido(expiraEm: unknown, agoraMs: number): boolean {
  if (!textoNaoVazio(expiraEm)) return false;
  const prazoMs = Date.parse(expiraEm);
  return Number.isFinite(prazoMs) && prazoMs <= agoraMs;
}

/**
 * Traduz o 200 da consulta. O corpo é tratado como DESCONHECIDO — campo a
 * campo, falha fechada no indisponível (nunca num estado que promete algo).
 */
export function situacaoDaResposta(
  resposta: unknown,
  agoraMs: number,
): Situacao {
  if (typeof resposta !== "object" || resposta === null) {
    return { tipo: "indisponivel" };
  }
  const r = resposta as Record<string, unknown>;
  const temOrder = textoNaoVazio(r.paymentId);
  switch (r.verificacao) {
    case "pago":
      return { tipo: "pago" };
    case "sem_registro":
      return {
        tipo: "sem_registro",
        cancelamento: dataEHora(r.canceladoAutomaticamenteAte),
      };
    case "em_analise":
      return temOrder ? { tipo: "em_analise" } : { tipo: "indisponivel" };
    case "desafio3ds": {
      if (!temOrder) return { tipo: "indisponivel" };
      const url = (r.desafio3ds as { url?: unknown } | null | undefined)?.url;
      return urlDoDesafioValida(url)
        ? { tipo: "desafio", url }
        : { tipo: "desafio-sem-pagina" };
    }
    case "livre":
    case "recusado":
    case "pix":
      return prazoVencido(r.expiraEm, agoraMs)
        ? { tipo: "prazo-acabou", recusado: r.verificacao === "recusado" }
        : { tipo: "liberada", verificacao: r.verificacao };
    default:
      return { tipo: "indisponivel" };
  }
}

function situacaoDoPontoDePartida(
  ponto: PontoDePartidaDaVerificacao,
): Situacao {
  return ponto.verificacao === "sem_registro"
    ? {
        tipo: "sem_registro",
        cancelamento: dataEHora(ponto.canceladoAutomaticamenteAte),
      }
    : { tipo: "indisponivel" };
}

/** Erro da consulta: só `terminal: true` literal é terminal. */
function situacaoDoErro(erro: unknown): Situacao {
  const e = erro as { terminal?: unknown; message?: unknown } | null;
  if (e?.terminal === true) {
    return {
      tipo: "terminal",
      mensagem: textoNaoVazio(e.message) ? e.message : MENSAGEM_TERMINAL_PADRAO,
    };
  }
  return { tipo: "indisponivel" };
}

// `desafio` fica DE FORA de propósito (revisão do C4, item 4): com o quadro
// do banco aberto, uma consulta troca a tela para "consultando" e remonta o
// quadro com a mesma URL — o cliente perde o que estava digitando no banco.
// O botão volta quando a página do desafio avisa que terminou.
const ESTADOS_QUE_PODEM_VERIFICAR_DE_NOVO: ReadonlySet<Situacao["tipo"]> =
  new Set([
    "sem_registro",
    "indisponivel",
    "em_analise",
    "desafio-sem-pagina",
    "desafio-concluido",
  ]);

export function VerificacaoDoPagamento({
  orderId,
  onVerMeusPedidos,
  onFalarComALoja,
  onRetomadaLiberada,
  pontoDePartida,
}: Readonly<{
  orderId: string;
  onVerMeusPedidos: () => void;
  // Ausente = loja sem WhatsApp configurado: o botão não aparece.
  onFalarComALoja?: () => void;
  onRetomadaLiberada: (verificacao: DesfechoQueLiberaARetomada) => void;
  // C5: presente = a resposta do POST de cartão já foi a primeira consulta
  // (ver `PontoDePartidaDaVerificacao`). Lido só na montagem.
  pontoDePartida?: PontoDePartidaDaVerificacao;
}>) {
  const { criarPagamento } = useOrders(false, false);
  // Com ponto de partida, o primeiro quadro é "abrindo" (região vazia); o
  // efeito de montagem, abaixo, aplica o ponto de partida.
  const [situacao, setSituacao] = useState<Situacao>(() =>
    pontoDePartida ? { tipo: "abrindo" } : { tipo: "consultando" },
  );
  // Lido só na montagem (o pai não troca o ponto de partida de uma tela já
  // aberta; trocar exigiria remontar).
  const pontoDePartidaRef = useRef(pontoDePartida);
  const [toques, setToques] = useState(0);
  // Quando a espera do botão termina (início da última consulta + intervalo).
  // Com ponto de partida, a "última consulta" foi o POST que acabou de voltar.
  const [liberaBotaoEm, setLiberaBotaoEm] = useState<number | null>(() =>
    pontoDePartida ? Date.now() + INTERVALO_ENTRE_VERIFICACOES_MS : null,
  );
  const [botaoEmEspera, setBotaoEmEspera] = useState(true);
  // Só a resposta da consulta MAIS RECENTE desta montagem pinta a tela.
  const sequenciaRef = useRef(0);
  const montadoRef = useRef(false);
  // A consulta automática é UMA por montagem — o StrictMode remonta o efeito
  // (monta, desmonta, monta) com as mesmas refs, e o segundo passe não chama.
  // Com ponto de partida, NENHUMA: a resposta do POST já foi a consulta.
  const jaConsultouRef = useRef(pontoDePartida !== undefined);

  const consultar = useCallback(() => {
    sequenciaRef.current += 1;
    const numero = sequenciaRef.current;
    setBotaoEmEspera(true);
    setLiberaBotaoEm(Date.now() + INTERVALO_ENTRE_VERIFICACOES_MS);
    setSituacao({ tipo: "consultando" });
    comTempoLimite(
      criarPagamento({ orderId, metodo: "verificar" }),
      TEMPO_LIMITE_DA_VERIFICACAO_MS,
    )
      .then(
        (resposta) => situacaoDaResposta(resposta, Date.now()),
        situacaoDoErro,
      )
      .then((nova) => {
        if (!montadoRef.current || numero !== sequenciaRef.current) return;
        setSituacao(nova);
        if (nova.tipo === "liberada") onRetomadaLiberada(nova.verificacao);
      });
  }, [criarPagamento, orderId, onRetomadaLiberada]);

  // C5 (revisão, a11y): o ponto de partida entra DEPOIS do primeiro commit,
  // sem chamar a edge. Só sai de "abrindo": o StrictMode roda isto duas vezes
  // e a segunda não muda nada.
  useEffect(() => {
    const ponto = pontoDePartidaRef.current;
    if (!ponto) return;
    setSituacao((atual) =>
      atual.tipo === "abrindo" ? situacaoDoPontoDePartida(ponto) : atual,
    );
  }, []);

  useEffect(() => {
    montadoRef.current = true;
    if (!jaConsultouRef.current) {
      jaConsultouRef.current = true;
      consultar();
    }
    return () => {
      montadoRef.current = false;
    };
  }, [consultar]);

  // A espera do botão: um `setTimeout` que só DESTRAVA o botão — nunca
  // consulta nada sozinho.
  useEffect(() => {
    if (liberaBotaoEm === null) return;
    const id = setTimeout(
      () => setBotaoEmEspera(false),
      Math.max(0, liberaBotaoEm - Date.now()),
    );
    return () => clearTimeout(id);
  }, [liberaBotaoEm]);

  // 3-D Secure: a página do desafio avisa por `postMessage` quando o cliente
  // termina — só diz que TERMINOU. A tela troca o quadro pelo aviso e espera o
  // toque em "Verificar de novo" (sem consulta automática).
  const emDesafio = situacao.tipo === "desafio";
  useEffect(() => {
    if (!emDesafio) return;
    const aoReceberMensagem = (evento: MessageEvent) => {
      if (!origemDoMercadoPago(evento.origin)) return;
      if (!desafioConcluido(evento.data)) return;
      setSituacao({ tipo: "desafio-concluido" });
    };
    globalThis.addEventListener("message", aoReceberMensagem);
    return () => globalThis.removeEventListener("message", aoReceberMensagem);
  }, [emDesafio]);

  const podeVerificarDeNovo = ESTADOS_QUE_PODEM_VERIFICAR_DE_NOVO.has(
    situacao.tipo,
  );
  const esgotouOsToques = toques >= MAXIMO_DE_VERIFICACOES_PELO_BOTAO;
  const verificarDeNovo = () => {
    if (botaoEmEspera || esgotouOsToques || !podeVerificarDeNovo) return;
    setToques((n) => n + 1);
    consultar();
  };

  const falha =
    situacao.tipo === "indisponivel"
      ? "Não foi possível consultar o pagamento agora."
      : situacao.tipo === "terminal"
        ? situacao.mensagem
        : null;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md space-y-4 bg-gray-50/10 px-3.5 pt-4">
      <h1 className="text-lg font-bold text-zinc-900">Situação do pagamento</h1>

      {/* Região viva sempre montada: o leitor de tela só anuncia mudança em
          região que já existia. As falhas vão no `role="alert"` abaixo. */}
      <div role="status" aria-live="polite" className="space-y-3">
        {situacao.tipo === "consultando" && (
          <p className="flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Consultando o pagamento com o banco…
          </p>
        )}
        {situacao.tipo === "sem_registro" && (
          <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
            <p className="font-medium text-zinc-900">
              Não conseguimos confirmar com o banco se o pagamento com cartão
              deste pedido foi feito.
            </p>
            <p>Nenhuma cobrança nova será feita por aqui.</p>
            <p>
              Se o banco confirmar, o pedido aparece como pago em Meus pedidos.
            </p>
            <p>
              {situacao.cancelamento
                ? `Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente até ${situacao.cancelamento}.`
                : "Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente."}
            </p>
          </div>
        )}
        {situacao.tipo === "em_analise" && (
          <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
            <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            Pagamento em análise pelo banco.
          </p>
        )}
        {situacao.tipo === "pago" && (
          <p className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
            <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            Pagamento recebido. A confirmação do pedido aparece em Meus pedidos.
          </p>
        )}
        {situacao.tipo === "desafio" && (
          <p className="flex items-start gap-2 text-sm text-zinc-700">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-zinc-500"
            />
            Seu banco pediu uma confirmação de segurança para este pagamento.
            Siga as instruções abaixo.
          </p>
        )}
        {situacao.tipo === "desafio-sem-pagina" && (
          <p className="text-sm text-zinc-700">
            Seu banco pediu uma confirmação de segurança para este pagamento,
            mas ela não pôde ser aberta aqui.
          </p>
        )}
        {situacao.tipo === "desafio-concluido" && (
          <p className="text-sm text-zinc-700">
            Confirmação enviada ao banco. Toque em “Verificar de novo” para ver
            a resposta.
          </p>
        )}
        {situacao.tipo === "prazo-acabou" && (
          <p className="text-sm font-medium text-zinc-800">
            {situacao.recusado
              ? "O pagamento com cartão não foi concluído. O prazo para pagar este pedido acabou."
              : "O prazo para pagar este pedido acabou."}
          </p>
        )}
        {podeVerificarDeNovo && esgotouOsToques && (
          <p className="text-xs text-zinc-500">
            Você já verificou várias vezes. Acompanhe a situação em Meus
            pedidos.
          </p>
        )}
        {podeVerificarDeNovo && !esgotouOsToques && botaoEmEspera && (
          <p className="text-xs text-zinc-500">
            Aguarde alguns segundos para verificar de novo.
          </p>
        )}
      </div>

      {falha !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {falha}
        </p>
      )}

      {situacao.tipo === "desafio" && (
        // credentialless: mesmo quadro do PagamentoComCartao (ver o
        // comentário de lá sobre o 3DS no Chrome).
        <iframe
          title="Autenticação do seu banco"
          src={situacao.url}
          credentialless=""
          className="h-[560px] max-h-[75dvh] w-full rounded-xl border border-zinc-200"
        />
      )}

      {situacao.tipo === "sem_registro" && onFalarComALoja && (
        <Button
          onClick={onFalarComALoja}
          variant="outline"
          className="w-full rounded-xl"
        >
          Falar com a loja
        </Button>
      )}
      {podeVerificarDeNovo && !esgotouOsToques && (
        <Button
          onClick={verificarDeNovo}
          disabled={botaoEmEspera}
          className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-900/90"
        >
          Verificar de novo
        </Button>
      )}
      <Button
        onClick={onVerMeusPedidos}
        variant="outline"
        className="w-full rounded-xl"
      >
        Ver meus pedidos
      </Button>
    </div>
  );
}
