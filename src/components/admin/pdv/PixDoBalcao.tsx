// Camada "pix" do caixa (frente A, 28/09/2026): o QR do PIX aberto NA TELA
// do balcão para o cliente escanear. Este arquivo NÃO chama Supabase: a VIEW
// injeta `cobrar` (edge `cobrar-pix-no-balcao`) e `consultar` (a linha do
// pedido, lida pelo admin).
//
// Quem decide "pago" é o BANCO (webhook/reconciliação/`conferir` →
// `confirmar_pagamento`), nunca esta tela: ela só relê a linha a cada 3 s e,
// quando a vê paga, chama `aoPago`. O relógio da contagem é o do SERVIDOR
// (`agoraServidor` da resposta), corrigido pelo desvio deste aparelho.

import { Button } from "@/components/ui/button";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import {
  type AcaoDoPixDoBalcao,
  type LinhaDoPixDoBalcao,
  type RespostaDoPixDoBalcao,
  type SituacaoDoPixDoBalcao,
  desvioDoRelogio,
  formatarContagem,
  horaDoVencimento,
  restanteMs,
  situacaoDaLinha,
} from "@/lib/pix-do-balcao";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface PropsDoPixDoBalcao {
  /** Número curto do pedido, para o balconista achar em Pedidos. */
  readonly numero: string;
  readonly total: number;
  readonly cobrar: (acao: AcaoDoPixDoBalcao) => Promise<RespostaDoPixDoBalcao>;
  readonly consultar: () => Promise<LinhaDoPixDoBalcao | null>;
  /** O pagamento foi confirmado no banco: a view monta o recibo. */
  readonly aoPago: () => void;
  /** O PIX morreu (cancelado/vencido): volta ao fechamento, cupom intacto. */
  readonly aoEncerrado: () => void;
  /** O dinheiro chegou DEPOIS do prazo (a venda foi cancelada, o estoque
   * voltou): não se cobra de novo — o cupom é descartado e o pedido fica em
   * Pedidos, com o selo de atenção. */
  readonly aoDescartarCupom: () => void;
  /** Intervalo da releitura da linha (ms). Injetável para teste. */
  readonly intervaloMs?: number;
}

type Fase =
  | "gerando"
  | "aguardando"
  | "expirado"
  | "cancelado"
  | "pago_fora_do_prazo"
  | "falhou";

interface DadosDoQr {
  readonly qrCode: string | null;
  readonly qrCodeBase64: string | null;
  readonly expiraEm: string | null;
  readonly desvioMs: number;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error && erro.message
    ? erro.message
    : "Não consegui falar com o pagamento agora. Tente de novo.";
}

export function PixDoBalcao({
  numero,
  total,
  cobrar,
  consultar,
  aoPago,
  aoEncerrado,
  aoDescartarCupom,
  intervaloMs = 3000,
}: PropsDoPixDoBalcao): ReactElement {
  const [fase, setFase] = useState<Fase>("gerando");
  const [dados, setDados] = useState<DadosDoQr | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"conferindo" | "cancelando" | null>(
    null,
  );
  const [agora, setAgora] = useState(() => Date.now());
  const [copiado, setCopiado] = useState(false);
  // O total que o QR COBRA é o do pedido gravado (a resposta da edge), não o
  // da tela — depois de um F5 com o cupom reaproveitado, os dois podem
  // divergir; o da tela só aparece até a primeira resposta.
  const [totalDoPedido, setTotalDoPedido] = useState<number | null>(null);
  const idTitulo = useId();

  // Callbacks da view mudam de identidade a cada render; os efeitos leem a
  // versão mais recente por ref (mesmo molde de PagamentoOnline.tsx).
  const aoPagoRef = useRef(aoPago);
  const aoEncerradoRef = useRef(aoEncerrado);
  const aoDescartarCupomRef = useRef(aoDescartarCupom);
  const cobrarRef = useRef(cobrar);
  const consultarRef = useRef(consultar);
  useEffect(() => {
    aoPagoRef.current = aoPago;
    aoEncerradoRef.current = aoEncerrado;
    aoDescartarCupomRef.current = aoDescartarCupom;
    cobrarRef.current = cobrar;
    consultarRef.current = consultar;
  });
  const finalizadoRef = useRef(false);
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const aplicarSituacao = useCallback((situacao: SituacaoDoPixDoBalcao) => {
    if (finalizadoRef.current || !montadoRef.current) return;
    if (situacao === "pago") {
      finalizadoRef.current = true;
      aoPagoRef.current();
      return;
    }
    if (situacao === "aguardando") return;
    setFase(situacao);
  }, []);

  const aplicarResposta = useCallback(
    (r: RespostaDoPixDoBalcao) => {
      if (!montadoRef.current) return;
      const desvioMs = desvioDoRelogio(r.agoraServidor, Date.now());
      if (Number.isFinite(r.total) && r.total > 0) setTotalDoPedido(r.total);
      if (r.valorDivergente) {
        setAviso(
          "O Mercado Pago aprovou um valor diferente do total desta venda. Não entregue: confira no painel do Mercado Pago.",
        );
      }
      if (r.situacao === "aguardando") {
        setDados((antes) => ({
          qrCode: r.qrCode ?? antes?.qrCode ?? null,
          qrCodeBase64: r.qrCodeBase64 ?? antes?.qrCodeBase64 ?? null,
          expiraEm: r.expiraEm,
          desvioMs,
        }));
        setFase("aguardando");
        return;
      }
      aplicarSituacao(r.situacao);
    },
    [aplicarSituacao],
  );

  const gerar = useCallback(async () => {
    setFase("gerando");
    setAviso(null);
    try {
      aplicarResposta(await cobrarRef.current("gerar"));
    } catch (erro) {
      if (!montadoRef.current) return;
      setAviso(mensagemDoErro(erro));
      setFase("falhou");
    }
  }, [aplicarResposta]);

  // Gera (ou recupera, depois de um F5) o QR uma vez, na montagem.
  useEffect(() => {
    void gerar();
  }, [gerar]);

  // Relê a linha do pedido enquanto espera: é assim que o pagamento
  // confirmado pelo webhook aparece aqui sem ninguém tocar em nada.
  useEffect(() => {
    if (fase !== "aguardando") return;
    const id = setInterval(async () => {
      try {
        const linha = await consultarRef.current();
        if (!linha) return;
        const agoraServidor = Date.now() + (dados?.desvioMs ?? 0);
        aplicarSituacao(situacaoDaLinha(linha, agoraServidor));
      } catch {
        // Rede do balcão oscilando: a próxima volta tenta de novo.
      }
    }, intervaloMs);
    return () => clearInterval(id);
  }, [fase, intervaloMs, dados?.desvioMs, aplicarSituacao]);

  // Relógio da contagem (1 s). Ao zerar, UMA conferência no servidor decide
  // entre "pagou no último segundo" e "venceu".
  const conferiuNoFimRef = useRef(false);
  useEffect(() => {
    if (fase !== "aguardando") return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fase]);
  const restante = dados
    ? restanteMs(dados.expiraEm, agora, dados.desvioMs)
    : null;
  useEffect(() => {
    if (fase !== "aguardando" || restante !== 0 || conferiuNoFimRef.current)
      return;
    conferiuNoFimRef.current = true;
    void cobrarRef
      .current("conferir")
      .then(aplicarResposta)
      .catch(() => setFase("expirado"));
  }, [fase, restante, aplicarResposta]);

  async function conferirAgora(): Promise<void> {
    setOcupado("conferindo");
    try {
      const r = await cobrarRef.current("conferir");
      aplicarResposta(r);
      if (
        montadoRef.current &&
        r.situacao === "aguardando" &&
        !r.valorDivergente
      ) {
        setAviso(
          "Ainda não caiu. Peça para o cliente conferir no app do banco.",
        );
      }
    } catch (erro) {
      if (montadoRef.current) setAviso(mensagemDoErro(erro));
    } finally {
      if (montadoRef.current) setOcupado(null);
    }
  }

  /** Cancela no Mercado Pago e na venda; se o PIX já tinha sido pago, a
   * resposta diz — e a venda segue como paga. */
  async function cancelar(): Promise<void> {
    setOcupado("cancelando");
    setAviso(null);
    try {
      const r = await cobrarRef.current("cancelar");
      if (r.situacao === "pago") {
        aplicarSituacao("pago");
        return;
      }
      if (r.situacao === "aguardando") {
        setAviso("O PIX ainda não foi cancelado. Tente de novo.");
        return;
      }
      if (r.situacao === "pago_fora_do_prazo") {
        setFase("pago_fora_do_prazo");
        return;
      }
      finalizadoRef.current = true;
      aoEncerradoRef.current();
    } catch (erro) {
      if (montadoRef.current) setAviso(mensagemDoErro(erro));
    } finally {
      if (montadoRef.current) setOcupado(null);
    }
  }

  async function copiar(codigo: string): Promise<void> {
    const ok = await copiarParaClipboard(codigo);
    if (!montadoRef.current) return;
    setCopiado(ok);
    if (ok) setTimeout(() => montadoRef.current && setCopiado(false), 2000);
  }

  const cabecalho = (
    <header className="flex flex-col items-center gap-1 text-center">
      <h3
        id={idTitulo}
        className="text-xs font-bold uppercase tracking-wider text-zinc-400"
      >
        PIX da venda #{numero}
      </h3>
      <p className="text-3xl font-black tabular-nums text-white">
        R$ {reais(totalDoPedido ?? total)}
      </p>
    </header>
  );

  const avisoVisivel = aviso && (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 text-xs text-amber-200"
    >
      <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
      {aviso}
    </p>
  );

  if (fase === "gerando" || fase === "falhou") {
    return (
      <section
        aria-labelledby={idTitulo}
        className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
      >
        {cabecalho}
        {fase === "gerando" ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
            <Loader2 aria-hidden="true" className="size-5 animate-spin" />
            Gerando o QR do PIX…
          </p>
        ) : (
          <>
            {avisoVisivel}
            <Button type="button" onClick={() => void gerar()} className="h-11">
              <RefreshCcw aria-hidden="true" className="mr-1.5 size-4" />
              Tentar de novo
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={ocupado !== null}
              onClick={() => void cancelar()}
              className="h-11"
            >
              Cancelar este PIX e trocar a forma
            </Button>
          </>
        )}
      </section>
    );
  }

  if (fase !== "aguardando") {
    const texto =
      fase === "expirado"
        ? "Este PIX venceu sem pagamento. O cupom continua aqui: gere outro PIX ou escolha outra forma."
        : fase === "cancelado"
          ? "Este PIX foi cancelado. O cupom continua aqui: escolha outra forma de pagamento."
          : `O pagamento chegou DEPOIS do prazo: a venda #${numero} foi cancelada e o estoque voltou, mas o dinheiro entrou. Não cobre de novo — abra o pedido em Pedidos para entregar ou devolver.`;
    return (
      <section
        aria-labelledby={idTitulo}
        className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
      >
        {cabecalho}
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-200"
        >
          <XCircle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-400"
          />
          {texto}
        </p>
        {avisoVisivel}
        {fase === "pago_fora_do_prazo" ? (
          <Button
            type="button"
            onClick={() => aoDescartarCupomRef.current()}
            className="h-12 bg-admin-gold text-base font-bold text-black hover:bg-admin-gold/90"
          >
            Entendi — limpar o cupom
          </Button>
        ) : (
          <Button
            type="button"
            disabled={ocupado !== null}
            onClick={() => void cancelar()}
            className="h-12 bg-admin-gold text-base font-bold text-black hover:bg-admin-gold/90"
          >
            Voltar ao fechamento
          </Button>
        )}
      </section>
    );
  }

  const vence =
    dados?.expiraEm && restante !== null
      ? `Vence em ${formatarContagem(restante)} (às ${horaDoVencimento(dados.expiraEm, dados.desvioMs)})`
      : null;

  return (
    <section
      aria-labelledby={idTitulo}
      className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
    >
      {cabecalho}

      {dados?.qrCodeBase64 ? (
        // Fundo branco e 256 px no mínimo: leitor de QR de celular barato
        // não lê QR pequeno nem sobre fundo escuro.
        <img
          src={`data:image/png;base64,${dados.qrCodeBase64}`}
          alt={`QR code do PIX de R$ ${reais(totalDoPedido ?? total)}`}
          className="mx-auto size-64 max-w-full rounded-xl bg-white p-3"
        />
      ) : (
        <p className="rounded-xl bg-zinc-900 p-3 text-center text-sm text-zinc-400">
          A imagem do QR não veio. Use o código copia e cola abaixo.
        </p>
      )}

      {vence && (
        <p className="flex items-center justify-center gap-2 text-sm font-semibold tabular-nums text-zinc-200">
          <Clock aria-hidden="true" className="size-4" />
          {vence}
        </p>
      )}

      <p
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-2 text-sm text-zinc-300"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Aguardando pagamento…
      </p>

      {dados?.qrCode && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            PIX copia e cola
          </p>
          <p className="select-all break-all rounded-xl border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-300">
            <span className="line-clamp-2">{dados.qrCode}</span>
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void copiar(dados.qrCode ?? "")}
            className="h-11"
          >
            {copiado ? (
              <Check aria-hidden="true" className="mr-1.5 size-4" />
            ) : (
              <Copy aria-hidden="true" className="mr-1.5 size-4" />
            )}
            <span aria-live="polite">
              {copiado ? "Copiado!" : "Copiar código PIX"}
            </span>
          </Button>
        </div>
      )}

      {avisoVisivel}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={ocupado !== null}
          onClick={() => void conferirAgora()}
          className="h-11"
        >
          {ocupado === "conferindo"
            ? "Conferindo…"
            : "Já pagou? Conferir agora"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={ocupado !== null}
          onClick={() => void cancelar()}
          className="h-11 text-zinc-400"
        >
          {ocupado === "cancelando"
            ? "Cancelando o PIX…"
            : "Cancelar este PIX e trocar a forma"}
        </Button>
      </div>
    </section>
  );
}
