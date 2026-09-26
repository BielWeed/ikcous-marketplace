import {
  AlertTriangle,
  Check,
  Loader2,
  PackageCheck,
  Tag,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { Switch } from "@/components/ui/switch";
import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import {
  CONDICOES,
  acoesDoLojista,
  formatarReais,
  paraCentavos,
  reestocarPorPadrao,
  resolucoesDaConclusao,
  rotuloCondicao,
  rotuloResolucao,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import type {
  CondicaoItemDevolvido,
  DevolucaoDetalhe,
  ResolucaoDevolucao,
} from "@/types/devolucao";

type Modo = "aprovar" | "recusar" | "concluir" | "reprovar" | null;

interface Inspecao {
  condicao: CondicaoItemDevolvido | null;
  reestocar: boolean;
}

export const BOTAO_PRINCIPAL =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl bg-admin-gold px-4 text-[11px] font-black uppercase tracking-widest text-black transition-all hover:bg-admin-gold/90 active:scale-95 disabled:opacity-50";
export const BOTAO_SECUNDARIO =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-[11px] font-bold text-zinc-200 transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50";
const BOTAO_PERIGO =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 text-[11px] font-bold text-red-300 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50";
const CAMPO =
  "w-full rounded-xl border border-white/10 bg-zinc-950 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-admin-gold focus:outline-none";
const ROTULO =
  "mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500";

/** O pedido foi pago pelo app (o reembolso volta pelo Mercado Pago)? */
function pagoPeloApp(detalhe: DevolucaoDetalhe): boolean {
  const p = detalhe.pedido;
  return (
    p?.payment_method === "online" &&
    (p.payment_status === "pago" || p.payment_status === "pago_apos_expirar")
  );
}

/**
 * As ações do lojista para o status ATUAL da devolução — a lista vem de
 * `acoesDoLojista` (espelho da máquina de estados das RPCs). Montado com
 * `key` = id + status: mudou o status, o formulário renasce limpo.
 */
export function AcoesDaDevolucao({
  ficha,
  detalhe,
  onSujoMudou,
}: Readonly<{
  ficha: FichaDaDevolucao;
  detalhe: DevolucaoDetalhe;
  onSujoMudou: (sujo: boolean) => void;
}>) {
  const acoes = acoesDoLojista(detalhe);
  const resolucoes = resolucoesDaConclusao(detalhe.tipo);
  const valorPadrao = (
    (paraCentavos(detalhe.valor_itens) +
      paraCentavos(detalhe.valor_frete_ida)) /
    100
  ).toFixed(2);

  const [modo, setModo] = useState<Modo>(null);
  const [mensagem, setMensagem] = useState("");
  const [coletaEm, setColetaEm] = useState("");
  const [motivo, setMotivo] = useState("");
  // Na etiqueta reversa o código de postagem é o rastreio dos Correios.
  const codigoInicial =
    detalhe.metodo_retorno === "etiqueta_reversa"
      ? (detalhe.codigo_postagem ?? "")
      : "";
  const [codigo, setCodigo] = useState(codigoInicial);
  const [inspecao, setInspecao] = useState<ReadonlyMap<string, Inspecao>>(
    () =>
      new Map(
        detalhe.itens.map((item) => [
          item.id,
          { condicao: null, reestocar: false },
        ]),
      ),
  );
  const [resolucao, setResolucao] = useState<ResolucaoDevolucao>(
    resolucoes.includes(detalhe.resolucao_desejada)
      ? detalhe.resolucao_desejada
      : resolucoes[0],
  );
  const [valor, setValor] = useState(valorPadrao);
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const sujo =
    mensagem.trim() !== "" ||
    coletaEm !== "" ||
    motivo.trim() !== "" ||
    codigo.trim() !== codigoInicial ||
    observacao.trim() !== "" ||
    valor !== valorPadrao ||
    Array.from(inspecao.values()).some((i) => i.condicao !== null);

  useEffect(() => {
    onSujoMudou(sujo);
  }, [sujo, onSujoMudou]);
  useEffect(() => () => onSujoMudou(false), [onSujoMudou]);

  const ocupado = ficha.emVoo !== null;

  if (acoes.length === 0) return null;

  function escolherModo(novo: Modo) {
    setErro(null);
    setModo((atual) => (atual === novo ? null : novo));
  }

  async function aprovar() {
    // `datetime-local` é hora do aparelho; o banco guarda instante (ISO).
    const quando = coletaEm ? new Date(coletaEm) : null;
    await ficha.aprovar({
      mensagem,
      coletaEm:
        quando && !Number.isNaN(quando.getTime()) ? quando.toISOString() : null,
    });
  }

  async function recusar() {
    if (!motivo.trim()) {
      setErro("Explique ao cliente o motivo da recusa.");
      return;
    }
    await ficha.recusar(motivo);
  }

  async function reprovar() {
    if (!motivo.trim()) {
      setErro("Explique ao cliente por que o produto não foi aceito.");
      return;
    }
    await ficha.reprovar(motivo);
  }

  function mudarCondicao(itemId: string, condicao: CondicaoItemDevolvido) {
    setErro(null);
    setInspecao((antes) => {
      const proxima = new Map(antes);
      proxima.set(itemId, {
        condicao,
        reestocar: reestocarPorPadrao(condicao),
      });
      return proxima;
    });
  }

  function mudarReestoque(itemId: string, reestocar: boolean) {
    setInspecao((antes) => {
      const atual = antes.get(itemId);
      if (!atual) return antes;
      const proxima = new Map(antes);
      proxima.set(itemId, { ...atual, reestocar });
      return proxima;
    });
  }

  async function concluir() {
    const itens = detalhe.itens.map((item) => {
      const i = inspecao.get(item.id);
      return {
        item_id: item.id,
        condicao: i?.condicao ?? null,
        reestocar: !!i?.reestocar && i?.condicao !== "ausente",
      };
    });
    if (itens.some((i) => i.condicao === null)) {
      setErro("Informe a condição de cada item recebido.");
      return;
    }
    const valorNumero = Number(valor);
    if (
      resolucao === "reembolso" &&
      (!Number.isFinite(valorNumero) || valorNumero <= 0)
    ) {
      setErro("Informe o valor do reembolso.");
      return;
    }
    if (resolucao === "reembolso") {
      const texto = pagoPeloApp(detalhe)
        ? `Devolver ${formatarReais(valorNumero)} ao cliente pelo Mercado Pago? O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer.`
        : `Registrar o reembolso de ${formatarReais(valorNumero)}? Este pedido não foi pago pelo app: você devolve o dinheiro ao cliente em mãos ou por PIX.`;
      if (!globalThis.confirm(texto)) return;
    }
    setErro(null);
    await ficha.concluir({
      resolucao,
      itens: itens.map((i) => ({
        item_id: i.item_id,
        condicao: i.condicao as CondicaoItemDevolvido,
        reestocar: i.reestocar,
      })),
      valorReembolso: resolucao === "reembolso" ? valorNumero : null,
      observacao,
    });
  }

  const girando = (qual: FichaDaDevolucao["emVoo"]) =>
    ficha.emVoo === qual ? <Loader2 className="size-4 animate-spin" /> : null;

  return (
    <section
      data-testid="acoes-devolucao"
      className="admin-glass space-y-4 rounded-2xl border border-admin-gold/20 p-4 shadow-2xl sm:p-6"
    >
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-admin-gold">
        Próximo passo
      </h3>

      {detalhe.status === "solicitada" && (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">
            O cliente espera a sua resposta. Aprovar envia as instruções; a
            recusa precisa de motivo — ele fica registrado e o cliente vê.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={modo === "aprovar"}
              onClick={() => escolherModo("aprovar")}
              className={cn(
                BOTAO_SECUNDARIO,
                modo === "aprovar" && "border-admin-gold/50 text-admin-gold",
              )}
            >
              <Check className="size-4" />
              Aprovar
            </button>
            <button
              type="button"
              aria-pressed={modo === "recusar"}
              onClick={() => escolherModo("recusar")}
              className={cn(
                BOTAO_PERIGO,
                modo === "recusar" && "border-red-400/60",
              )}
            >
              <X className="size-4" />
              Recusar
            </button>
          </div>

          {modo === "aprovar" && (
            <div className="space-y-3">
              <div>
                <label htmlFor="devolucao-mensagem" className={ROTULO}>
                  Instruções para o cliente (opcional)
                </label>
                <LocalBufferedTextarea
                  id="devolucao-mensagem"
                  value={mensagem}
                  onFlush={setMensagem}
                  maxLength={1000}
                  rows={3}
                  placeholder="Ex.: embale com a etiqueta e traga a nota fiscal."
                  className={CAMPO}
                />
              </div>
              {detalhe.metodo_retorno === "coleta" && (
                <div>
                  <label htmlFor="devolucao-coleta" className={ROTULO}>
                    Dia e hora da coleta
                  </label>
                  <LocalBufferedInput
                    id="devolucao-coleta"
                    type="datetime-local"
                    value={coletaEm}
                    onFlush={setColetaEm}
                    className={cn(CAMPO, "h-11 py-0")}
                  />
                </div>
              )}
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void aprovar()}
                className={cn(BOTAO_PRINCIPAL, "w-full")}
              >
                {girando("decidir")}
                Confirmar aprovação
              </button>
            </div>
          )}

          {modo === "recusar" && (
            <div className="space-y-3">
              <div>
                <label htmlFor="devolucao-recusa" className={ROTULO}>
                  Motivo da recusa (o cliente vê)
                </label>
                <LocalBufferedTextarea
                  id="devolucao-recusa"
                  value={motivo}
                  onFlush={setMotivo}
                  maxLength={1000}
                  rows={3}
                  placeholder="Ex.: o produto foi personalizado sob encomenda."
                  className={CAMPO}
                />
              </div>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void recusar()}
                className={cn(BOTAO_PERIGO, "w-full")}
              >
                {girando("decidir")}
                Recusar devolução
              </button>
            </div>
          )}
        </>
      )}

      {(detalhe.status === "aprovada" || detalhe.status === "em_transito") && (
        <div className="space-y-3">
          {acoes.includes("gerar_etiqueta") && (
            <div className="space-y-2 rounded-xl border border-white/5 bg-zinc-950/40 p-3">
              <p className="text-xs leading-relaxed text-zinc-400">
                O pedido saiu por etiqueta do Melhor Envio: gere o código de
                postagem reversa. O cliente leva o pacote a uma agência dos
                Correios com ele.
              </p>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void ficha.gerarEtiquetaReversa()}
                className={cn(BOTAO_PRINCIPAL, "w-full")}
              >
                {girando("etiqueta") ?? <Tag className="size-4" />}
                Gerar código de postagem
              </button>
            </div>
          )}

          {acoes.includes("marcar_em_transito") && (
            <div className="space-y-2">
              <label htmlFor="devolucao-rastreio" className={ROTULO}>
                Código de rastreio (opcional)
              </label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <LocalBufferedInput
                    id="devolucao-rastreio"
                    value={codigo}
                    onFlush={(v) => setCodigo(v.toUpperCase())}
                    maxLength={40}
                    autoComplete="off"
                    placeholder="AB123456789BR"
                    className={cn(CAMPO, "h-11 py-0 font-mono uppercase")}
                  />
                </div>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => void ficha.marcarEmTransito(codigo)}
                  className={cn(BOTAO_SECUNDARIO, "shrink-0")}
                >
                  {girando("registrar") ?? <Truck className="size-4" />}
                  Marcar a caminho
                </button>
              </div>
            </div>
          )}

          {acoes.includes("marcar_recebida") && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void ficha.marcarRecebida()}
              className={cn(BOTAO_PRINCIPAL, "w-full")}
            >
              {girando("registrar") ?? <PackageCheck className="size-4" />}
              Marcar como recebida
            </button>
          )}
        </div>
      )}

      {detalhe.status === "recebida" && (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">
            Confira cada item. O que voltou em condição de venda pode voltar ao
            estoque; a resolução fecha a devolução.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={modo === "concluir"}
              onClick={() => escolherModo("concluir")}
              className={cn(
                BOTAO_SECUNDARIO,
                modo === "concluir" && "border-admin-gold/50 text-admin-gold",
              )}
            >
              <Check className="size-4" />
              Concluir
            </button>
            <button
              type="button"
              aria-pressed={modo === "reprovar"}
              onClick={() => escolherModo("reprovar")}
              className={cn(
                BOTAO_PERIGO,
                modo === "reprovar" && "border-red-400/60",
              )}
            >
              <X className="size-4" />
              Reprovar
            </button>
          </div>

          {modo === "concluir" && (
            <div className="space-y-4" data-testid="form-concluir">
              {detalhe.itens.map((item) => {
                const i = inspecao.get(item.id);
                return (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-xl border border-white/5 bg-zinc-950/40 p-3"
                  >
                    <p className="truncate text-xs font-bold text-white">
                      {item.quantidade}× {item.product_name || "Produto"}
                    </p>
                    <div
                      role="group"
                      aria-label={`Condição de ${item.product_name || "item"}`}
                      className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
                    >
                      {CONDICOES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={i?.condicao === c}
                          onClick={() => mudarCondicao(item.id, c)}
                          className={cn(
                            "min-h-11 rounded-lg border px-2 text-[11px] font-bold transition-colors",
                            i?.condicao === c
                              ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
                              : "border-white/10 text-zinc-400 hover:text-white",
                          )}
                        >
                          {rotuloCondicao(c)}
                        </button>
                      ))}
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-400">
                        Voltar ao estoque
                        {item.reestocado_em ? " (já voltou)" : ""}
                      </span>
                      <Switch
                        checked={!!i?.reestocar && i?.condicao !== "ausente"}
                        disabled={!i?.condicao || i.condicao === "ausente"}
                        aria-label={`Voltar ${item.product_name || "item"} ao estoque`}
                        onCheckedChange={(v) => mudarReestoque(item.id, v)}
                        className="data-[state=checked]:bg-admin-gold"
                      />
                    </div>
                  </div>
                );
              })}

              <fieldset>
                <legend className={ROTULO}>Resolução</legend>
                <div className="grid grid-cols-3 gap-1.5">
                  {resolucoes.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={resolucao === r}
                      onClick={() => setResolucao(r)}
                      className={cn(
                        "min-h-11 rounded-lg border px-2 text-[11px] font-bold transition-colors",
                        resolucao === r
                          ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
                          : "border-white/10 text-zinc-400 hover:text-white",
                      )}
                    >
                      {rotuloResolucao(r)}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-zinc-500">
                  O cliente pediu: {rotuloResolucao(detalhe.resolucao_desejada)}
                </p>
              </fieldset>

              {resolucao === "reembolso" && (
                <div className="space-y-1.5">
                  <label htmlFor="devolucao-valor" className={ROTULO}>
                    Valor do reembolso
                  </label>
                  <LocalBufferedInput
                    id="devolucao-valor"
                    mask="currency"
                    inputMode="numeric"
                    value={valor}
                    onFlush={setValor}
                    className={cn(CAMPO, "h-11 py-0 tabular-nums")}
                  />
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    Itens {formatarReais(detalhe.valor_itens)}
                    {detalhe.valor_frete_ida > 0 &&
                      ` + frete de ida ${formatarReais(detalhe.valor_frete_ida)} (o pedido voltou inteiro)`}
                    .{" "}
                    {pagoPeloApp(detalhe)
                      ? "O dinheiro volta ao cliente pelo Mercado Pago (PIX ou cartão)."
                      : "Pedido pago fora do app: você devolve em mãos ou por PIX e o app registra a saída."}
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="devolucao-observacao" className={ROTULO}>
                  Observação da inspeção (opcional)
                </label>
                <LocalBufferedTextarea
                  id="devolucao-observacao"
                  value={observacao}
                  onFlush={setObservacao}
                  maxLength={1000}
                  rows={2}
                  className={CAMPO}
                />
              </div>

              <button
                type="button"
                disabled={ocupado}
                onClick={() => void concluir()}
                className={cn(BOTAO_PRINCIPAL, "w-full")}
              >
                {girando("concluir")}
                Concluir devolução
              </button>
            </div>
          )}

          {modo === "reprovar" && (
            <div className="space-y-3">
              <div>
                <label htmlFor="devolucao-reprovar" className={ROTULO}>
                  Por que o produto não foi aceito (o cliente vê)
                </label>
                <LocalBufferedTextarea
                  id="devolucao-reprovar"
                  value={motivo}
                  onFlush={setMotivo}
                  maxLength={1000}
                  rows={3}
                  placeholder="Ex.: o produto voltou com sinais de uso e sem etiqueta."
                  className={CAMPO}
                />
              </div>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void reprovar()}
                className={cn(BOTAO_PERIGO, "w-full")}
              >
                {girando("reprovar")}
                Reprovar na inspeção
              </button>
            </div>
          )}
        </>
      )}

      {erro && (
        <p
          role="alert"
          className="flex items-start gap-2 text-xs font-bold text-red-300"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {erro}
        </p>
      )}
    </section>
  );
}
