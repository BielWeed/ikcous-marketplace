import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EtiquetasEnvioCard } from "@/components/admin/shipping/EtiquetasEnvioCard";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { frasesDaRegraDeFrete } from "@/utils/regra-de-frete";
import {
  AlertCircle,
  ExternalLink,
  HelpCircle,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminShippingViewProps {
  onNavigate?: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

const formatCEP = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5, 8)}`;
};

/**
 * Tela "Frete" do painel — reconstruída na frente glm-visual-admin-0209
 * (pedido do Gabriel, 02/09/2026: tela horrível, linguagem de lojista).
 *
 * DIVISÃO DE TERRITÓRIO: esta tela é a dona das REGRAS de cobrança e origem
 * (frete grátis, taxa fixa, CEP de origem, cobertura, entrega local). O
 * token da transportadora, o teste de conexão, os serviços habilitados e o
 * histórico de cotações NÃO moram mais aqui — viraram seções da tela de
 * Ajustes (`TransportadorasSection` / `HistoricoCotacoesSection`), e esta
 * tela mostra um resumo honesto do que está ativo com o atalho para lá.
 * Salvar aqui NÃO envia `shippingProvider`/`enabledShippingMethods` — quem
 * grava esses campos é a seção de Transportadoras; enviar de novo daqui
 * revertia a escolha salva por um valor velho de formulário.
 *
 * Todas as travas auditadas seguem valendo, agora sobre as regras apenas:
 * - o CEP de origem abre VAZIO quando a loja não configurou (nada de CEP
 *   inventado parecendo configuração pronta), com o aviso da consequência
 *   real: sem ele a loja não vende;
 * - as frases da regra descrevem o FORMULÁRIO (a pessoa vê a consequência
 *   antes de salvar) cruzado com o provedor SALVO (único verdadeiro);
 * - trocar de aba do painel não apaga o que foi digitado: a sincronização
 *   com config novo de fora só passa se o formulário não estiver sujo — e
 *   a PRIMEIRA carga sempre passa (o formulário nasce "sujo" contra uma
 *   loja configurada; a guarda de uma condição só travaria a tela vazia
 *   para sempre).
 */
export const AdminShippingView = memo(function AdminShippingView({
  onNavigate,
  active,
  onSetDirty,
}: Readonly<AdminShippingViewProps>) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Formulário local — só regras. Provedor e serviços são da seção de
  // Transportadoras, em Ajustes; daqui o provedor é apenas LEITURA (o salvo).
  const [formData, setFormData] = useState({
    freeShippingMin: 0,
    shippingFee: 0,
    // Sem reserva de propósito: "38500-000" cravava Monte Carmelo no
    // formulário antes mesmo de a loja abrir a tela. Como esta é a ÚNICA
    // tela onde o CEP de origem se define, um valor pré-preenchido parece
    // configuração pronta -- quem salva sem desconfiar grava Monte Carmelo
    // no banco da própria loja, e a validação que a edge function
    // (`calculate-shipping`) passou a fazer nunca dispara.
    originCep: "",
    shippingCoverage: "national" as "local" | "national",
    localDeliveryFee: 10,
    localCepRange: "",
  });

  // ── Achado 3 da auditoria rodada 2 (26/08/2026) ──────────────────────────
  // O efeito abaixo redispara quando `active` volta a `true` (a view do painel
  // nunca desmonta) e quando a identidade de `config` muda (realtime, outra
  // aba, save em outra tela — inclusive o save da seção de Transportadoras,
  // que agora mora em Ajustes). Sem guarda, ele reescrevia o formulário
  // inteiro e jogava fora o que o lojista tinha acabado de digitar, sem aviso.
  //
  // A guarda NÃO pode ser só "está sujo": `formData` nasce com valores neutros
  // (`freeShippingMin: 0`, `originCep: ""`), então numa loja configurada o
  // formulário já é "sujo" contra o config ANTES da primeira sincronização —
  // e a tela abriria eternamente vazia. Por isso são duas condições, e a
  // primeira carga sempre passa.
  const jaSincronizouRef = useRef(false);
  const isFormDirtyRef = useRef(false);

  // Sync state on load or activation
  useEffect(() => {
    if (isLoaded && config) {
      if (jaSincronizouRef.current && isFormDirtyRef.current) {
        // Há trabalho não salvo na tela. Nada é recarregado: o valor digitado
        // vence o que chegou de fora.
        return;
      }
      jaSincronizouRef.current = true;
      setFormData({
        freeShippingMin: Number(config.freeShippingMin ?? 0),
        shippingFee: Number(config.shippingFee ?? 0),
        originCep: config.originCep ?? "",
        shippingCoverage: (config.shippingCoverage || "national") as
          | "local"
          | "national",
        localDeliveryFee: Number(config.localDeliveryFee ?? 10),
        localCepRange: config.localCepRange || "",
      });
    }
  }, [isLoaded, config, active]);

  // O que a tela AFIRMA sobre a regra que está no formulário — não sobre a
  // que está salva: quem mexe no interruptor precisa ver na hora o que aquilo
  // vai significar, antes de salvar. O provedor entra pelo valor SALVO: fora
  // da seção de Transportadoras não existe escolha de provedor "por salvar",
  // e o aviso de entrega gratuita só é verdade quando a taxa fixa é de fato
  // o que governa o preço nacional (provider salvo = flat_fee).
  // Ver `frasesDaRegraDeFrete` para o motivo de as frases serem uma função.
  const frasesDaRegra = useMemo(
    () =>
      frasesDaRegraDeFrete({
        freeShippingMin: formData.freeShippingMin,
        shippingFee: formData.shippingFee,
        shippingCoverage: formData.shippingCoverage,
        shippingProvider: config?.shippingProvider || "flat_fee",
      }),
    [
      formData.freeShippingMin,
      formData.shippingFee,
      formData.shippingCoverage,
      config?.shippingProvider,
    ],
  );

  // Dirty check to enable save button — só regras de novo.
  const isFormDirty = useMemo(() => {
    if (!config) return false;
    if (formData.freeShippingMin !== Number(config.freeShippingMin ?? 0))
      return true;
    if (formData.shippingFee !== Number(config.shippingFee ?? 0)) return true;
    if (formData.originCep !== (config.originCep ?? "")) return true;
    if (formData.shippingCoverage !== (config.shippingCoverage || "national"))
      return true;
    if (formData.localDeliveryFee !== Number(config.localDeliveryFee ?? 10))
      return true;
    if (formData.localCepRange !== (config.localCepRange || "")) return true;
    return false;
  }, [formData, config]);

  // Report dirty state to AdminLayout
  useEffect(() => {
    onSetDirty?.(isFormDirty);
    // Achado 3: o espelho que o efeito de sincronização lê. Ele é declarado
    // ANTES deste na ordem do componente, então lê o valor do commit anterior
    // — que é exatamente a pergunta certa: "a pessoa já tinha mexido quando
    // esta config nova chegou?".
    isFormDirtyRef.current = isFormDirty;
  }, [isFormDirty, onSetDirty]);

  // Handle save configurations — só regras.
  const handleSave = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar as configurações.",
      });
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    haptic.medium();

    try {
      // Se esta gravação falhar, PARA AQUI. O `updateConfig` não engolia a
      // falha por acaso: o fluxo seguia, limpava o "dirty" e comemorava —
      // com o frete e o CEP de origem ainda com o valor antigo no banco
      // (ADMIN-010, #94). O toast de erro sai de dentro do `updateConfig`.
      const salvou = await updateConfig({
        freeShippingMin: Math.max(0, formData.freeShippingMin),
        shippingFee: Math.max(0, formData.shippingFee),
        originCep: formData.originCep,
        shippingCoverage: formData.shippingCoverage,
        localDeliveryFee: Math.max(0, formData.localDeliveryFee),
        localCepRange: formData.localCepRange,
      });
      if (!salvou) {
        haptic.error();
        return;
      }

      onSetDirty?.(false);
      haptic.success();
      toast.success("Regras de frete salvas!");
    } catch (err) {
      console.error("[AdminShippingView] Error saving configs:", err);
      haptic.error();
      toast.error("Erro ao salvar as configurações.");
    } finally {
      setIsSaving(false);
    }
  };

  const provedorSalvo = config?.shippingProvider || "flat_fee";

  return (
    <div className="pb-admin min-h-screen bg-admin-bg pb-32 text-zinc-100 transition-colors duration-200 animate-in fade-in sm:pb-36 lg:pb-40">
      {/* Top Header Bar — fórmula "Elite Header" (onda visual 02/09): o
          AdminPageHeader é a fórmula padronizada; a barra sticky fica na
          view, como em Ajustes. */}
      <div className="sticky top-0 z-30 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader titulo="Frete">
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
              title="Ajuda e explicação desta tela"
            >
              <HelpCircle className="size-4" />
            </button>
          </AdminPageHeader>

          <button
            type="button"
            disabled={!isFormDirty || isSaving || isOffline}
            onClick={handleSave}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-admin-gold/30 bg-admin-gold px-4 py-2 text-xs font-bold text-black shadow-lg shadow-amber-500/20 transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {isSaving ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>Salvar</span>
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-3 py-4 sm:p-6">
        {!isLoaded ? (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl border border-white/10 bg-zinc-900/40 p-4"
              >
                <Skeleton className="h-4 w-1/3 rounded-md bg-white/5" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-5">
            {/* ── Seção 1: o que o cliente paga ─────────────────────────── */}
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {/* Card: Frete Grátis */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
                  formData.freeShippingMin > 0
                    ? "border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-zinc-900/80 shadow-[0_4px_20px_rgba(16,185,129,0.08)]"
                    : "border-white/10 bg-zinc-900/40 hover:border-white/20"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex size-8 items-center justify-center rounded-xl border transition-all ${
                          formData.freeShippingMin > 0
                            ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                            : "border-white/10 bg-zinc-800/80 text-zinc-500"
                        }`}
                      >
                        <Truck className="size-4" strokeWidth={2.2} />
                      </div>
                      <div>
                        <Label
                          htmlFor="shipping-free-min-switch"
                          className="cursor-pointer text-xs font-bold tracking-wide text-white"
                        >
                          Frete Grátis por valor
                        </Label>
                        <span className="block text-[10px] font-medium text-zinc-400">
                          Compra acima de um valor, entrega sai de graça
                        </span>
                      </div>
                    </div>
                    <Switch
                      id="shipping-free-min-switch"
                      checked={formData.freeShippingMin > 0}
                      onCheckedChange={(checked) => {
                        setFormData((prev) => ({
                          ...prev,
                          freeShippingMin: checked ? 100 : 0,
                        }));
                      }}
                      className="data-[state=checked]:bg-emerald-500"
                      disabled={isOffline}
                    />
                  </div>

                  {formData.freeShippingMin > 0 ? (
                    <div className="space-y-2.5 pt-1 duration-200 animate-in fade-in">
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/60 p-1.5">
                        <button
                          type="button"
                          disabled={formData.freeShippingMin <= 0 || isOffline}
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              freeShippingMin: Math.max(
                                0,
                                prev.freeShippingMin - 10,
                              ),
                            }));
                          }}
                          className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 active:scale-95 disabled:opacity-30"
                        >
                          <Minus className="size-3" />
                        </button>

                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-emerald-400">
                            R$
                          </span>
                          <input
                            id="shipping-free-min"
                            type="number"
                            min="0"
                            step="5"
                            value={
                              formData.freeShippingMin === 0
                                ? ""
                                : formData.freeShippingMin
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormData((prev) => ({
                                ...prev,
                                freeShippingMin: val === "" ? 0 : Number(val),
                              }));
                            }}
                            className="w-16 border-0 bg-transparent text-center text-lg font-extrabold text-white focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none"
                            disabled={isOffline}
                          />
                        </div>

                        <button
                          type="button"
                          disabled={isOffline}
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              freeShippingMin: prev.freeShippingMin + 10,
                            }));
                          }}
                          className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 active:scale-95 disabled:opacity-30"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {[50, 100, 150, 200, 250].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={isOffline}
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                freeShippingMin: preset,
                              }))
                            }
                            className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold transition-all ${
                              formData.freeShippingMin === preset
                                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                                : "border-white/10 bg-zinc-800/60 text-zinc-400 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            R$ {preset}
                          </button>
                        ))}
                      </div>

                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[10.5px] font-medium text-emerald-300">
                        ✨ {frasesDaRegra.freteGratis}
                      </div>
                    </div>
                  ) : (
                    <p className="py-2 text-[11px] italic text-zinc-500">
                      {frasesDaRegra.freteGratis}
                    </p>
                  )}
                </div>
              </div>

              {/* Card: Taxa de entrega fixa */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
                  formData.shippingFee > 0
                    ? "border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-zinc-900/80 shadow-[0_4px_20px_rgba(245,158,11,0.08)]"
                    : "border-white/10 bg-zinc-900/40 hover:border-white/20"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex size-8 items-center justify-center rounded-xl border transition-all ${
                          formData.shippingFee > 0
                            ? "border-amber-500/30 bg-amber-500/20 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                            : "border-white/10 bg-zinc-800/80 text-zinc-500"
                        }`}
                      >
                        <Tag className="size-4" strokeWidth={2.2} />
                      </div>
                      <div>
                        <Label
                          htmlFor="shipping-fee-switch"
                          className="cursor-pointer text-xs font-bold tracking-wide text-white"
                        >
                          Taxa de entrega fixa
                        </Label>
                        <span className="block text-[10px] font-medium text-zinc-400">
                          O valor que custa a entrega quando não há frete grátis
                        </span>
                      </div>
                    </div>
                    <Switch
                      id="shipping-fee-switch"
                      checked={formData.shippingFee > 0}
                      onCheckedChange={(checked) => {
                        setFormData((prev) => ({
                          ...prev,
                          shippingFee: checked ? 15 : 0,
                        }));
                      }}
                      className="data-[state=checked]:bg-amber-500"
                      disabled={isOffline}
                    />
                  </div>

                  {formData.shippingFee > 0 ? (
                    <div className="space-y-2.5 pt-1 duration-200 animate-in fade-in">
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/60 p-1.5">
                        <button
                          type="button"
                          disabled={formData.shippingFee <= 0 || isOffline}
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              shippingFee: Math.max(0, prev.shippingFee - 1),
                            }));
                          }}
                          className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 active:scale-95 disabled:opacity-30"
                        >
                          <Minus className="size-3" />
                        </button>

                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-amber-400">
                            R$
                          </span>
                          <input
                            id="shipping-flat-fee"
                            type="number"
                            min="0"
                            step="1"
                            value={
                              formData.shippingFee === 0
                                ? ""
                                : formData.shippingFee
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormData((prev) => ({
                                ...prev,
                                shippingFee: val === "" ? 0 : Number(val),
                              }));
                            }}
                            className="w-16 border-0 bg-transparent text-center text-lg font-extrabold text-white focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none"
                            disabled={isOffline}
                          />
                        </div>

                        <button
                          type="button"
                          disabled={isOffline}
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              shippingFee: prev.shippingFee + 1,
                            }));
                          }}
                          className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 active:scale-95 disabled:opacity-30"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {[5, 10, 12, 15, 20].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={isOffline}
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                shippingFee: preset,
                              }))
                            }
                            className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold transition-all ${
                              formData.shippingFee === preset
                                ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                                : "border-white/10 bg-zinc-800/60 text-zinc-400 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            R$ {preset}
                          </button>
                        ))}
                      </div>

                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] font-medium text-amber-300">
                        💡 {frasesDaRegra.taxa}
                      </div>
                    </div>
                  ) : (
                    <p className="py-2 text-[11px] italic text-zinc-500">
                      {frasesDaRegra.taxa}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* O único estado em que a loja passa a entregar de graça para o
                país inteiro sem ter pedido isso: taxa em R$ 0 com cotação
                nacional pela taxa fixa. Fica fora dos dois cards de propósito
                — é a COMBINAÇÃO deles que produz o efeito. */}
            {frasesDaRegra.avisoDeEntregaGratuita && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[11px] font-medium leading-snug text-amber-200 duration-200 animate-in fade-in">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <span>{frasesDaRegra.avisoDeEntregaGratuita}</span>
              </div>
            )}

            {/* ── Seção 2: de onde as entregas saem ─────────────────────── */}
            <div className="space-y-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 shadow-xl backdrop-blur-md sm:p-5">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2.5">
                <MapPin className="size-4 text-amber-400" />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-200">
                  De onde as entregas saem
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* CEP de origem */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="origin-cep"
                    className="text-xs font-semibold text-zinc-300"
                  >
                    CEP da loja (de onde os pedidos partem)
                  </label>
                  <input
                    id="origin-cep"
                    type="text"
                    maxLength={9}
                    value={formData.originCep}
                    onChange={(e) => {
                      const val = formatCEP(e.target.value);
                      setFormData((prev) => ({ ...prev, originCep: val }));
                    }}
                    placeholder="00000-000"
                    className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 font-mono text-xs font-semibold text-white placeholder-zinc-600 transition-all focus:border-amber-500 focus:outline-none"
                  />
                  {/* Sem CEP de origem, `calculate-shipping` recusa cotar
                      (falha fechada, ver validarOrigemEFrete). O aviso
                      existe para a loja perceber ANTES de salvar um
                      formulário vazio, achando que já está configurado. */}
                  {!formData.originCep && (
                    // Laudo 31/08 (B1): o hint antigo dizia "nenhuma cotação é
                    // gerada" — verdade pela metade. A consequência real é a
                    // loja FECHADA: sem cotação o Finalizar fica travado para
                    // todo cliente (semFreteSelecionado / freteIndefinido).
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <p className="flex items-start gap-1.5 text-[10.5px] font-bold text-amber-300">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        SEM ISSO A LOJA NÃO VENDE: sem o CEP da loja nenhum
                        frete é calculado e o botão "Finalizar Pedido" fica
                        bloqueado para todo cliente. Preencha, confira o campo
                        acima e SALVE para abrir as vendas.
                      </p>
                    </div>
                  )}
                </div>

                {/* Cobertura */}
                <div className="space-y-1.5">
                  {/* `span`, não `label`: o controle abaixo é um par de botões,
                      não um campo de formulário — um `label` sem `htmlFor` não
                      rotula nada para o leitor de tela. */}
                  <span className="block text-xs font-semibold text-zinc-300">
                    Para onde a loja entrega
                  </span>
                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/60 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          shippingCoverage: "local",
                        }))
                      }
                      className={`h-8 rounded-lg text-xs font-bold transition-all ${
                        formData.shippingCoverage === "local"
                          ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Só na minha cidade
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          shippingCoverage: "national",
                        }))
                      }
                      className={`h-8 rounded-lg text-xs font-bold transition-all ${
                        formData.shippingCoverage === "national"
                          ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Todo o Brasil
                    </button>
                  </div>
                  <p className="text-[10px] leading-snug text-zinc-500">
                    Entregas fora da sua cidade usam os Correios ou
                    transportadora — o cálculo fica em Ajustes &gt;
                    Transportadoras.
                  </p>
                </div>
              </div>

              {/* Sub-bloco: entrega na própria cidade */}
              <div className="space-y-3 rounded-xl border border-white/5 bg-zinc-950/40 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-200">
                    Entrega na sua cidade
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    Para motoboy ou entrega própria
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-zinc-400">
                      Valor da entrega local
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 flex-1 items-center justify-between rounded-lg border border-white/10 bg-black/60 px-2.5">
                        <button
                          type="button"
                          disabled={formData.localDeliveryFee <= 0 || isOffline}
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              localDeliveryFee: Math.max(
                                0,
                                prev.localDeliveryFee - 1,
                              ),
                            }))
                          }
                          className="text-zinc-400 hover:text-white disabled:opacity-30"
                        >
                          <Minus className="size-3" />
                        </button>
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs font-bold text-amber-400">
                            R$
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={
                              formData.localDeliveryFee === 0
                                ? ""
                                : formData.localDeliveryFee
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormData((prev) => ({
                                ...prev,
                                localDeliveryFee: val === "" ? 0 : Number(val),
                              }));
                            }}
                            className="w-12 border-0 bg-transparent text-center text-xs font-bold text-white focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                            disabled={isOffline}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={isOffline}
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              localDeliveryFee: prev.localDeliveryFee + 1,
                            }))
                          }
                          className="text-zinc-400 hover:text-white disabled:opacity-30"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {[0, 5, 10, 15].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={isOffline}
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                localDeliveryFee: preset,
                              }))
                            }
                            className={`rounded-md border px-1.5 py-1 text-[10px] font-bold ${
                              formData.localDeliveryFee === preset
                                ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                                : "border-white/10 bg-zinc-800/60 text-zinc-400 hover:text-white"
                            }`}
                          >
                            {preset === 0 ? "Grátis" : `R$${preset}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="local-cep-range"
                      className="block text-[11px] font-medium text-zinc-400"
                    >
                      Faixa de CEPs locais (opcional)
                    </label>
                    <input
                      id="local-cep-range"
                      type="text"
                      value={formData.localCepRange}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          localCepRange: e.target.value,
                        }))
                      }
                      placeholder="Ex: 38500-000, 38500-999"
                      className="h-9 w-full rounded-lg border border-white/10 bg-black/60 px-3 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Seção 3: resumo honesto da cotação nacional ─────────────
                A antiga seção "Cálculo de Frete Nacional" (dropdown de
                provedor + token + teste + serviços) MODOU para Ajustes.
                Aqui resta o resumo do que está ATIVO (o provedor salvo) com
                o atalho para a configuração — para quem chega pelo caminho
                antigo entender em uma olhada onde as chaves foram parar. */}
            {formData.shippingCoverage === "national" && (
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 shadow-xl backdrop-blur-md duration-200 animate-in fade-in sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-800/80 text-zinc-300">
                    {provedorSalvo === "flat_fee" ? (
                      <Tag className="size-4" strokeWidth={2.2} />
                    ) : provedorSalvo === "melhor_envio" ? (
                      <Truck className="size-4" strokeWidth={2.2} />
                    ) : (
                      <Sparkles className="size-4" strokeWidth={2.2} />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-200">
                      Frete para o resto do Brasil
                    </h2>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                      {provedorSalvo === "flat_fee"
                        ? "Hoje, quem compra fora da sua cidade paga a taxa fixa que você configurou acima. Para cotar o frete na hora com Correios ou transportadora, conecte uma transportadora em Ajustes."
                        : `Hoje, o frete fora da sua cidade é cotado na hora pela transportadora ${provedorSalvo === "melhor_envio" ? "Melhor Envio" : "Frenet"}. A chave de acesso, o teste de conexão e os serviços ficam em Ajustes.`}
                    </p>
                  </div>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate("admin-settings")}
                    className="flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-admin-gold/30 hover:text-white active:scale-95 sm:self-center"
                  >
                    <ExternalLink className="size-3.5 text-admin-gold" />
                    <span>Abrir Ajustes</span>
                  </button>
                )}
              </div>
            )}
            {/* ── Seção 4: etiquetas de envio (Onda 3, rastreio automático)
                A etiqueta nasce da API do Melhor Envio — a confirmação de
                saldo e a gravação do rastreio no pedido moram no card (e na
                edge function melhor-envio-etiqueta). Sempre visível: é
                operação de envio, não regra de cobrança — não depende do
                interruptor de cobertura acima. */}
            <EtiquetasEnvioCard />
          </div>
        )}
      </div>

      {/* Ajuda da tela — inclui a mudança de casa das chaves: quem procurava
          o token aqui precisa sair sabendo para onde ele foi. */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ajuda — Frete da loja"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você define as REGRAS da entrega: quando o frete sai de
            graça, quanto custa, de onde os pedidos partem e para onde a loja
            entrega.
          </p>
          <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <Truck className="size-4 text-amber-500" />
              Onde estão as transportadoras
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              A chave de acesso das transportadoras (Melhor Envio, Frenet), o
              teste de conexão e o histórico de cotações saíram daqui e agora
              ficam em{" "}
              <span className="font-bold text-zinc-200">
                Ajustes &gt; Transportadoras
              </span>
              . O botão "Abrir Ajustes", no fim desta tela, leva direto para lá.
            </p>
          </div>
          <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <AlertCircle className="size-4 text-amber-500" />
              Não esqueça
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              O CEP da loja é obrigatório: sem ele o app não consegue calcular
              frete nenhum e o cliente não finaliza a compra. Mexeu em algo
              aqui? Clique em Salvar no topo — nada é aplicado antes disso.
            </p>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
