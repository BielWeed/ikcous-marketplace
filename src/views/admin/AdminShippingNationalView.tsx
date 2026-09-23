import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { buscarConfiguracaoDeFrete } from "@/components/admin/settings/TransportadorasCard";
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  erroDoFormularioNacional,
  estrategiaTemAlcanceEditavel,
} from "@/lib/estrategias-de-frete";
import type { EstrategiaDeFreteNacional, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertCircle, RefreshCw, Save } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminShippingNationalViewProps {
  onNavigate?: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

/**
 * Tela "Estratégias do frete nacional" (`admin-shipping-national`, T4,
 * 23/09/2026 — plano de estratégias de frete local e nacional). Sub-view de
 * `admin-shipping`, aberta pelo botão "Estratégias do frete nacional →"
 * dentro de "Fora da cidade" (`FreteNacionalBloco`).
 *
 * MESMA GRAMÁTICA VISUAL de `AdminShippingView` (direção D, 03/09/2026):
 * `AdminPageHeader` + cabeçalho sticky, seções como linhas finas (aqui só
 * uma: `EstrategiaNacionalBloco`), barra de salvar FIXA no rodapé que só
 * existe com alteração pendente.
 *
 * ESCOPO DOS DADOS: esta tela lê e grava SÓ as 5 colunas nacionais
 * (`nationalShippingStrategy/Min/DiscountType/DiscountValue/BenefitScope`) —
 * nunca `freeShippingMin` nem as demais chaves da tela de Frete local
 * (contrato do plano §5: "salvar aqui NÃO envia campo alheio", mesma regra
 * que já vale em `AdminShippingView`).
 *
 * REGRA DO ALCANCE (decisão do `socio`, 23/09/2026): o valor salvo nunca
 * muda sozinho. Só quando a lojista LIGA um grátis pela primeira vez — ou
 * seja, a estratégia ANTERIOR era "desligado" — o alcance nasce
 * pré-selecionado em "mais_barata"; trocar só o mínimo, ou alternar entre
 * duas estratégias de grátis, preserva o que já estava salvo.
 */
export const AdminShippingNationalView = memo(
  function AdminShippingNationalView({
    onNavigate,
    active,
    onSetDirty,
  }: Readonly<AdminShippingNationalViewProps>) {
    const { config, isLoaded, updateConfig } = useStore();
    const isOffline = useOnlineStatus();
    const [isSaving, setIsSaving] = useState(false);

    const [formData, setFormData] = useState({
      estrategia: "desligado" as EstrategiaDeFreteNacional,
      minimo: 0,
      tipoDesconto: null as "percentual" | "fixo" | null,
      valorDesconto: 0,
      alcance: "mais_barata" as "mais_barata" | "todas",
    });

    // Estado da conexão de transportadora (mesma edge que AdminShippingView
    // usa) — só para o aviso "a estratégia só vale com cotação de
    // transportadora". Buscada aqui de novo (não recebida por prop) porque
    // esta tela pode ser aberta por deep link/F5 direto, sem passar pela
    // AdminShippingView.
    const [algumProvedorLigado, setAlgumProvedorLigado] = useState(false);
    const [credsErro, setCredsErro] = useState(false);

    const fetchCreds = useCallback(async () => {
      setCredsErro(false);
      const resultado = await buscarConfiguracaoDeFrete();
      if (!resultado.ok) {
        setCredsErro(true);
        return;
      }
      setAlgumProvedorLigado(resultado.config.ligados.length > 0);
    }, []);

    // Mesmo padrão de guarda de sincronização de AdminShippingView: a
    // PRIMEIRA carga sempre sincroniza; depois, só se não houver alteração
    // pendente (senão o que a lojista digitou some quando o config
    // atualiza por realtime/outra aba).
    const jaSincronizouRef = useRef(false);
    const isFormDirtyRef = useRef(false);

    useEffect(() => {
      if (isLoaded && config) {
        if (jaSincronizouRef.current && isFormDirtyRef.current) {
          return;
        }
        jaSincronizouRef.current = true;
        setFormData({
          estrategia: config.nationalShippingStrategy,
          minimo: config.nationalShippingMin,
          tipoDesconto: config.nationalDiscountType,
          valorDesconto: config.nationalDiscountValue,
          alcance: config.nationalBenefitScope,
        });
        fetchCreds();
      }
    }, [isLoaded, config, active, fetchCreds]);

    const isFormDirty = useMemo(() => {
      if (!config) return false;
      return (
        formData.estrategia !== config.nationalShippingStrategy ||
        formData.minimo !== config.nationalShippingMin ||
        formData.tipoDesconto !== config.nationalDiscountType ||
        formData.valorDesconto !== config.nationalDiscountValue ||
        formData.alcance !== config.nationalBenefitScope
      );
    }, [formData, config]);

    useEffect(() => {
      onSetDirty?.(isFormDirty);
      isFormDirtyRef.current = isFormDirty;
    }, [isFormDirty, onSetDirty]);

    // Ao escolher uma estratégia: o alcance só é REESCRITO quando a
    // ANTERIOR era "desligado" e a nova é de grátis — ligar pela primeira
    // vez pré-seleciona "mais_barata" (decisão do socio). Trocar entre duas
    // estratégias de grátis, ou mexer só no mínimo (que nem passa por
    // aqui), preserva o que já estava.
    const escolherEstrategia = useCallback(
      (nova: EstrategiaDeFreteNacional) => {
        haptic.light();
        setFormData((prev) => {
          const eraDesligado = prev.estrategia === "desligado";
          const novaTemAlcance = estrategiaTemAlcanceEditavel(nova);
          return {
            ...prev,
            estrategia: nova,
            alcance:
              eraDesligado && novaTemAlcance ? "mais_barata" : prev.alcance,
          };
        });
      },
      [],
    );

    // REVISÃO (correção 3): o CHECK do banco vê o valor em CENTAVOS
    // (`numeric(10,2)` arredonda ao gravar) — 0,001 ou 0,004 passam no
    // `> 0` de `erroDoFormularioNacional` mas viram R$ 0,00 na coluna, e o
    // CHECK (`min > 0` / `valor > 0` do desconto fixo) recusa com o toast
    // genérico de erro. Guarda local, ADICIONAL à do lib (não substitui):
    // só as duas colunas onde o CHECK exige `> 0` de verdade (o mínimo
    // opcional do desconto pode ser 0 — "sem mínimo" é válido).
    const erroCentavos = useMemo(() => {
      const centavos = (valor: number) =>
        Math.round((Number(valor) || 0) * 100);
      if (
        formData.estrategia === "acima_de_valor" &&
        centavos(formData.minimo) <= 0
      ) {
        return "Informe um valor mínimo maior que R$ 0 para o grátis acima de um valor.";
      }
      if (
        formData.estrategia === "desconto_na_mais_barata" &&
        formData.tipoDesconto === "fixo" &&
        centavos(formData.valorDesconto) <= 0
      ) {
        return "Informe um valor de desconto maior que R$ 0.";
      }
      return null;
    }, [formData]);

    const erro = useMemo(
      () =>
        erroDoFormularioNacional({
          estrategia: formData.estrategia,
          minimo: formData.minimo,
          tipoDesconto: formData.tipoDesconto,
          valorDesconto: formData.valorDesconto,
        }) ?? erroCentavos,
      [formData, erroCentavos],
    );

    const handleSave = async () => {
      if (isOffline) {
        toast.error("Sem conexão com a internet", {
          description:
            "Você precisa estar online para salvar as configurações.",
        });
        return;
      }
      if (isSaving || erro) return;

      setIsSaving(true);
      haptic.medium();

      // REVISÃO (correção 1): monta o objeto AJUSTADO uma vez só — é ele que
      // vai para o servidor E para o `formData` no sucesso. Antes o payload
      // enviado (mínimo 0 fora de acima/desconto; tipo/valor do desconto
      // null/0 fora do desconto) e o `formData` guardado divergiam: depois
      // de salvar "Sempre grátis" vindo de "acima_de_valor" com mínimo 199,
      // o config ia a 0 mas o formData continuava com 199 — `isFormDirty`
      // nunca mais batia, a barra "Alterações não salvas" ficava presa para
      // sempre, e uma edição nova de verdade não emitia `onSetDirty(true)`
      // (o efeito só dispara quando `isFormDirty` MUDA de valor).
      const ehDesconto = formData.estrategia === "desconto_na_mais_barata";
      const ajustado = {
        estrategia: formData.estrategia,
        minimo:
          formData.estrategia === "acima_de_valor" || ehDesconto
            ? Math.max(0, formData.minimo)
            : 0,
        tipoDesconto: ehDesconto ? formData.tipoDesconto : null,
        valorDesconto: ehDesconto ? Math.max(0, formData.valorDesconto) : 0,
        alcance: formData.alcance,
      };

      try {
        const salvou = await updateConfig({
          nationalShippingStrategy: ajustado.estrategia,
          nationalShippingMin: ajustado.minimo,
          nationalDiscountType: ajustado.tipoDesconto,
          nationalDiscountValue: ajustado.valorDesconto,
          nationalBenefitScope: ajustado.alcance,
        });
        if (!salvou) {
          haptic.error();
          return;
        }

        setFormData(ajustado);
        onSetDirty?.(false);
        haptic.success();
        toast.success("Estratégia do frete nacional salva!");
      } catch (err) {
        console.error("[AdminShippingNationalView] Error saving configs:", err);
        haptic.error();
        toast.error("Erro ao salvar as configurações.");
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <div className="min-h-screen bg-admin-bg pb-[calc(11rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] text-zinc-100 transition-colors duration-200 animate-in fade-in lg:pb-40">
        <div className="sticky top-0 z-30 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <AdminPageHeader titulo="Frete nacional" />
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          {!isLoaded ? (
            <div className="animate-pulse space-y-5" aria-busy="true">
              <div className="h-12 border-b border-white/5" />
              <div className="h-12 border-b border-white/5" />
              <div className="h-12 border-b border-white/5" />
            </div>
          ) : (
            <>
              <p className="text-[14.5px] text-zinc-500">
                A regra que decide o preço do frete cotado por transportadora —
                a entrega na cidade e a retirada têm a estratégia própria em
                "Estratégias do frete local".
              </p>

              {!credsErro && !algumProvedorLigado && (
                <p className="mt-5 flex flex-wrap items-start gap-2 text-[12.5px] font-medium leading-snug text-amber-300 duration-200 animate-in fade-in">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Nenhuma transportadora ligada ainda — a estratégia só vale
                    quando há cotação de transportadora.
                  </span>
                  {onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate("admin-settings")}
                      className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-95"
                    >
                      Conectar transportadora
                    </button>
                  )}
                </p>
              )}
              {credsErro && (
                <p className="mt-5 flex items-center gap-2 text-[12.5px] leading-snug text-zinc-500">
                  <button
                    type="button"
                    onClick={fetchCreds}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
                  >
                    <RefreshCw className="size-3.5" />
                    Tentar de novo
                  </button>
                  Não foi possível confirmar a conexão com as transportadoras.
                </p>
              )}

              <div className="mt-8">
                <EstrategiaNacionalBloco
                  estrategia={formData.estrategia}
                  minimo={formData.minimo}
                  tipoDesconto={formData.tipoDesconto}
                  valorDesconto={formData.valorDesconto}
                  alcance={formData.alcance}
                  onEscolherEstrategia={escolherEstrategia}
                  onMinimo={(minimo) =>
                    setFormData((prev) => ({ ...prev, minimo }))
                  }
                  onTipoDesconto={(tipoDesconto) =>
                    setFormData((prev) => ({ ...prev, tipoDesconto }))
                  }
                  onValorDesconto={(valorDesconto) =>
                    setFormData((prev) => ({ ...prev, valorDesconto }))
                  }
                  onAlcance={(alcance) =>
                    setFormData((prev) => ({ ...prev, alcance }))
                  }
                  desabilitado={isOffline}
                />
              </div>

              {erro && (
                <p className="mt-6 flex items-start gap-2 text-[12px] font-bold leading-snug text-amber-300 duration-200 animate-in fade-in">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  {erro}
                </p>
              )}

              <p className="mt-10 flex items-start gap-2 text-[11px] leading-snug text-zinc-600">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Nada aqui vale antes de salvar. Mexeu? A barra do rodapé aparece
                para você conferir e salvar.
              </p>
            </>
          )}
        </div>

        {isLoaded && isFormDirty && (
          <div className="fixed inset-x-0 bottom-[calc(6.5rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] z-40 border-t border-white/10 bg-[#09090b]/90 backdrop-blur-md duration-200 animate-in fade-in lg:bottom-0">
            <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <p className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium text-zinc-400">
                <span
                  aria-hidden="true"
                  className="size-[7px] shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/50"
                />
                <span className="truncate">Alterações não salvas</span>
              </p>
              <button
                type="button"
                disabled={isSaving || isOffline || !!erro}
                onClick={handleSave}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-admin-accent px-5 py-2.5 text-sm font-extrabold text-zinc-950 shadow-lg shadow-admin-accent/20 transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {isSaving ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {isSaving ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
