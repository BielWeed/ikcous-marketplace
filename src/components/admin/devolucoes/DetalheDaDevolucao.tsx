import {
  ChevronLeft,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { type ReactNode, useCallback } from "react";
import { toast } from "sonner";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import {
  ehStatusAberto,
  formatarDataHora,
  formatarDia,
  formatarReais,
  rotuloAtor,
  rotuloCondicao,
  rotuloMetodo,
  rotuloModalidade,
  rotuloMotivo,
  rotuloResolucao,
  rotuloStatus,
  textoDoPrazo,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";

import { AcoesDaDevolucao, BOTAO_SECUNDARIO } from "./AcoesDaDevolucao";
import { SeloDoStatus, SeloDoTipo } from "./SelosDaDevolucao";

const SECAO =
  "admin-glass space-y-3 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6";
const TITULO_SECAO =
  "text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500";

function Linha({
  rotulo,
  children,
}: Readonly<{ rotulo: string; children: ReactNode }>) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <dt className="shrink-0 text-zinc-500">{rotulo}</dt>
      <dd className="min-w-0 text-right font-semibold text-zinc-200">
        {children}
      </dd>
    </div>
  );
}

/**
 * A ficha de UMA devolução no painel: o que o cliente pediu, as fotos (URL
 * assinada de 10 min — o bucket é privado), a trilha de eventos e o
 * próximo passo. No celular ocupa a tela inteira (folha); a partir de
 * 1024px é o painel da direita, ao lado da lista.
 */
export function DetalheDaDevolucao({
  id,
  agora,
  onFechar,
  onMudou,
  onSujoMudou,
  onAbrirPedido,
}: Readonly<{
  id: string;
  agora: Date;
  onFechar: () => void;
  onMudou: () => void;
  onSujoMudou: (sujo: boolean) => void;
  onAbrirPedido: (orderId: string) => void;
}>) {
  const ficha = useDevolucaoAdmin(id, onMudou);
  const { detalhe, fotos, carregando, erro } = ficha;
  const aoSujar = useCallback((s: boolean) => onSujoMudou(s), [onSujoMudou]);

  const whatsapp = linkWhatsappDoCliente(detalhe?.pedido?.whatsapp);

  async function copiar(valor: string) {
    const ok = await copiarParaClipboard(valor);
    if (ok) toast.success("Copiado!");
    else toast.error("Não foi possível copiar.");
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="detalhe-devolucao"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 bg-[#09090b]/95 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] backdrop-blur-md lg:rounded-t-2xl lg:pt-3">
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar devolução"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/60 text-zinc-300 hover:text-white active:scale-95"
        >
          <ChevronLeft className="size-4 lg:hidden" />
          <X className="hidden size-4 lg:block" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-black tracking-wide text-white">
            {detalhe?.protocolo ?? "Devolução"}
          </p>
          {detalhe && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              <SeloDoStatus status={detalhe.status} />
              <SeloDoTipo tipo={detalhe.tipo} />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void ficha.recarregar()}
          aria-label="Atualizar devolução"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/60 text-zinc-400 hover:text-white active:scale-95"
        >
          <RefreshCw className={cn("size-4", carregando && "animate-spin")} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 pb-[calc(2rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] sm:p-4">
        {!detalhe && carregando && (
          <div className="flex items-center justify-center gap-2 py-16 text-xs font-bold text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            Carregando devolução…
          </div>
        )}

        {!detalhe && erro && (
          <div className={SECAO}>
            <p className="text-xs font-bold text-red-300">
              Não consegui carregar esta devolução.
            </p>
            <button
              type="button"
              onClick={() => void ficha.recarregar()}
              className={BOTAO_SECUNDARIO}
            >
              Tentar de novo
            </button>
          </div>
        )}

        {detalhe && (
          <>
            <AcoesDaDevolucao
              key={`${detalhe.id}:${detalhe.status}`}
              ficha={ficha}
              detalhe={detalhe}
              onSujoMudou={aoSujar}
            />

            {detalhe.status === "concluida" && detalhe.reembolso_manual && (
              <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-bold leading-relaxed text-amber-200">
                Reembolso manual de{" "}
                {formatarReais(detalhe.valor_reembolso ?? 0)}: este pedido não
                foi pago pelo app — devolva ao cliente em mãos ou por PIX.
              </p>
            )}

            <section className={SECAO}>
              <h3 className={TITULO_SECAO}>Pedido do cliente</h3>
              <dl className="space-y-1.5">
                <Linha rotulo="Cliente">
                  {detalhe.pedido?.customer_name || "—"}
                </Linha>
                <Linha rotulo="Motivo">{rotuloMotivo(detalhe.motivo)}</Linha>
                <Linha rotulo="Quer">
                  {rotuloResolucao(detalhe.resolucao_desejada)}
                </Linha>
                <Linha rotulo="Devolve por">
                  {rotuloMetodo(detalhe.metodo_retorno)} ·{" "}
                  {rotuloModalidade(detalhe.modalidade)}
                </Linha>
                <Linha rotulo="Pedido em">
                  {formatarDataHora(detalhe.created_at)}
                </Linha>
                {detalhe.prazo_ate && (
                  <Linha rotulo="Prazo legal">
                    <span className="tabular-nums">
                      {formatarDia(detalhe.prazo_ate)}
                      {ehStatusAberto(detalhe.status) &&
                        ` · ${textoDoPrazo(detalhe.prazo_ate, agora)}`}
                    </span>
                  </Linha>
                )}
              </dl>
              {detalhe.detalhe && (
                <p className="whitespace-pre-line rounded-xl bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-300">
                  “{detalhe.detalhe}”
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onAbrirPedido(detalhe.order_id)}
                  className={BOTAO_SECUNDARIO}
                >
                  <ExternalLink className="size-4" />
                  Pedido #{detalhe.order_id.slice(0, 8)}
                </button>
                {whatsapp && (
                  <a
                    href={`${whatsapp}?text=${encodeURIComponent(`Olá! Sobre a sua devolução ${detalhe.protocolo}:`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(BOTAO_SECUNDARIO, "text-emerald-300")}
                  >
                    <MessageCircle className="size-4" />
                    WhatsApp
                  </a>
                )}
              </div>
            </section>

            <section className={SECAO}>
              <h3 className={TITULO_SECAO}>Itens</h3>
              <ul className="space-y-2">
                {detalhe.itens.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <div className="size-12 shrink-0 overflow-hidden rounded-xl border border-white/5 bg-zinc-900">
                      {item.image_url && (
                        <img
                          src={item.image_url}
                          alt=""
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">
                        {item.product_name || "Produto"}
                      </p>
                      <p className="text-[11px] tabular-nums text-zinc-400">
                        {item.quantidade} × {formatarReais(item.valor_unitario)}
                        {item.condicao && ` · ${rotuloCondicao(item.condicao)}`}
                        {item.reestocado_em && " · voltou ao estoque"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1.5 border-t border-white/5 pt-3">
                <Linha rotulo="Itens">
                  <span className="tabular-nums">
                    {formatarReais(detalhe.valor_itens)}
                  </span>
                </Linha>
                {detalhe.valor_frete_ida > 0 && (
                  <Linha rotulo="Frete de ida">
                    <span className="tabular-nums">
                      {formatarReais(detalhe.valor_frete_ida)}
                    </span>
                  </Linha>
                )}
                {detalhe.valor_reembolso !== null && (
                  <Linha rotulo="Reembolso">
                    <span className="tabular-nums text-admin-gold">
                      {formatarReais(detalhe.valor_reembolso)}
                      {detalhe.reembolso_manual
                        ? " (manual)"
                        : " (Mercado Pago)"}
                    </span>
                  </Linha>
                )}
                {detalhe.resolucao_final && (
                  <Linha rotulo="Resolvido com">
                    {rotuloResolucao(detalhe.resolucao_final)}
                  </Linha>
                )}
              </dl>
            </section>

            {detalhe.fotos.length > 0 && (
              <section className={SECAO}>
                <h3 className={TITULO_SECAO}>
                  Fotos do cliente ({detalhe.fotos.length})
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {detalhe.fotos.map((caminho, indice) => {
                    const url = fotos.get(caminho);
                    return url ? (
                      <a
                        key={caminho}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square overflow-hidden rounded-xl border border-white/5 bg-zinc-900"
                      >
                        <img
                          src={url}
                          alt={`Foto ${indice + 1} enviada pelo cliente`}
                          className="size-full object-cover"
                        />
                      </a>
                    ) : (
                      <div
                        key={caminho}
                        className="flex aspect-square items-center justify-center rounded-xl border border-white/5 bg-zinc-900 p-2 text-center text-[10px] text-zinc-500"
                      >
                        {fotos.has(caminho)
                          ? "Foto indisponível"
                          : "Carregando…"}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {(detalhe.codigo_postagem ||
              detalhe.codigo_rastreio ||
              detalhe.coleta_em ||
              detalhe.mensagem_loja ||
              detalhe.observacao_inspecao) && (
              <section className={SECAO}>
                <h3 className={TITULO_SECAO}>Logística e mensagens</h3>
                <dl className="space-y-1.5">
                  {detalhe.codigo_postagem && (
                    <Linha rotulo="Código de postagem">
                      <button
                        type="button"
                        onClick={() =>
                          void copiar(detalhe.codigo_postagem ?? "")
                        }
                        className="inline-flex min-h-11 items-center gap-1.5 font-mono"
                      >
                        {detalhe.codigo_postagem}
                        <Copy className="size-3 text-zinc-500" />
                      </button>
                    </Linha>
                  )}
                  {detalhe.etiqueta_url && (
                    <Linha rotulo="Etiqueta">
                      <a
                        href={detalhe.etiqueta_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-admin-gold underline-offset-2 hover:underline"
                      >
                        Abrir
                      </a>
                    </Linha>
                  )}
                  {detalhe.codigo_rastreio && (
                    <Linha rotulo="Rastreio">
                      <a
                        href={`https://linkrastreio.com/?codigo=${encodeURIComponent(detalhe.codigo_rastreio)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-admin-gold underline-offset-2 hover:underline"
                      >
                        {detalhe.codigo_rastreio}
                      </a>
                    </Linha>
                  )}
                  {detalhe.coleta_em && (
                    <Linha rotulo="Coleta">
                      {formatarDataHora(detalhe.coleta_em)}
                    </Linha>
                  )}
                </dl>
                {detalhe.mensagem_loja && (
                  <div className="rounded-xl bg-zinc-950/60 p-3">
                    <p className={TITULO_SECAO}>Sua mensagem ao cliente</p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-zinc-300">
                      {detalhe.mensagem_loja}
                    </p>
                  </div>
                )}
                {detalhe.observacao_inspecao && (
                  <div className="rounded-xl bg-zinc-950/60 p-3">
                    <p className={TITULO_SECAO}>Inspeção</p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-zinc-300">
                      {detalhe.observacao_inspecao}
                    </p>
                  </div>
                )}
              </section>
            )}

            <section className={SECAO}>
              <h3 className={TITULO_SECAO}>Histórico</h3>
              <ol className="space-y-3 border-l border-white/10 pl-4">
                {detalhe.eventos.map((evento) => (
                  <li key={evento.id} className="relative">
                    <span className="absolute left-[-21px] top-1 size-2.5 rounded-full border border-admin-gold/60 bg-zinc-950" />
                    <p className="text-xs font-bold text-white">
                      {rotuloStatus(evento.para_status)}
                      <span className="font-normal text-zinc-500">
                        {" "}
                        · {rotuloAtor(evento.ator)} ·{" "}
                        <span className="tabular-nums">
                          {formatarDataHora(evento.created_at)}
                        </span>
                      </span>
                    </p>
                    {evento.nota && (
                      <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-zinc-400">
                        {evento.nota}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
