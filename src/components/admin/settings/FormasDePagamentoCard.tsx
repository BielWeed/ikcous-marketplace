import { AlertTriangle, CircleCheck, CircleOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import {
  FORMAS_DE_PAGAMENTO_NA_ENTREGA_EM_ORDEM,
  type FormaDePagamentoNaEntrega,
} from "@/lib/formas-de-pagamento-na-entrega";
import { haptic } from "@/utils/haptic";

import type { StoreConfig } from "@/types";

/**
 * FORMAS DE PAGAMENTO POR LOJA (brief 25/09/2026, migration 20261174000000).
 *
 * A lojista liga/desliga, por loja, cada forma "na entrega/retirada"
 * (pix/card/cash) — independente do pagamento pelo app (PIX, que continua
 * morando na seção Mercado Pago e exige credencial, por isso NÃO ganha um
 * switch duplicado aqui: só um status + porta para a seção de verdade).
 *
 * REGRA DE RECUSA (síntese do brief + emenda do crítico de desenho,
 * 25/09/2026 — o trigger vivo `store_config_exige_forma_de_pagamento` é a
 * fonte da verdade, este componente só espelha a MESMA regra do lado do
 * cliente para não gastar uma chamada de rede num clique que o banco reprova de
 * qualquer forma):
 *   - Desligar a ÚLTIMA forma na entrega É PERMITIDO quando o pagamento pelo
 *     app já está ligado (a loja passa a vender só pelo app — o pedido
 *     original do dono: "vender só com pagamento pelo app"). Mostra um
 *     AVISO, não bloqueia.
 *   - Desligar a ÚLTIMA forma na entrega SEM o pagamento pelo app ligado
 *     deixaria a loja SEM NENHUMA forma de pagamento — o mesmo estado que o
 *     trigger do banco recusa com `LOJA_SEM_FORMA_DE_PAGAMENTO`. A UI recusa
 *     ANTES de gastar a chamada, com o texto explicando o porquê.
 */
interface FormasDePagamentoSectionProps {
  readonly formasNaEntrega: readonly FormaDePagamentoNaEntrega[];
  readonly pixLigado: boolean;
  readonly pixChaveOk: boolean;
  readonly isOffline: boolean;
  readonly updateConfig: (updates: Partial<StoreConfig>) => Promise<boolean>;
  readonly onDirtyMudou?: (dirty: boolean) => void;
  /** Abre a seção Mercado Pago (a outra SecaoColapsavel, no hub) — ligar o
   * pagamento pelo app exige credencial, que mora só lá. */
  readonly onAbrirMercadoPago: () => void;
}

const ROTULO_DA_FORMA = new Map<FormaDePagamentoNaEntrega, string>([
  ["pix", "Pix na entrega/retirada"],
  ["card", "Cartão na entrega/retirada"],
  ["cash", "Dinheiro na entrega/retirada"],
]);

const ARIA_DA_FORMA = new Map<FormaDePagamentoNaEntrega, string>([
  ["pix", "Pix na entrega ou retirada"],
  ["card", "Cartão na entrega ou retirada"],
  ["cash", "Dinheiro na entrega ou retirada"],
]);

export function FormasDePagamentoSection({
  formasNaEntrega,
  pixLigado,
  pixChaveOk,
  isOffline,
  updateConfig,
  onDirtyMudou,
  onAbrirMercadoPago,
}: FormasDePagamentoSectionProps) {
  const [salvando, setSalvando] = useState<FormaDePagamentoNaEntrega | null>(
    null,
  );

  const ligada = (forma: FormaDePagamentoNaEntrega) =>
    formasNaEntrega.includes(forma);

  async function alternar(forma: FormaDePagamentoNaEntrega, ligar: boolean) {
    // Ordem CANÔNICA sempre, nunca a ordem de clique (mesma fonte que o
    // fallback do checkout usa) — evita que a prioridade de
    // `primeiraFormaDePagamentoDisponivel` dependa de qual switch a lojista
    // tocou primeiro.
    const proxima = ligar
      ? FORMAS_DE_PAGAMENTO_NA_ENTREGA_EM_ORDEM.filter(
          (f) => f === forma || formasNaEntrega.includes(f),
        )
      : formasNaEntrega.filter((f) => f !== forma);

    if (proxima.length === 0 && !pixLigado) {
      toast.error(
        "Não dá para desligar a última forma sem o pagamento pelo app ligado. Ligue o Pix pelo app antes, ou deixe ao menos uma forma na entrega.",
      );
      return;
    }

    if (isOffline) {
      toast.error("Você está offline");
      return;
    }

    haptic.light();
    setSalvando(forma);
    onDirtyMudou?.(true);
    try {
      // O toast de erro sai de dentro do `updateConfig` (ADMIN-010, #94) —
      // aqui só não se segue em frente se a gravação não confirmou.
      const salvou = await updateConfig({ formasPagamentoEntrega: proxima });
      if (!salvou) return;
      toast.success(
        ligar
          ? `${ROTULO_DA_FORMA.get(forma)} ligado`
          : `${ROTULO_DA_FORMA.get(forma)} desligado`,
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar a configuração");
    } finally {
      setSalvando(null);
      onDirtyMudou?.(false);
    }
  }

  const semNenhumaNaEntrega = formasNaEntrega.length === 0;

  return (
    <div className="space-y-3">
      {/* Status do pagamento pelo app — NUNCA um switch aqui: ligar exige
          credencial do Mercado Pago, que só é cadastrada na seção própria.
          Duplicar o switch permitiria "ligar" sem chave nenhuma. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-zinc-950/40 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          {pixLigado ? (
            <CircleCheck className="size-4 shrink-0 text-emerald-400" />
          ) : (
            <CircleOff className="size-4 shrink-0 text-zinc-500" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-bold text-zinc-200">
              Pagar pelo app (PIX)
            </span>
            <span className="block text-[10px] text-zinc-500">
              {pixLigado ? "Ligado" : "Desligado"}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={onAbrirMercadoPago}
          className="shrink-0 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-admin-gold transition-all hover:bg-admin-gold/20 active:scale-95"
        >
          Configurar credenciais
        </button>
      </div>

      {/* Os 3 switches — cada um é a loja inteira, sempre, sem lote/rascunho
          (mesmo padrão imediato de AdminReviewsView: clique salva). */}
      <div className="space-y-2 rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5">
        {FORMAS_DE_PAGAMENTO_NA_ENTREGA_EM_ORDEM.map((forma) => (
          <div key={forma} className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">
              {ROTULO_DA_FORMA.get(forma)}
            </span>
            <Switch
              checked={ligada(forma)}
              disabled={salvando !== null}
              aria-label={ARIA_DA_FORMA.get(forma)}
              onCheckedChange={(checked) => alternar(forma, checked)}
              className="scale-75 data-[state=checked]:bg-admin-gold"
            />
          </div>
        ))}
      </div>

      {/* Efeito de desligar tudo — visível o tempo todo que a loja estiver
          nesse estado, não só no instante do clique (a lojista pode voltar a
          esta tela dias depois e precisa continuar vendo o porquê). Emenda
          do crítico de desenho: o aviso tem de NOMEAR se o pagamento pelo
          app já está pronto de verdade (chave publicada) ou só ligado por
          fora — "ligado" sem chave é o mesmo estado quebrado que o
          termômetro de Mercado Pago já denuncia em "Minha loja está no ar?". */}
      {semNenhumaNaEntrega && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            {pixLigado ? (
              pixChaveOk ? (
                <>
                  Nenhuma forma na entrega está ligada: o cliente só compra
                  pagando pelo app, e precisa ter conta para isso. O pagamento
                  pelo app está pronto (chave configurada).
                </>
              ) : (
                <>
                  Nenhuma forma na entrega está ligada e o pagamento pelo app
                  está LIGADO mas SEM a chave configurada — hoje ninguém
                  consegue finalizar pedido nesta loja. Configure a chave do
                  Mercado Pago ou ligue ao menos uma forma na entrega.
                </>
              )
            ) : (
              <>
                Nenhuma forma na entrega está ligada e o pagamento pelo app está
                desligado — hoje ninguém consegue finalizar pedido nesta loja.
                Ligue o Pix pelo app ou ao menos uma forma na entrega.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
