import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  RotateCcw,
  Truck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Desfecho } from "@/hooks/useDevolucaoCliente";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import {
  acoesDoCliente,
  etapasDaDevolucao,
  formatarDia,
  formatarReais,
  instrucaoParaOCliente,
  rotuloMetodo,
  rotuloResolucao,
  rotuloStatus,
  rotuloTipo,
  tituloDoStatusParaCliente,
  tomDoStatus,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import type { DevolucaoDetalhe, ResumoDevolucao } from "@/types/devolucao";
import { haptic } from "@/utils/haptic";

interface DevolucaoDoPedidoCardProps {
  readonly atual: DevolucaoDetalhe;
  /** Devoluções anteriores do mesmo pedido (mais recente primeiro). */
  readonly anteriores: readonly ResumoDevolucao[];
  readonly enderecoDaLoja: string | null;
  readonly horarioDaLoja: string | null;
  readonly onCancelar: (id: string) => Promise<Desfecho>;
  readonly onInformarEnvio: (id: string, codigo: string) => Promise<Desfecho>;
}

const COR_DO_TOM = new Map([
  ["atencao", "border-amber-100 bg-amber-50 text-amber-900"],
  ["andamento", "border-sky-100 bg-sky-50 text-sky-900"],
  ["sucesso", "border-emerald-100 bg-emerald-50 text-emerald-900"],
  ["negativo", "border-red-100 bg-red-50 text-red-800"],
]);

/**
 * O cartão da devolução na tela do pedido do cliente: em que pé está (linha
 * do tempo), o protocolo, o que a loja escreveu e a PRÓXIMA coisa a fazer —
 * com o botão dela quando existe (informar o rastreio, cancelar).
 */
export function DevolucaoDoPedidoCard({
  atual,
  anteriores,
  enderecoDaLoja,
  horarioDaLoja,
  onCancelar,
  onInformarEnvio,
}: DevolucaoDoPedidoCardProps) {
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState<"cancelar" | "envio" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const etapas = etapasDaDevolucao(atual);
  const acoes = acoesDoCliente(atual);
  const endereco =
    atual.politica?.endereco_devolucao?.trim() ||
    enderecoDaLoja?.trim() ||
    null;
  const instrucao = instrucaoParaOCliente(atual, {
    endereco,
    horario: horarioDaLoja,
  });
  const tom = tomDoStatus(atual.status);
  const valorTotal = atual.valor_itens + atual.valor_frete_ida;

  async function copiar(valor: string, rotulo: string) {
    const ok = await copiarParaClipboard(valor);
    if (ok) {
      toast.success(`${rotulo} copiado!`);
      haptic.light();
    } else {
      toast.error("Não foi possível copiar. Selecione o texto e copie.");
    }
  }

  async function cancelar() {
    if (enviando) return;
    const confirmado = globalThis.confirm(
      "Cancelar esta devolução? Se mudar de ideia, você pode pedir de novo enquanto o prazo estiver aberto.",
    );
    if (!confirmado) return;
    setEnviando("cancelar");
    setErro(null);
    const r = await onCancelar(atual.id);
    setEnviando(null);
    if (r.ok) toast.success("Devolução cancelada.");
    else setErro(r.erro);
  }

  // Na etiqueta reversa o código de postagem JÁ É o rastreio: "Já postei"
  // manda ele mesmo. No envio próprio, o cliente digita o do comprovante.
  const codigoDaEtiqueta =
    atual.metodo_retorno === "etiqueta_reversa" ? atual.codigo_postagem : null;

  async function informarEnvio() {
    if (enviando) return;
    const codigoFinal = codigoDaEtiqueta ?? codigo.trim();
    if (codigoFinal.length < 5) {
      setErro("Digite o código de rastreio do comprovante de postagem.");
      return;
    }
    setEnviando("envio");
    setErro(null);
    const r = await onInformarEnvio(atual.id, codigoFinal);
    setEnviando(null);
    if (r.ok) {
      setCodigo("");
      toast.success(
        "Pronto! A loja foi avisada de que o produto está a caminho.",
      );
    } else {
      setErro(r.erro);
    }
  }

  return (
    <div
      data-testid="cartao-devolucao"
      className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
          <RotateCcw className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-zinc-500">
            {atual.tipo === "troca" ? "Troca" : "Devolução"} ·{" "}
            {rotuloTipo(atual.tipo)}
          </p>
          <h4 className="text-[15px] font-extrabold tracking-tight text-zinc-900">
            {tituloDoStatusParaCliente(atual.status)}
          </h4>
        </div>
        <button
          type="button"
          onClick={() => void copiar(atual.protocolo, "Protocolo")}
          aria-label={`Copiar protocolo ${atual.protocolo}`}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-zinc-100 bg-zinc-50 px-3 font-mono text-xs font-bold text-zinc-700"
        >
          {atual.protocolo}
          <Copy className="size-3 text-zinc-500" />
        </button>
      </div>

      {/* Linha do tempo — status é cor + texto, nunca só cor. */}
      <ol className="mt-4 flex items-start gap-1" aria-label="Andamento">
        {etapas.map((etapa) => (
          <li
            key={etapa.status}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
            aria-current={etapa.estado === "atual" ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full",
                etapa.estado === "feita" && "bg-zinc-900 text-white",
                etapa.estado === "atual" &&
                  "bg-white text-zinc-900 ring-2 ring-zinc-900",
                etapa.estado === "pendente" &&
                  "border border-zinc-200 text-zinc-300",
                etapa.estado === "negativa" && "bg-red-600 text-white",
              )}
            >
              {etapa.estado === "negativa" ? (
                <X className="size-3" />
              ) : etapa.estado === "feita" ? (
                <Check className="size-3" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>
            <span
              className={cn(
                "w-full truncate text-[10px] font-semibold",
                etapa.estado === "pendente"
                  ? "text-zinc-400"
                  : etapa.estado === "negativa"
                    ? "text-red-700"
                    : "text-zinc-700",
              )}
            >
              {etapa.rotulo}
            </span>
          </li>
        ))}
      </ol>

      <p
        className={cn(
          "mt-4 rounded-2xl border p-3 text-[13px] leading-relaxed",
          COR_DO_TOM.get(tom),
        )}
      >
        {instrucao}
      </p>

      {atual.mensagem_loja && (
        <div className="mt-3 flex gap-2.5 rounded-2xl bg-zinc-50 p-3">
          <MessageCircle className="mt-0.5 size-4 shrink-0 text-zinc-500" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-zinc-500">
              Mensagem da loja
            </p>
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-800">
              {atual.mensagem_loja}
            </p>
          </div>
        </div>
      )}

      {atual.codigo_postagem && atual.status === "aprovada" && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-zinc-100 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-zinc-500">
              Código de postagem (também é o rastreio)
            </p>
            <code className="block truncate font-mono text-sm font-black tracking-wide text-zinc-900">
              {atual.codigo_postagem}
            </code>
          </div>
          <button
            type="button"
            onClick={() =>
              void copiar(atual.codigo_postagem ?? "", "Código de postagem")
            }
            aria-label="Copiar código de postagem"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"
          >
            <Copy className="size-4" />
          </button>
          {atual.etiqueta_url && (
            <a
              href={atual.etiqueta_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-xs font-bold text-white"
            >
              <ExternalLink className="size-3.5" />
              Etiqueta
            </a>
          )}
        </div>
      )}

      {atual.codigo_rastreio && atual.status === "em_transito" && (
        <a
          href={`https://linkrastreio.com/?codigo=${encodeURIComponent(atual.codigo_rastreio)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-11 items-center gap-2 rounded-2xl border border-zinc-100 px-3 text-sm font-bold text-zinc-800"
        >
          <Truck className="size-4 text-zinc-500" />
          Rastrear devolução
          <span className="ml-auto font-mono text-xs text-zinc-500">
            {atual.codigo_rastreio}
          </span>
        </a>
      )}

      <dl className="mt-4 space-y-1 border-t border-dashed border-zinc-200 pt-3 text-[13px]">
        {atual.itens.map((item) => (
          <div key={item.id} className="flex justify-between gap-3">
            <dt className="min-w-0 truncate text-zinc-600">
              {item.quantidade}× {item.product_name || "Produto"}
            </dt>
            <dd className="shrink-0 font-semibold tabular-nums text-zinc-900">
              {formatarReais(item.quantidade * item.valor_unitario)}
            </dd>
          </div>
        ))}
        {atual.valor_frete_ida > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-600">Frete de ida</dt>
            <dd className="font-semibold tabular-nums text-zinc-900">
              {formatarReais(atual.valor_frete_ida)}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-600">
            {atual.valor_reembolso !== null ? "Reembolso" : "Valor"}
          </dt>
          <dd className="font-bold tabular-nums text-zinc-900">
            {formatarReais(atual.valor_reembolso ?? valorTotal)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-600">
            {atual.resolucao_final ? "Resolvido com" : "Você pediu"}
          </dt>
          <dd className="text-right font-semibold text-zinc-900">
            {rotuloResolucao(atual.resolucao_final ?? atual.resolucao_desejada)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-600">Forma de devolver</dt>
          <dd className="text-right font-semibold text-zinc-900">
            {rotuloMetodo(atual.metodo_retorno)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-600">Pedido em</dt>
          <dd className="font-semibold tabular-nums text-zinc-900">
            {formatarDia(atual.created_at)}
          </dd>
        </div>
      </dl>

      {acoes.includes("informar_envio") && codigoDaEtiqueta && (
        <button
          type="button"
          onClick={() => void informarEnvio()}
          disabled={enviando !== null}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {enviando === "envio" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Truck className="size-4" />
          )}
          Já postei o pacote
        </button>
      )}

      {acoes.includes("informar_envio") && !codigoDaEtiqueta && (
        <div className="mt-4 space-y-2">
          <label
            htmlFor={`rastreio-devolucao-${atual.id}`}
            className="text-xs font-bold text-zinc-500"
          >
            Já postou? Informe o código de rastreio
          </label>
          <div className="flex gap-2">
            <input
              id={`rastreio-devolucao-${atual.id}`}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="Ex.: AB123456789BR"
              className="h-12 min-w-0 flex-1 rounded-2xl border border-zinc-200 px-3 font-mono text-sm uppercase text-zinc-900 outline-none placeholder:normal-case placeholder:text-zinc-400 focus:border-zinc-900"
            />
            <button
              type="button"
              onClick={() => void informarEnvio()}
              disabled={enviando !== null}
              className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-zinc-900 px-4 text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
            >
              {enviando === "envio" && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Enviar
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {erro}
        </p>
      )}

      {acoes.includes("cancelar") && (
        <button
          type="button"
          onClick={() => void cancelar()}
          disabled={enviando !== null}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          {enviando === "cancelar" && (
            <Loader2 className="size-4 animate-spin" />
          )}
          Cancelar devolução
        </button>
      )}

      {anteriores.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <p className="text-[11px] font-bold text-zinc-500">
            Outras devoluções deste pedido
          </p>
          <ul className="mt-1 space-y-0.5">
            {anteriores.map((d) => (
              <li
                key={d.id}
                className="flex justify-between gap-3 text-xs text-zinc-600"
              >
                <span className="font-mono">{d.protocolo}</span>
                <span>{rotuloStatus(d.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
