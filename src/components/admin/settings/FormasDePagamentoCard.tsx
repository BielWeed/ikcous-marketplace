import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import {
  type ConfigDoCartao,
  PARCELAS_MAX_TETO,
  buscarConfigDoCartao,
  salvarConfigDoCartao,
} from "@/lib/config-do-cartao";
import {
  FORMAS_DE_PAGAMENTO_NA_ENTREGA_EM_ORDEM,
  type FormaDePagamentoNaEntrega,
} from "@/lib/formas-de-pagamento-na-entrega";
import { haptic } from "@/utils/haptic";

import type { StoreConfig } from "@/types";

import { CARTAO_PELO_APP } from "./mercado-pago-conteudo";

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
  readonly updateConfig: (
    updates: Partial<StoreConfig>,
    options?: { readonly silentSuccess?: boolean },
  ) => Promise<boolean>;
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
      // ANOTAÇÃO 3 da revisão Opus do commit 085282c3: `silentSuccess`
      // cala o "Configurações salvas" genérico — cada switch já mostra o
      // PRÓPRIO toast de sucesso, mais específico, logo abaixo. Sem isto,
      // cada clique mostrava DOIS toasts de sucesso ao mesmo tempo. O
      // toast de ERRO continua saindo de dentro do `updateConfig`
      // (ADMIN-010, #94; e a mensagem específica de FORMA_DE_PAGAMENTO
      // desligada quando o `pixLigado` local está stale) — aqui só não se
      // segue em frente se a gravação não confirmou.
      const salvou = await updateConfig(
        { formasPagamentoEntrega: proxima },
        { silentSuccess: true },
      );
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
          {/* CheckCircle2/XCircle, não CircleCheck/CircleOff: mesmo
              significado (ligado/desligado), mas os dois primeiros já
              chegam ao bundle por outro caminho (CheckCircle2 em
              MercadoPagoSection.tsx, no MESMO chunk do admin; XCircle em
              13 arquivos do app) — importar um ícone NUNCA visto antes
              soma o SVG inteiro dele ao vendor-lucide compartilhado; um já
              presente não soma nada. Medido no re-review de tamanho do
              commit 277ec288: ~111 B de brotli só destes dois ícones. */}
          {pixLigado ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
          ) : (
            <XCircle className="size-4 shrink-0 text-zinc-500" />
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

      <CartaoPeloAppBloco
        pixLigado={pixLigado}
        isOffline={isOffline}
        onDirtyMudou={onDirtyMudou}
      />

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

const OPCOES_DE_PARCELAS = Array.from(
  { length: PARCELAS_MAX_TETO },
  (_, i) => i + 1,
);

type LeituraDoCartao =
  | { readonly estado: "carregando" }
  | { readonly estado: "falhou" }
  | { readonly estado: "ok"; readonly config: ConfigDoCartao };

/**
 * CARTÃO PELO APP (Fase 3.5, 26/09/2026) — crédito, débito e o teto de
 * parcelas, gravados pela RPC de admin `salvar_config_pagamento_cartao` e
 * lidos da tabela `config_pagamento_cartao` (contrato no plano
 * 2026-09-26-painel-cartao-e-devolucoes.md).
 *
 * Mesmo padrão imediato dos switches da entrega: cada toque salva a linha
 * inteira, e a tela mostra o que o BANCO devolveu (nunca o que o clique
 * pediu). Sem o PIX pelo app ligado (a mesma credencial do Mercado Pago),
 * ligar fica travado com o porquê na tela — desligar continua possível, para
 * a lojista nunca ficar presa com o cartão ligado.
 */
function CartaoPeloAppBloco({
  pixLigado,
  isOffline,
  onDirtyMudou,
}: {
  readonly pixLigado: boolean;
  readonly isOffline: boolean;
  readonly onDirtyMudou?: (dirty: boolean) => void;
}) {
  const [leitura, setLeitura] = useState<LeituraDoCartao>({
    estado: "carregando",
  });
  const [salvando, setSalvando] = useState(false);
  const idDasParcelas = useId();

  useEffect(() => {
    let vivo = true;
    buscarConfigDoCartao().then((resultado) => {
      if (!vivo) return;
      setLeitura(
        resultado.ok
          ? { estado: "ok", config: resultado.config }
          : { estado: "falhou" },
      );
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function salvar(desejada: ConfigDoCartao, sucesso: string) {
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    haptic.light();
    setSalvando(true);
    onDirtyMudou?.(true);
    try {
      const gravada = await salvarConfigDoCartao(desejada);
      setLeitura({ estado: "ok", config: gravada });
      toast.success(sucesso);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possível salvar o cartão pelo app. Tente de novo.",
      );
    } finally {
      setSalvando(false);
      onDirtyMudou?.(false);
    }
  }

  const config = leitura.estado === "ok" ? leitura.config : null;
  const podeMexer = config !== null && !salvando;

  return (
    <div className="space-y-2.5 rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5">
      <div className="flex items-center gap-2.5">
        <CreditCard className="size-4 shrink-0 text-admin-gold" />
        <span className="min-w-0">
          <span className="block text-[11px] font-bold text-zinc-200">
            {CARTAO_PELO_APP.titulo}
          </span>
          <span className="block text-[10px] text-zinc-500">
            {CARTAO_PELO_APP.subtitulo}
          </span>
        </span>
        {salvando && (
          <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-zinc-500" />
        )}
      </div>

      {leitura.estado === "carregando" && (
        <p className="text-[11px] text-zinc-500">Lendo a configuração...</p>
      )}
      {leitura.estado === "falhou" && (
        <p role="alert" className="text-[11px] text-red-300">
          {CARTAO_PELO_APP.leituraFalhou}
        </p>
      )}

      {config && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">Crédito</span>
            <Switch
              checked={config.credito}
              disabled={!podeMexer || (!pixLigado && !config.credito)}
              aria-label="Cartão de crédito pelo app"
              onCheckedChange={(checked) =>
                salvar(
                  { ...config, credito: checked },
                  checked
                    ? "Cartão de crédito pelo app ligado"
                    : "Cartão de crédito pelo app desligado",
                )
              }
              className="scale-75 data-[state=checked]:bg-admin-gold"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">Débito</span>
            <Switch
              checked={config.debito}
              disabled={!podeMexer || (!pixLigado && !config.debito)}
              aria-label="Cartão de débito pelo app"
              onCheckedChange={(checked) =>
                salvar(
                  { ...config, debito: checked },
                  checked
                    ? "Cartão de débito pelo app ligado"
                    : "Cartão de débito pelo app desligado",
                )
              }
              className="scale-75 data-[state=checked]:bg-admin-gold"
            />
          </div>
          {config.debito && (
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {CARTAO_PELO_APP.debito}
            </p>
          )}
          {config.credito && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={idDasParcelas}
                  className="text-xs text-zinc-300"
                >
                  Parcelar em até
                </label>
                <select
                  id={idDasParcelas}
                  value={config.parcelasMax}
                  disabled={!podeMexer}
                  onChange={(e) => {
                    const parcelasMax = Number(e.target.value);
                    salvar(
                      { ...config, parcelasMax },
                      parcelasMax === 1
                        ? "Crédito só à vista"
                        : `Crédito em até ${parcelasMax}x`,
                    );
                  }}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 font-mono text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-admin-gold/50 disabled:opacity-50"
                >
                  {OPCOES_DE_PARCELAS.map((n) => (
                    <option
                      key={n}
                      value={n}
                      className="bg-zinc-900 text-white"
                    >
                      {n === 1 ? "1x (à vista)" : `${n}x`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                {CARTAO_PELO_APP.parcelas}
              </p>
            </div>
          )}
        </>
      )}

      {!pixLigado && (
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
          <XCircle className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
          {CARTAO_PELO_APP.semPix}
        </p>
      )}
      <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
        {CARTAO_PELO_APP.testeAntes}
      </p>
    </div>
  );
}
