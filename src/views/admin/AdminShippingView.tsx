import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { frasesDaRegraDeFrete } from "@/utils/regra-de-frete";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Lock,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export const AdminShippingView = memo(function AdminShippingView({
  active,
  onSetDirty,
}: Readonly<AdminShippingViewProps>) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();

  // Local Form State
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
    shippingProvider: "flat_fee" as "flat_fee" | "melhor_envio" | "frenet",
    enabledShippingMethods: ["sedex", "pac"],
    shippingCoverage: "national" as "local" | "national",
    localDeliveryFee: 10,
    localCepRange: "",
  });

  // Credentials State
  const [shippingCreds, setShippingCreds] = useState<{ [key: string]: any }>(
    {},
  );
  const [originalShippingCreds, setOriginalShippingCreds] = useState<{
    [key: string]: any;
  }>({});
  const [, setLoadingCreds] = useState(false);

  // Connection Test State
  const [isTestingCreds, setIsTestingCreds] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Calculation Logs State
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  // Dropdown State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isSaving, setIsSaving] = useState(false);

  // Fetch shipping credentials from Supabase
  const fetchShippingCreds = useCallback(async () => {
    setLoadingCreds(true);
    try {
      const { data, error } = await supabase
        .from("store_shipping_credentials")
        .select("*");
      if (!error && data) {
        const credsMap: { [key: string]: any } = {};
        data.forEach((row) => {
          credsMap[row.provider] = row.credentials;
        });
        setShippingCreds(credsMap);
        setOriginalShippingCreds(JSON.parse(JSON.stringify(credsMap)));
      }
    } catch (err) {
      console.error("Error fetching shipping credentials:", err);
    } finally {
      setLoadingCreds(false);
    }
  }, []);

  // Fetch calculation logs
  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    // Limpa o erro da rodada anterior no início de CADA busca — senão uma
    // falha antiga fica grudada na tela depois de um "Atualizar" que deu
    // certo.
    setLogsError(false);
    try {
      const { data, error } = await supabase
        .from("shipping_calculation_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error("[ShippingLogs] Error fetching logs:", err);
      setLogsError(true);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  // Sync state on load or activation
  useEffect(() => {
    if (isLoaded && config) {
      setFormData({
        freeShippingMin: Number(config.freeShippingMin ?? 0),
        shippingFee: Number(config.shippingFee ?? 0),
        originCep: config.originCep ?? "",
        shippingProvider: (config.shippingProvider || "flat_fee") as
          | "flat_fee"
          | "melhor_envio"
          | "frenet",
        enabledShippingMethods: config.enabledShippingMethods || [
          "sedex",
          "pac",
        ],
        shippingCoverage: (config.shippingCoverage || "national") as
          | "local"
          | "national",
        localDeliveryFee: Number(config.localDeliveryFee ?? 10),
        localCepRange: config.localCepRange || "",
      });
      fetchShippingCreds();
    }
  }, [isLoaded, config, active, fetchShippingCreds]);

  // Click outside for dropdown select
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Fetch logs when expanded
  useEffect(() => {
    if (isLogsOpen) {
      fetchLogs();
    }
  }, [isLogsOpen, fetchLogs]);

  // O que a tela AFIRMA sobre a regra que está no formulário — não sobre a
  // que está salva: quem mexe no interruptor precisa ver na hora o que aquilo
  // vai significar, antes de salvar. Ver `frasesDaRegraDeFrete` para o motivo
  // de as frases não morarem mais aqui dentro do markup.
  const frasesDaRegra = useMemo(
    () =>
      frasesDaRegraDeFrete({
        freeShippingMin: formData.freeShippingMin,
        shippingFee: formData.shippingFee,
        shippingCoverage: formData.shippingCoverage,
        shippingProvider: formData.shippingProvider,
      }),
    [
      formData.freeShippingMin,
      formData.shippingFee,
      formData.shippingCoverage,
      formData.shippingProvider,
    ],
  );

  // Dirty check to enable save button
  const isFormDirty = useMemo(() => {
    if (!config) return false;
    if (formData.freeShippingMin !== Number(config.freeShippingMin ?? 0))
      return true;
    if (formData.shippingFee !== Number(config.shippingFee ?? 0)) return true;
    if (formData.originCep !== (config.originCep ?? "")) return true;
    if (formData.shippingProvider !== (config.shippingProvider || "flat_fee"))
      return true;
    if (formData.shippingCoverage !== (config.shippingCoverage || "national"))
      return true;
    if (formData.localDeliveryFee !== Number(config.localDeliveryFee ?? 10))
      return true;
    if (formData.localCepRange !== (config.localCepRange || "")) return true;

    // Check array differences
    const methodsA = formData.enabledShippingMethods || [];
    const methodsB = config.enabledShippingMethods || [];
    if (methodsA.length !== methodsB.length) return true;
    const sortedA = [...methodsA].sort();
    const sortedB = [...methodsB].sort();
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return true;
    }

    // Check credentials differences
    const provider = formData.shippingProvider;
    if (provider !== "flat_fee") {
      const tokenA = shippingCreds[provider]?.token || "";
      const tokenB = originalShippingCreds[provider]?.token || "";
      if (tokenA !== tokenB) return true;

      if (provider === "melhor_envio") {
        const sandboxA = !!shippingCreds[provider]?.sandbox;
        const sandboxB = !!originalShippingCreds[provider]?.sandbox;
        if (sandboxA !== sandboxB) return true;
      }
    }

    return false;
  }, [formData, config, shippingCreds, originalShippingCreds]);

  // Report dirty state to AdminLayout
  useEffect(() => {
    onSetDirty?.(isFormDirty);
  }, [isFormDirty, onSetDirty]);

  // Test connection credentials
  const handleTestCredentials = useCallback(async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }

    const provider = formData.shippingProvider;
    const creds = shippingCreds[provider];
    if (!creds || !creds.token) {
      toast.error("Informe o token de acesso para testar.");
      return;
    }

    setIsTestingCreds(true);
    setTestResult(null);
    haptic.light();

    try {
      const { data, error } = await supabase.functions.invoke(
        "calculate-shipping",
        {
          body: {
            action: "test_credentials",
            provider,
            credentials: creds,
          },
        },
      );

      if (error) throw error;

      if (data?.success) {
        setTestResult({
          success: true,
          message: data.message || "Credenciais válidas e conectadas!",
        });
        toast.success("Integração de frete validada com sucesso!");
      } else {
        setTestResult({
          success: false,
          message: data?.error || "Falha na validação das credenciais.",
        });
        toast.error("Falha ao validar credenciais de frete");
      }
    } catch (err: any) {
      console.error("[TestCredentials] Error:", err);
      setTestResult({
        success: false,
        message: mensagemAmigavelErroEdgeFunction(err, {
          mensagemGenerica:
            "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
        }),
      });
      toast.error("Erro ao testar credenciais");
    } finally {
      setIsTestingCreds(false);
    }
  }, [isOffline, formData.shippingProvider, shippingCreds]);

  // Handle save configurations
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
      // 1. Save standard settings properties in store_config
      //
      // Se esta gravação falhar, PARA AQUI. Antes o `updateConfig` engolia a
      // falha e o fluxo seguia: gravava as credenciais do provedor, limpava o
      // "dirty" do formulário e comemorava — com o frete e o CEP de origem
      // ainda com o valor antigo no banco (ADMIN-010, #94). O toast de erro sai
      // de dentro do `updateConfig`.
      const salvou = await updateConfig({
        freeShippingMin: Math.max(0, formData.freeShippingMin),
        shippingFee: Math.max(0, formData.shippingFee),
        originCep: formData.originCep,
        shippingProvider: formData.shippingProvider,
        enabledShippingMethods: formData.enabledShippingMethods,
        shippingCoverage: formData.shippingCoverage,
        localDeliveryFee: Math.max(0, formData.localDeliveryFee),
        localCepRange: formData.localCepRange,
      });
      if (!salvou) {
        haptic.error();
        return;
      }

      // 2. Save credentials in database if not flat_fee
      const provider = formData.shippingProvider;
      if (provider !== "flat_fee") {
        const creds = shippingCreds[provider] || {};
        const { error: credsError } = await supabase
          .from("store_shipping_credentials")
          .upsert(
            {
              provider,
              credentials: creds,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "provider" },
          );

        if (credsError) throw credsError;
      }

      setOriginalShippingCreds(JSON.parse(JSON.stringify(shippingCreds)));
      onSetDirty?.(false);
      haptic.success();
      toast.success("Configurações salvas!", {
        description: "As regras e chaves de frete foram salvas com sucesso.",
      });
    } catch (err) {
      console.error("[AdminShippingView] Error saving configs:", err);
      haptic.error();
      toast.error("Erro ao salvar as configurações.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-admin-bg pb-admin pb-32 sm:pb-36 lg:pb-40 text-zinc-100 transition-colors animate-in fade-in duration-200">
      {/* Top Header Bar */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#09090b]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
              <Truck className="size-4" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white sm:text-lg">
                Logística & Frete
              </h1>
              <p className="text-[10px] font-medium text-zinc-400 sm:text-xs">
                Regras de entrega, taxas fixas e integrações de frete
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={!isFormDirty || isSaving || isOffline}
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500 px-4 py-2 text-xs font-bold text-black shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-400 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
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

      <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        {!isLoaded ? (
          <div className="space-y-4 animate-pulse">
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
            {/* Section 1: Regras Principais de Valores */}
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {/* Card 1: Frete Grátis */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
                  formData.freeShippingMin > 0
                    ? "border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-zinc-900/80 shadow-[0_4px_20px_rgba(16,185,129,0.08)]"
                    : "border-white/10 bg-zinc-900/40 hover:border-white/20"
                }`}
              >
                <div className="space-y-3">
                  {/* Card Header */}
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
                          className="cursor-pointer text-xs font-bold text-white tracking-wide"
                        >
                          Frete Grátis
                        </Label>
                        <span className="block text-[10px] font-medium text-zinc-400">
                          Regra por valor de compra
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

                  {/* Card Body */}
                  {formData.freeShippingMin > 0 ? (
                    <div className="space-y-2.5 pt-1 animate-in fade-in duration-200">
                      {/* Compact Value Input */}
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

                      {/* Presets */}
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

                      {/* Mini Simulation Badge */}
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[10.5px] font-medium text-emerald-300">
                        ✨ {frasesDaRegra.freteGratis}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500 italic py-2">
                      {frasesDaRegra.freteGratis}
                    </p>
                  )}
                </div>
              </div>

              {/* Card 2: Taxa de Entrega Fixa */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
                  formData.shippingFee > 0
                    ? "border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-zinc-900/80 shadow-[0_4px_20px_rgba(245,158,11,0.08)]"
                    : "border-white/10 bg-zinc-900/40 hover:border-white/20"
                }`}
              >
                <div className="space-y-3">
                  {/* Card Header */}
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
                          className="cursor-pointer text-xs font-bold text-white tracking-wide"
                        >
                          Taxa Padrão de Entrega
                        </Label>
                        <span className="block text-[10px] font-medium text-zinc-400">
                          Valor fixo cobrado se não houver frete grátis
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

                  {/* Card Body */}
                  {formData.shippingFee > 0 ? (
                    <div className="space-y-2.5 pt-1 animate-in fade-in duration-200">
                      {/* Compact Value Input */}
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

                      {/* Presets */}
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

                      {/* Rule Summary Badge */}
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] font-medium text-amber-300">
                        💡 {frasesDaRegra.taxa}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500 italic py-2">
                      {frasesDaRegra.taxa}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* O único estado em que a loja passa a entregar de graça para o
                país inteiro sem ter pedido isso: taxa em R$ 0 com cotação
                nacional pela taxa fixa. Fica fora dos dois cards de propósito
                — é a COMBINAÇÃO deles que produz o efeito, e foi justamente
                por cada card só olhar o próprio interruptor que a tela dizia
                "todos os pedidos terão cobrança de entrega" enquanto o app
                cobrava R$ 0,00 de todo mundo. */}
            {frasesDaRegra.avisoDeEntregaGratuita && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[11px] font-medium leading-snug text-amber-200 duration-200 animate-in fade-in">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <span>{frasesDaRegra.avisoDeEntregaGratuita}</span>
              </div>
            )}

            {/* Section 2: Origem & Abrangência de Envio */}
            <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-5 space-y-4 backdrop-blur-md shadow-xl">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2.5">
                <MapPin className="size-4 text-amber-400" />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-200">
                  Origem e Abrangência da Entrega
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Segmented Control - Abrangência */}
                <div className="space-y-1.5">
                  {/* `span`, não `label`: o controle abaixo é um par de botões,
                      não um campo de formulário — um `label` sem `htmlFor` não
                      rotula nada para o leitor de tela e ainda quebrava o hook
                      de pre-commit de quem tocasse neste arquivo. */}
                  <span className="block text-xs font-semibold text-zinc-300">
                    Abrangência de Envio
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
                      Apenas Local
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
                </div>

                {/* CEP Origem Input */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="origin-cep"
                    className="text-xs font-semibold text-zinc-300"
                  >
                    CEP de Origem (Endereço da Loja)
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
                    <p className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
                      <AlertCircle className="size-3 shrink-0" />
                      Obrigatório para calcular frete — sem ele, nenhuma cotação
                      é gerada.
                    </p>
                  )}
                </div>
              </div>

              {/* Sub-block: Entrega Local na Cidade */}
              <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-200">
                    Entrega Local (Na Cidade)
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    Aplicável para entregas via motoboy / entrega própria
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-zinc-400">
                      Taxa Local
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
                      className="text-[11px] font-medium text-zinc-400 block"
                    >
                      Faixa de CEPs Locais (Opcional)
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

            {/* Section 3: Cotação Nacional via APIs */}
            {formData.shippingCoverage === "national" && (
              <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-5 space-y-4 backdrop-blur-md shadow-xl animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Sliders className="size-4 text-amber-400" />
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-200">
                      Cálculo de Frete Nacional
                    </h2>
                  </div>
                  <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                    APIs & Cotações
                  </span>
                </div>

                {/* Dropdown Provedor */}
                <div className="space-y-1.5">
                  {/* Mesmo caso do "Abrangência de Envio": o controle é um
                      botão que abre um menu, não um campo. */}
                  <span className="block text-xs font-semibold text-zinc-300">
                    Método de Cálculo Nacional
                  </span>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen((prev) => !prev)}
                      className="flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-black/50 px-3.5 text-xs font-semibold text-white transition-all hover:border-white/20 focus:border-amber-500 focus:outline-none"
                    >
                      <div className="flex items-center gap-2">
                        {formData.shippingProvider === "flat_fee" && (
                          <>
                            <Tag className="size-3.5 text-amber-400" />
                            <span>Taxa Única Fixa (Sem API externa)</span>
                          </>
                        )}
                        {formData.shippingProvider === "melhor_envio" && (
                          <>
                            <Truck className="size-3.5 text-emerald-400" />
                            <span>Melhor Envio (API em tempo real)</span>
                          </>
                        )}
                        {formData.shippingProvider === "frenet" && (
                          <>
                            <Sparkles className="size-3.5 text-purple-400" />
                            <span>Frenet (API em tempo real)</span>
                          </>
                        )}
                      </div>
                      <ChevronDown
                        className={`size-4 text-zinc-400 transition-transform ${
                          isDropdownOpen ? "rotate-180 text-amber-400" : ""
                        }`}
                      />
                    </button>

                    {isDropdownOpen && (
                      <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 p-1 shadow-2xl backdrop-blur-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              shippingProvider: "flat_fee",
                            }));
                            setIsDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-xs font-medium transition-colors hover:bg-white/5 ${
                            formData.shippingProvider === "flat_fee"
                              ? "bg-amber-500/10 text-amber-300 font-bold"
                              : "text-zinc-300"
                          }`}
                        >
                          <Tag className="size-4 text-amber-400" />
                          <div>
                            <div>Taxa Única Fixa</div>
                            <div className="text-[10px] text-zinc-500 font-normal">
                              Usa a taxa padrão configurada acima para todo o
                              Brasil
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              shippingProvider: "melhor_envio",
                            }));
                            setIsDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-xs font-medium transition-colors hover:bg-white/5 ${
                            formData.shippingProvider === "melhor_envio"
                              ? "bg-emerald-500/10 text-emerald-300 font-bold"
                              : "text-zinc-300"
                          }`}
                        >
                          <Truck className="size-4 text-emerald-400" />
                          <div>
                            <div>Melhor Envio (API)</div>
                            <div className="text-[10px] text-zinc-500 font-normal">
                              Cotações dinâmicas dos Correios, Jadlog, Azul
                              Cargo
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              shippingProvider: "frenet",
                            }));
                            setIsDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-xs font-medium transition-colors hover:bg-white/5 ${
                            formData.shippingProvider === "frenet"
                              ? "bg-purple-500/10 text-purple-300 font-bold"
                              : "text-zinc-300"
                          }`}
                        >
                          <Sparkles className="size-4 text-purple-400" />
                          <div>
                            <div>Frenet (API)</div>
                            <div className="text-[10px] text-zinc-500 font-normal">
                              Cotação direta de transportadoras conectadas
                            </div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* API Token & Credentials Box */}
                {formData.shippingProvider !== "flat_fee" && (
                  <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-3.5 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-white">
                        <Lock className="size-3.5 text-amber-400" />
                        <span>
                          Token de Acesso -{" "}
                          {formData.shippingProvider === "melhor_envio"
                            ? "Melhor Envio"
                            : "Frenet"}
                        </span>
                      </div>

                      {formData.shippingProvider === "melhor_envio" && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-zinc-400">
                            Sandbox
                          </span>
                          <Switch
                            checked={!!shippingCreds.melhor_envio?.sandbox}
                            onCheckedChange={(checked) => {
                              setShippingCreds((prev) => ({
                                ...prev,
                                melhor_envio: {
                                  ...prev.melhor_envio,
                                  sandbox: checked,
                                },
                              }));
                            }}
                            className="scale-75 data-[state=checked]:bg-amber-500"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={
                          shippingCreds[formData.shippingProvider]?.token || ""
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setShippingCreds((prev) => ({
                            ...prev,
                            [formData.shippingProvider]: {
                              ...prev[formData.shippingProvider],
                              token: val,
                            },
                          }));
                        }}
                        placeholder="Cole seu Bearer/API Token aqui..."
                        className="h-9 flex-1 rounded-lg border border-white/10 bg-black/60 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={
                          isTestingCreds ||
                          !shippingCreds[formData.shippingProvider]?.token
                        }
                        onClick={handleTestCredentials}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-500/20 active:scale-95 disabled:opacity-40"
                      >
                        {isTestingCreds ? (
                          <RefreshCw className="size-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3" />
                        )}
                        <span>Testar</span>
                      </button>
                    </div>

                    {testResult && (
                      <div
                        className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
                          testResult.success
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/30 bg-red-500/10 text-red-300"
                        }`}
                      >
                        {testResult.success ? (
                          <CheckCircle2 className="size-4 shrink-0" />
                        ) : (
                          <AlertCircle className="size-4 shrink-0" />
                        )}
                        <span>{testResult.message}</span>
                      </div>
                    )}

                    {/* Active Methods Selection */}
                    <div className="pt-1 space-y-1.5">
                      <span className="text-[11px] font-semibold text-zinc-400 block">
                        Serviços Habilitados
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {["SEDEX", "PAC", "Jadlog"].map((method) => {
                          const isSelected =
                            formData.enabledShippingMethods.some(
                              (m) => m.toLowerCase() === method.toLowerCase(),
                            );
                          return (
                            <button
                              key={method}
                              type="button"
                              onClick={() => {
                                let newMethods;
                                if (isSelected) {
                                  newMethods =
                                    formData.enabledShippingMethods.filter(
                                      (m) =>
                                        m.toLowerCase() !==
                                        method.toLowerCase(),
                                    );
                                } else {
                                  newMethods = [
                                    ...formData.enabledShippingMethods,
                                    method.toLowerCase(),
                                  ];
                                }
                                setFormData((prev) => ({
                                  ...prev,
                                  enabledShippingMethods: newMethods,
                                }));
                              }}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-all ${
                                isSelected
                                  ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                                  : "border-white/10 bg-zinc-900 text-zinc-500 hover:text-white"
                              }`}
                            >
                              {method}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Section 4: Logs & Histórico de Cotações */}
            <div
              id="shipping-logs-section"
              className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 backdrop-blur-md shadow-xl"
            >
              <button
                type="button"
                onClick={() => setIsLogsOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-xs font-extrabold uppercase tracking-wider text-zinc-300 hover:text-white"
              >
                <div className="flex items-center gap-2">
                  <Boxes className="size-4 text-amber-400" />
                  <span>Histórico de Cotações & Audit Logs</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 font-normal">
                    {isLogsOpen ? "Ocultar" : "Expandir"}
                  </span>
                  <ChevronDown
                    className={`size-4 text-zinc-400 transition-transform ${
                      isLogsOpen ? "rotate-180 text-amber-400" : ""
                    }`}
                  />
                </div>
              </button>

              {isLogsOpen && (
                <div className="mt-3.5 space-y-3 pt-3 border-t border-white/5 animate-in fade-in duration-200">
                  {loadingLogs ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                      <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                    </div>
                  ) : logsError ? (
                    // Consulta que falhou não pode se parecer com "vazio de
                    // verdade" — quem for diagnosticar por que um cliente
                    // não conseguiu cotar precisa saber que o histórico não
                    // carregou, não achar que ele está genuinamente limpo.
                    <div className="py-4 text-center text-xs font-semibold text-red-400">
                      Não foi possível carregar o histórico de cotações. Tente
                      novamente em "Atualizar".
                    </div>
                  ) : logs.length === 0 &&
                    (config?.shippingProvider || "flat_fee") === "flat_fee" ? (
                    // Com Taxa Única Fixa a edge function responde o frete
                    // na hora, sem consultar transportadora — por isso este
                    // histórico fica em zero por desenho, não porque
                    // ninguém tentou calcular frete. Ele volta a receber
                    // linhas se a loja trocar para Melhor Envio ou Frenet.
                    <p className="py-4 text-center text-xs text-zinc-400">
                      Nenhuma cotação para mostrar: com a Taxa Única Fixa o app
                      já responde o frete direto, sem consultar transportadora,
                      então não existe cotação para registrar aqui. Este
                      histórico passa a receber linhas se a loja trocar para
                      Melhor Envio ou Frenet.
                    </p>
                  ) : logs.length === 0 ? (
                    <p className="py-4 text-center text-xs italic text-zinc-500">
                      Nenhuma cotação registrada recentemente.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/50">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            <th className="p-2.5">Data/Hora</th>
                            <th className="p-2.5">Destino</th>
                            <th className="p-2.5">Provedor</th>
                            <th className="p-2.5">Tempo</th>
                            <th className="p-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-zinc-300">
                          {logs.map((log) => (
                            <tr key={log.id} className="hover:bg-white/5">
                              <td className="p-2.5 font-mono text-[11px] text-zinc-400">
                                {new Date(log.created_at).toLocaleTimeString(
                                  "pt-BR",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </td>
                              <td className="p-2.5 font-semibold text-white">
                                {log.destination_cep.replace(
                                  /(\d{5})(\d{3})/,
                                  "$1-$2",
                                )}
                              </td>
                              <td className="p-2.5 capitalize text-zinc-300">
                                {log.provider.replace("_", " ")}
                              </td>
                              <td className="p-2.5 font-mono text-zinc-400">
                                {log.response_time_ms
                                  ? `${log.response_time_ms}ms`
                                  : "—"}
                              </td>
                              <td className="p-2.5">
                                <span
                                  className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                    log.status === "success"
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : log.status === "contingency"
                                        ? "bg-amber-500/20 text-amber-300"
                                        : "bg-red-500/20 text-red-300"
                                  }`}
                                >
                                  {log.status === "success"
                                    ? "Sucesso"
                                    : log.status === "contingency"
                                      ? "Contingência"
                                      : "Erro"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1">
                    {logs.length > 0 && (
                      // "Exibindo as 15" com 0 linha era a mesma mentira do
                      // resto da seção: prometia exibir 15 de coisa nenhuma.
                      // Agora reflete a contagem real, e some quando não há
                      // linha nenhuma para exibir.
                      <span>
                        Exibindo {logs.length === 1 ? "a" : "as"} {logs.length}{" "}
                        {logs.length === 1 ? "consulta" : "consultas"} mais
                        recente{logs.length === 1 ? "" : "s"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={fetchLogs}
                      disabled={loadingLogs}
                      // `ml-auto` porque o texto ao lado agora some quando
                      // não há linha: sem ele, o `justify-between` fica com
                      // um filho só e o botão pula para a esquerda.
                      className="ml-auto flex items-center gap-1 font-bold text-amber-400 hover:underline"
                    >
                      <RefreshCw
                        className={`size-3 ${loadingLogs ? "animate-spin" : ""}`}
                      />
                      <span>Atualizar</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
