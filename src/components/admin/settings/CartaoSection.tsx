import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  CHAVE_CONFIGURACAO_CARTAO,
  CONFIGURACAO_CARTAO_PADRAO,
  type ConfiguracaoCartao,
  PARCELAS_MAXIMO_CONFIGURAVEL,
  escreverConfiguracaoCartao,
  lerConfiguracaoCartao,
} from "@/lib/configuracaoCartao";
import { supabase } from "@/lib/supabase";
import { AlertCircle, Info, Loader2, Save } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Card "Cartão de crédito e débito" da tela de Ajustes (plano
 * docs/superpowers/plans/2026-09-30-cartao-de-credito-e-debito.md, T6).
 *
 * Decisão do dono (30/09/2026): parcelas "o máximo que puder", mas o
 * lojista configura no painel. Aqui ele liga/desliga crédito e débito e
 * escolhe até quantas parcelas oferecer no crédito. O mesmo valor decide o
 * que o Payment Brick oferece ao cliente e o que `criar-pagamento` aceita —
 * a regra é UMA só (`supabase/functions/_shared/configuracao-cartao.ts`).
 *
 * O QUE ESTE CARD NÃO FAZ: parcelamento SEM JUROS. Isso é da conta do
 * Mercado Pago do lojista ("Parcelado vendedor") e vale sozinho para o
 * pagamento dentro do app — a API não tem campo para isso (central de ajuda
 * do MP, lida em 30/09/2026). O card diz onde fica.
 *
 * Grava em `app_settings` pela policy de admin que já existe; o cliente lê
 * SÓ esta linha (migration 20261160000100).
 */
export const CartaoSection = memo(function CartaoSection({
  onDirtyMudou,
}: {
  /** Mesma trava das demais seções: bloqueia o fecho da seção colapsável
   * enquanto houver mudança não salva. */
  readonly onDirtyMudou?: (dirty: boolean) => void;
}) {
  const isOffline = useOnlineStatus();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  // Falha de LEITURA (rede, permissão): o formulário trava — salvar por
  // cima de um valor que não se conseguiu ver apagaria a escolha salva.
  const [falhaDeLeitura, setFalhaDeLeitura] = useState(false);
  // Valor salvo ILEGÍVEL: o checkout já está em "só PIX"; salvar é o
  // conserto, então o botão fica disponível mesmo sem mudança na tela.
  const [ilegivel, setIlegivel] = useState(false);
  const [salva, setSalva] = useState<ConfiguracaoCartao>(
    CONFIGURACAO_CARTAO_PADRAO,
  );
  const [edicao, setEdicao] = useState<ConfiguracaoCartao>(
    CONFIGURACAO_CARTAO_PADRAO,
  );
  const [salvando, setSalvando] = useState(false);

  const ler = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    setFalhaDeLeitura(false);
    setIlegivel(false);
    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", CHAVE_CONFIGURACAO_CARTAO)
        .maybeSingle();
      if (error) throw error;
      const leitura = lerConfiguracaoCartao(data?.value ?? null);
      if (!leitura.ok) {
        // Nunca mostrar o padrão por cima de um valor ilegível: o lojista
        // salvaria "tudo ligado" achando que era o que já estava valendo.
        setErroCarga(
          "A configuração salva está ilegível. Escolha as opções de novo e salve — enquanto isso, o checkout oferece só PIX.",
        );
        setIlegivel(true);
        setSalva(CONFIGURACAO_CARTAO_PADRAO);
        setEdicao(CONFIGURACAO_CARTAO_PADRAO);
        return;
      }
      setSalva(leitura.config);
      setEdicao(leitura.config);
    } catch (err) {
      console.error("CartaoSection: falha ao ler a configuração", err);
      setFalhaDeLeitura(true);
      setErroCarga(
        "Não consegui ler a configuração do cartão agora. Tente de novo em instantes.",
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  const dirty =
    !carregando &&
    !falhaDeLeitura &&
    (edicao.credito !== salva.credito ||
      edicao.debito !== salva.debito ||
      edicao.parcelasMax !== salva.parcelasMax);

  useEffect(() => {
    onDirtyMudou?.(dirty);
  }, [dirty, onDirtyMudou]);

  const salvar = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar.",
      });
      return;
    }
    if (salvando) return;
    setSalvando(true);
    try {
      const { error } = await supabase.from("app_settings").upsert(
        {
          key: CHAVE_CONFIGURACAO_CARTAO,
          value: escreverConfiguracaoCartao(edicao),
          description:
            "Cartão no checkout: quais cartões e até quantas parcelas (painel Ajustes › Pagamentos).",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
      if (error) throw error;
      setSalva(edicao);
      setErroCarga(null);
      setIlegivel(false);
      toast.success("Configuração do cartão salva.");
    } catch (err) {
      console.error("CartaoSection: falha ao salvar", err);
      toast.error("Não consegui salvar a configuração do cartão.", {
        description: "Tente de novo em instantes.",
      });
    } finally {
      setSalvando(false);
    }
  };

  const opcoesDeParcelas = Array.from(
    { length: PARCELAS_MAXIMO_CONFIGURAVEL },
    (_, i) => i + 1,
  );

  return (
    <div className="space-y-4">
      {carregando ? (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <>
          {erroCarga && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{erroCarga}</span>
            </p>
          )}
          {falhaDeLeitura && (
            <button
              type="button"
              onClick={ler}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-zinc-200 active:scale-95"
            >
              Tentar de novo
            </button>
          )}

          <fieldset className="space-y-2" disabled={salvando || falhaDeLeitura}>
            <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Cartões aceitos no app
            </legend>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={edicao.credito}
                onChange={(e) =>
                  setEdicao((atual) => ({
                    ...atual,
                    credito: e.target.checked,
                  }))
                }
                className="size-4 accent-admin-gold"
              />
              Cartão de crédito
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={edicao.debito}
                onChange={(e) =>
                  setEdicao((atual) => ({
                    ...atual,
                    debito: e.target.checked,
                  }))
                }
                className="size-4 accent-admin-gold"
              />
              Cartão de débito (sempre à vista)
            </label>
          </fieldset>

          <div className="space-y-1.5">
            <label
              htmlFor="cartao-parcelas-max"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
            >
              Parcelas no crédito
            </label>
            <select
              id="cartao-parcelas-max"
              disabled={salvando || falhaDeLeitura || !edicao.credito}
              value={edicao.parcelasMax ?? ""}
              onChange={(e) =>
                setEdicao((atual) => ({
                  ...atual,
                  parcelasMax:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 text-xs text-white focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              <option value="">O máximo que o Mercado Pago oferecer</option>
              {opcoesDeParcelas.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Só à vista (1x)" : `Até ${n}x`}
                </option>
              ))}
            </select>
          </div>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-400">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Parcelas <strong>sem juros</strong> (você paga os juros no lugar
              do cliente) se ligam na sua conta do Mercado Pago, não aqui:
              procure por "Oferecer parcelas sem acréscimo" em Seu negócio
              (Custos, ou Taxas e parcelas — o nome muda com a versão do app).
              Sem isso, os juros das parcelas ficam com o cliente, e ele vê o
              valor final antes de pagar.
            </span>
          </p>

          {!edicao.credito && !edicao.debito && (
            <p className="text-[11px] text-amber-400">
              Com os dois desligados, o checkout oferece só PIX.
            </p>
          )}

          <button
            type="button"
            disabled={salvando || isOffline || !(dirty || ilegivel)}
            onClick={salvar}
            className="flex items-center gap-1.5 rounded-lg bg-admin-gold px-4 py-2 text-xs font-black text-zinc-950 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {salvando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>Salvar</span>
          </button>
        </>
      )}
    </div>
  );
});
