import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import {
  AlertTriangle,
  Bell,
  Boxes,
  ChevronDown,
  Clock,
  Headset,
  HelpCircle,
  Info,
  Lock,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Share2,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/utils/haptic";
import { toast } from "sonner";

import type { StoreConfig, View } from "@/types";

interface AdminSettingsViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

// ==========================================
// Logistics Section (Memoized)
// ==========================================
const formatCEP = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5, 8)}`;
};

const LogisticsSection = memo(function LogisticsSection({
  freeShippingMin,
  shippingFee,
  isOffline,
  onChangeFreeShippingMin,
  onChangeShippingFee,
  originCep,
  shippingProvider,
  enabledShippingMethods,
  shippingCreds,
  onChangeOriginCep,
  onChangeShippingProvider,
  onChangeEnabledShippingMethods,
  onChangeShippingCreds,
}: {
  freeShippingMin: number;
  shippingFee: number;
  isOffline: boolean;
  onChangeFreeShippingMin: (val: number) => void;
  onChangeShippingFee: (val: number) => void;
  originCep?: string;
  shippingProvider?: "flat_fee" | "melhor_envio" | "frenet";
  enabledShippingMethods?: string[];
  shippingCreds: { [key: string]: any };
  onChangeOriginCep: (val: string) => void;
  onChangeShippingProvider: (
    val: "flat_fee" | "melhor_envio" | "frenet",
  ) => void;
  onChangeEnabledShippingMethods: (val: string[]) => void;
  onChangeShippingCreds: (provider: string, creds: any) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localFreeShippingMin, setLocalFreeShippingMin] =
    useState(freeShippingMin);
  const [localShippingFee, setLocalShippingFee] = useState(shippingFee);
  const [localOriginCep, setLocalOriginCep] = useState(
    originCep || "38500-000",
  );
  const [localShippingProvider, setLocalShippingProvider] = useState(
    shippingProvider || "flat_fee",
  );
  const [localEnabledMethods, setLocalEnabledMethods] = useState<string[]>(
    enabledShippingMethods || ["sedex", "pac"],
  );
  const [isTestingCreds, setIsTestingCreds] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const freeShippingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const shippingFeeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastPropsRef = useRef({ freeShippingMin, shippingFee });

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
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
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  const handleTestCredentials = useCallback(async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }

    const creds = shippingCreds[localShippingProvider];
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
            provider: localShippingProvider,
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
        message: err.message || "Erro de comunicação com a Edge Function.",
      });
      toast.error("Erro ao testar credenciais");
    } finally {
      setIsTestingCreds(false);
    }
  }, [isOffline, localShippingProvider, shippingCreds]);

  const updateFreeShippingMin = useCallback(
    (val: number) => {
      setLocalFreeShippingMin(val);
      lastPropsRef.current.freeShippingMin = val;

      if (freeShippingTimerRef.current) {
        clearTimeout(freeShippingTimerRef.current);
      }
      freeShippingTimerRef.current = setTimeout(() => {
        onChangeFreeShippingMin(val);
      }, 300);
    },
    [onChangeFreeShippingMin],
  );

  const updateShippingFee = useCallback(
    (val: number) => {
      setLocalShippingFee(val);
      lastPropsRef.current.shippingFee = val;

      if (shippingFeeTimerRef.current) {
        clearTimeout(shippingFeeTimerRef.current);
      }
      shippingFeeTimerRef.current = setTimeout(() => {
        onChangeShippingFee(val);
      }, 300);
    },
    [onChangeShippingFee],
  );

  // Sync local state when external props change (e.g. from database sync)
  useEffect(() => {
    if (lastPropsRef.current.freeShippingMin !== freeShippingMin) {
      setLocalFreeShippingMin(freeShippingMin);
      lastPropsRef.current.freeShippingMin = freeShippingMin;
    }
  }, [freeShippingMin]);

  useEffect(() => {
    if (lastPropsRef.current.shippingFee !== shippingFee) {
      setLocalShippingFee(shippingFee);
      lastPropsRef.current.shippingFee = shippingFee;
    }
  }, [shippingFee]);

  useEffect(() => {
    setLocalOriginCep(originCep || "38500-000");
  }, [originCep]);

  useEffect(() => {
    setLocalShippingProvider(shippingProvider || "flat_fee");
  }, [shippingProvider]);

  useEffect(() => {
    setLocalEnabledMethods(enabledShippingMethods || ["sedex", "pac"]);
  }, [enabledShippingMethods]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (freeShippingTimerRef.current)
        clearTimeout(freeShippingTimerRef.current);
      if (shippingFeeTimerRef.current)
        clearTimeout(shippingFeeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isLogsOpen) {
      fetchLogs();
    }
  }, [isLogsOpen, fetchLogs]);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex w-full select-none items-center justify-between rounded-2xl p-2 text-left transition-all hover:bg-white/5"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.1)] transition-all group-hover:scale-105">
            <Truck className="size-5 text-emerald-500" strokeWidth={2.5} />
          </div>
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
            Logística & Entregas
          </h2>
        </div>
        <ChevronDown
          className={`size-5 text-zinc-500 transition-all duration-300 group-hover:text-white ${
            isOpen ? "rotate-180 text-admin-gold" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-2">
            <div className="admin-glass group relative overflow-hidden border-y border-white/5 p-4 shadow-2xl sm:rounded-[2.5rem] sm:border-x sm:p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div
                  className={`flex flex-col gap-2.5 rounded-xl border p-3.5 transition-all duration-300 ${
                    localFreeShippingMin > 0
                      ? "border-emerald-500/20 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.04)]"
                      : "border-white/5 bg-white/5 hover:border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex size-8 items-center justify-center rounded-lg border transition-all duration-300 ${
                          localFreeShippingMin > 0
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                            : "border-white/5 bg-zinc-950/80 text-zinc-500"
                        }`}
                      >
                        <Truck
                          className="size-4 text-emerald-500"
                          strokeWidth={2.5}
                        />
                      </div>
                      <div className="text-left">
                        <span className="block text-[9px] font-black uppercase tracking-wider text-white">
                          Frete Grátis
                        </span>
                        <span className="mt-0.5 block text-[7.5px] font-bold uppercase leading-none tracking-widest text-zinc-400">
                          Valor Mínimo
                        </span>
                      </div>
                    </div>
                    <Switch
                      checked={localFreeShippingMin > 0}
                      onCheckedChange={(checked) => {
                        updateFreeShippingMin(checked ? 100 : 0);
                      }}
                      className="data-[state=checked]:bg-emerald-500"
                      disabled={isOffline}
                    />
                  </div>

                  <div
                    className={`space-y-2.5 transition-all duration-300 ${
                      localFreeShippingMin > 0
                        ? "opacity-100"
                        : "pointer-events-none opacity-40"
                    }`}
                  >
                    <p className="text-left text-[9.5px] leading-snug text-zinc-400">
                      Ativa a barra de progresso no carrinho. Pedidos acima
                      deste valor terão a taxa de entrega anulada.
                    </p>

                    <div className="flex h-9 items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 p-1">
                      <button
                        type="button"
                        disabled={localFreeShippingMin <= 0 || isOffline}
                        onClick={() => {
                          updateFreeShippingMin(
                            Math.max(0, localFreeShippingMin - 10),
                          );
                        }}
                        className="flex size-7 shrink-0 select-none items-center justify-center rounded-lg border border-white/5 bg-zinc-900 text-sm font-bold text-white transition-all hover:border-white/10 hover:bg-zinc-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Minus className="size-3 text-zinc-400" />
                      </button>

                      <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
                        <span className="text-xs font-black text-admin-gold text-zinc-500">
                          R$
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={
                            localFreeShippingMin === 0
                              ? ""
                              : localFreeShippingMin
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            updateFreeShippingMin(val === "" ? 0 : Number(val));
                          }}
                          className="w-16 border-0 bg-transparent p-0 text-center text-base font-black text-white [appearance:textfield] focus:border-0 focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          autoComplete="off"
                          disabled={isOffline}
                        />
                      </div>

                      <button
                        type="button"
                        disabled={localFreeShippingMin === 0 || isOffline}
                        onClick={() => {
                          updateFreeShippingMin(localFreeShippingMin + 10);
                        }}
                        className="flex size-7 shrink-0 select-none items-center justify-center rounded-lg border border-white/5 bg-zinc-900 text-sm font-bold text-white transition-all hover:border-white/10 hover:bg-zinc-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Plus className="size-3 text-zinc-400" />
                      </button>
                    </div>

                    <div className="flex flex-wrap justify-start gap-1">
                      {[50, 100, 150, 200, 250].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={localFreeShippingMin === 0 || isOffline}
                          onClick={() => updateFreeShippingMin(preset)}
                          className={`rounded-lg border select-none px-2 py-1 text-[8px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            localFreeShippingMin === preset
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.1)]"
                              : "border-white/5 bg-zinc-900/60 text-zinc-400 hover:border-white/10 hover:text-white"
                          }`}
                        >
                          R$ {preset}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1 border-t border-white/5 pt-2">
                      <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest text-zinc-500">
                        <span>Simulação no PWA</span>
                        <span className="font-bold text-emerald-500">
                          R$ {localFreeShippingMin}
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full border border-white/5 bg-zinc-950">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_8px_rgba(16,185,129,0.3)] transition-all duration-500"
                          style={{
                            width: localFreeShippingMin > 0 ? "70%" : "0%",
                          }}
                        />
                      </div>
                      <p className="text-left text-[9px] italic leading-normal text-zinc-500">
                        {localFreeShippingMin > 0
                          ? `Exemplo: Se a compra for de R$ ${(localFreeShippingMin * 0.7).toFixed(0)}, faltará R$ ${(localFreeShippingMin * 0.3).toFixed(0)} para frete grátis.`
                          : "Frete grátis desativado por padrão."}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className={`flex flex-col gap-2.5 rounded-xl border p-3.5 transition-all duration-300 ${
                    localShippingFee > 0
                      ? "border-admin-gold/20 bg-admin-gold/5 shadow-[0_0_20px_rgba(212,175,55,0.04)]"
                      : "border-white/5 bg-white/5 hover:border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex size-8 items-center justify-center rounded-lg border transition-all duration-300 ${
                          localShippingFee > 0
                            ? "border-admin-gold/30 bg-admin-gold/10 text-admin-gold shadow-[0_0_10px_rgba(212,175,55,0.15)]"
                            : "border-white/5 bg-zinc-950/80 text-zinc-500"
                        }`}
                      >
                        <Settings className="size-4 text-admin-gold" />
                      </div>
                      <div className="text-left">
                        <span className="block text-[9px] font-black uppercase tracking-wider text-white">
                          Taxa de Entrega
                        </span>
                        <span className="mt-0.5 block text-[7.5px] font-bold uppercase leading-none tracking-widest text-zinc-400">
                          Cobrança Padrão
                        </span>
                      </div>
                    </div>
                    <Switch
                      checked={localShippingFee > 0}
                      onCheckedChange={(checked) => {
                        updateShippingFee(checked ? 15 : 0);
                      }}
                      className="data-[state=checked]:bg-admin-gold"
                      disabled={isOffline}
                    />
                  </div>

                  <div
                    className={`space-y-2.5 transition-all duration-300 ${
                      localShippingFee > 0
                        ? "opacity-100"
                        : "pointer-events-none opacity-40"
                    }`}
                  >
                    <p className="text-left text-[9.5px] leading-snug text-zinc-400">
                      Insira o valor fixo cobrado por padrão para entregas caso
                      o pedido não atinja a regra de frete grátis.
                    </p>

                    <div className="flex h-9 items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 p-1">
                      <button
                        type="button"
                        disabled={localShippingFee <= 0 || isOffline}
                        onClick={() => {
                          updateShippingFee(Math.max(0, localShippingFee - 1));
                        }}
                        className="flex size-7 shrink-0 select-none items-center justify-center rounded-lg border border-white/5 bg-zinc-900 text-sm font-bold text-white transition-all hover:border-white/10 hover:bg-zinc-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Minus className="size-3 text-zinc-400" />
                      </button>

                      <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
                        <span className="text-xs font-black text-admin-gold text-zinc-500">
                          R$
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={localShippingFee === 0 ? "" : localShippingFee}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateShippingFee(val === "" ? 0 : Number(val));
                          }}
                          className="w-16 border-0 bg-transparent p-0 text-center text-base font-black text-white [appearance:textfield] focus:border-0 focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          autoComplete="off"
                          disabled={isOffline}
                        />
                      </div>

                      <button
                        type="button"
                        disabled={localShippingFee === 0 || isOffline}
                        onClick={() => {
                          updateShippingFee(localShippingFee + 1);
                        }}
                        className="flex size-7 shrink-0 select-none items-center justify-center rounded-lg border border-white/5 bg-zinc-900 text-sm font-bold text-white transition-all hover:border-white/10 hover:bg-zinc-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Plus className="size-3 text-zinc-400" />
                      </button>
                    </div>

                    <div className="flex flex-wrap justify-start gap-1">
                      {[5, 10, 12, 15, 20].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={localShippingFee === 0 || isOffline}
                          onClick={() => updateShippingFee(preset)}
                          className={`rounded-lg border select-none px-2 py-1 text-[8px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            localShippingFee === preset
                              ? "border-admin-gold/40 bg-admin-gold/10 text-admin-gold shadow-[0_0_8px_rgba(212,175,55,0.1)]"
                              : "border-white/5 bg-zinc-900/60 text-zinc-400 hover:border-white/10 hover:text-white"
                          }`}
                        >
                          R$ {preset}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-0.5 border-t border-white/5 pt-2">
                      <div className="flex items-center gap-1.5 text-[8.5px] font-black uppercase tracking-widest text-zinc-500">
                        <Info className="size-3 text-admin-gold" />
                        <span>Resumo da Regra</span>
                      </div>
                      <p className="text-left text-[9.5px] leading-normal text-zinc-400">
                        Se o cliente comprar menos que{" "}
                        <span className="font-bold text-white">
                          R$ {localFreeShippingMin}
                        </span>
                        , o valor da entrega será{" "}
                        <span className="font-bold text-admin-gold">
                          R$ {localShippingFee}
                        </span>
                        .
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Provedor de cálculo e CEP de origem */}
              <div className="mt-4 space-y-4 border-t border-white/5 pt-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* CEP de Origem */}
                  <div className="flex flex-col gap-1">
                    <label htmlFor="origin-cep" className="text-left text-[9px] font-black uppercase tracking-wider text-white">
                      CEP de Origem (Lojista)
                    </label>
                    <input
                      id="origin-cep"
                      type="text"
                      maxLength={9}
                      value={localOriginCep}
                      onChange={(e) => {
                        const val = formatCEP(e.target.value);
                        setLocalOriginCep(val);
                        onChangeOriginCep(val);
                      }}
                      placeholder="00000-000"
                      className="animate-fade-in h-9 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-all focus:border-admin-gold focus:outline-none"
                    />
                    <p className="text-left text-[8px] text-zinc-500">
                      CEP de onde os seus produtos serão despachados para
                      cálculo da cotação.
                    </p>
                  </div>

                  {/* Tipo de Frete / Provedor */}
                  <div className="flex flex-col gap-1">
                    <label htmlFor="shipping-provider" className="text-left text-[9px] font-black uppercase tracking-wider text-white">
                      Tipo de Cálculo de Frete
                    </label>
                    <select
                      id="shipping-provider"
                      value={localShippingProvider}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        setLocalShippingProvider(val);
                        onChangeShippingProvider(val);
                      }}
                      className="h-9 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-all focus:border-admin-gold focus:outline-none"
                    >
                      <option value="flat_fee">Taxa Única Fixa (Padrão)</option>
                      <option value="melhor_envio">Melhor Envio (API)</option>
                      <option value="frenet">Frenet (API)</option>
                    </select>
                    <p className="text-left text-[8px] text-zinc-500">
                      Selecione se deseja cobrar taxa fixa ou integrar com
                      serviços de cálculo automático de frete.
                    </p>
                  </div>
                </div>

                {/* Conditional settings for Melhor Envio / Frenet */}
                {localShippingProvider !== "flat_fee" && (
                  <div className="animate-fade-in space-y-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7.5 items-center justify-center rounded-lg border border-admin-gold/30 bg-admin-gold/10 text-admin-gold">
                        <Lock className="size-3.5 text-admin-gold" />
                      </div>
                      <div className="text-left">
                        <span className="block text-[9px] font-black uppercase tracking-wider text-white">
                          Credenciais do Provedor:{" "}
                          {localShippingProvider === "melhor_envio"
                            ? "Melhor Envio"
                            : "Frenet"}
                        </span>
                        <span className="mt-0.5 block text-[7.5px] font-bold uppercase leading-none tracking-widest text-zinc-500">
                          Salvas de forma segura no servidor
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="shipping-token" className="text-left text-[9px] font-black uppercase tracking-wider text-zinc-400">
                          Token de Acesso (API Token)
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="shipping-token"
                            type="password"
                            value={
                              shippingCreds[localShippingProvider]?.token || ""
                            }
                            onChange={(e) => {
                              const current =
                                shippingCreds[localShippingProvider] || {};
                              onChangeShippingCreds(localShippingProvider, {
                                ...current,
                                token: e.target.value,
                              });
                            }}
                            placeholder={
                              localShippingProvider === "melhor_envio"
                                ? "Insira o token do Melhor Envio"
                                : "Insira o token da Frenet"
                            }
                            className="flex-1 h-9 rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 font-mono text-xs font-medium text-white transition-all focus:border-admin-gold focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={
                              isTestingCreds ||
                              !shippingCreds[localShippingProvider]?.token
                            }
                            onClick={handleTestCredentials}
                            className="flex shrink-0 select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-zinc-300 transition-all hover:border-admin-gold/40 hover:text-white active:scale-95 disabled:opacity-40"
                          >
                            {isTestingCreds ? (
                              <>
                                <RefreshCw className="size-3 animate-spin text-admin-gold" />
                                <span>Testando...</span>
                              </>
                            ) : (
                              <>
                                <RefreshCw className="size-3 text-admin-gold" />
                                <span>Testar</span>
                              </>
                            )}
                          </button>
                        </div>

                        {testResult && (
                          <div
                            className={`animate-fade-in mt-1.5 flex items-start gap-1.5 rounded-lg border p-2.5 text-left text-[9px] leading-normal ${
                              testResult.success
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                : "border-red-500/20 bg-red-500/10 text-red-400"
                            }`}
                          >
                            <Info className="mt-0.5 size-3.5 shrink-0" />
                            <div>
                              <span className="mb-0.5 block font-bold uppercase tracking-wider">
                                {testResult.success
                                  ? "Conexão Estabelecida"
                                  : "Erro de Autenticação"}
                              </span>
                              <span>{testResult.message}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {localShippingProvider === "melhor_envio" && (
                        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/30 p-2.5">
                          <div className="text-left">
                            <span className="block text-[9px] font-black uppercase tracking-wider text-white">
                              Ambiente de Testes (Sandbox)
                            </span>
                            <span className="mt-0.5 block text-[8px] text-zinc-400">
                              Habilite para testar a integração usando a URL de
                              sandbox do Melhor Envio.
                            </span>
                          </div>
                          <Switch
                            checked={
                              shippingCreds.melhor_envio?.sandbox === true
                            }
                            onCheckedChange={(checked) => {
                              const current = shippingCreds.melhor_envio || {};
                              onChangeShippingCreds("melhor_envio", {
                                ...current,
                                sandbox: checked,
                              });
                            }}
                            className="data-[state=checked]:bg-admin-gold scale-90"
                          />
                        </div>
                      )}

                      {/* Métodos de frete habilitados */}
                      <div className="flex flex-col gap-1 pt-1">
                        <span className="text-left text-[9px] font-black uppercase tracking-wider text-zinc-400">
                          Métodos de Envio Ativos
                        </span>
                        <div className="flex flex-wrap justify-start gap-1.5">
                          {["SEDEX", "PAC", "Jadlog"].map((method) => {
                            const isSelected = localEnabledMethods.some(
                              (m) => m.toLowerCase() === method.toLowerCase(),
                            );
                            return (
                              <button
                                key={method}
                                type="button"
                                onClick={() => {
                                  let newMethods;
                                  if (isSelected) {
                                    newMethods = localEnabledMethods.filter(
                                      (m) =>
                                        m.toLowerCase() !==
                                        method.toLowerCase(),
                                    );
                                  } else {
                                    newMethods = [
                                      ...localEnabledMethods,
                                      method.toLowerCase(),
                                    ];
                                  }
                                  setLocalEnabledMethods(newMethods);
                                  onChangeEnabledShippingMethods(newMethods);
                                }}
                                className={`rounded-lg border select-none px-2 py-1 text-[8px] font-bold uppercase tracking-wider transition-all duration-200 ${
                                  isSelected
                                    ? "border-admin-gold/40 bg-admin-gold/10 text-admin-gold shadow-[0_0_8px_rgba(212,175,55,0.1)]"
                                    : "border-white/5 bg-zinc-950/60 text-zinc-400 hover:border-white/10 hover:text-white"
                                }`}
                              >
                                {method}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-0.5 text-left text-[8px] text-zinc-500">
                          Selecione quais serviços serão calculados e oferecidos
                          ao cliente na hora do checkout.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Collapsible Logistics Logs Section */}
                <div className="mt-3 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsLogsOpen((prev) => !prev)}
                    className="flex w-full select-none items-center justify-between py-1.5 text-left text-[9px] font-black uppercase tracking-wider text-zinc-400 transition-colors hover:text-white"
                  >
                    <div className="flex items-center gap-1.5">
                      <Boxes className="size-3 text-admin-gold" />
                      <span>Logs & Histórico de Cotações</span>
                    </div>
                    <ChevronDown
                      className={`size-3.5 text-zinc-500 transition-transform ${isLogsOpen ? "rotate-180 text-admin-gold" : ""}`}
                    />
                  </button>

                  {isLogsOpen && (
                    <div className="animate-fade-in mt-2 space-y-2">
                      {loadingLogs ? (
                        <div className="space-y-1.5">
                          <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                          <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                          <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                        </div>
                      ) : logs.length === 0 ? (
                        <p className="py-3 text-center text-[9px] italic text-zinc-600">
                          Nenhuma cotação registrada recentemente.
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-950/40">
                          <table className="w-full min-w-[500px] border-collapse text-left">
                            <thead>
                              <tr className="border-b border-white/5 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                                <th className="p-2.5">Data</th>
                                <th className="p-2.5">Destino</th>
                                <th className="p-2.5">Provedor</th>
                                <th className="p-2.5">Tempo (RTT)</th>
                                <th className="p-2.5">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-[9px]">
                              {logs.map((log) => {
                                const dateStr = `${new Date(
                                  log.created_at,
                                ).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })} ${new Date(
                                  log.created_at,
                                ).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                })}`;
                                return (
                                  <tr
                                    key={log.id}
                                    className="transition-colors hover:bg-white/[0.02]"
                                  >
                                    <td className="p-2.5 font-mono text-zinc-400">
                                      {dateStr}
                                    </td>
                                    <td className="p-2.5 font-semibold text-white">
                                      {log.destination_cep.replace(
                                        /(\d{5})(\d{3})/,
                                        "$1-$2",
                                      )}
                                    </td>
                                    <td className="p-2.5 font-medium capitalize text-zinc-300">
                                      {log.provider.replace("_", " ")}
                                    </td>
                                    <td className="p-2.5 font-mono text-zinc-400">
                                      {log.response_time_ms > 0
                                        ? `${log.response_time_ms}ms`
                                        : "—"}
                                    </td>
                                    <td className="p-2.5">
                                      <span
                                        className={`inline-flex rounded-full px-1.5 py-0.5 text-[7.5px] font-black uppercase tracking-wider ${
                                          log.status === "success"
                                            ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                            : log.status === "contingency"
                                              ? "border border-amber-500/20 bg-amber-500/10 text-amber-400"
                                              : "border border-red-500/20 bg-red-500/10 text-red-400"
                                        }`}
                                      >
                                        {log.status === "success"
                                          ? "Sucesso"
                                          : log.status === "contingency"
                                            ? "Contingência"
                                            : "Erro"}
                                      </span>
                                      {log.error_message && (
                                        <span className="mt-0.5 block max-w-[200px] break-words text-[8px] font-medium leading-normal text-red-400/80">
                                          {log.error_message}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="flex items-center justify-between px-1">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                          Exibindo as últimas 15 consultas
                        </span>
                        <button
                          type="button"
                          onClick={fetchLogs}
                          disabled={loadingLogs}
                          className="flex select-none items-center gap-1 text-[8px] font-black uppercase tracking-widest text-admin-gold transition-colors hover:text-white disabled:opacity-40"
                        >
                          <RefreshCw
                            className={`size-2 ${loadingLogs ? "animate-spin" : ""}`}
                          />
                          <span>Atualizar Logs</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="absolute -bottom-10 -right-10 size-32 rounded-full bg-emerald-500/5 blur-[80px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ==========================================
// Support Section (Memoized)
// ==========================================
const SupportSection = memo(function SupportSection({
  whatsappNumber,
  businessHours,
  shareText,
  isOffline,
  onChangeWhatsappNumber,
  onChangeBusinessHours,
  onChangeShareText,
}: {
  whatsappNumber: string;
  businessHours: string;
  shareText: string;
  isOffline: boolean;
  onChangeWhatsappNumber: (val: string) => void;
  onChangeBusinessHours: (val: string) => void;
  onChangeShareText: (val: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex w-full select-none items-center justify-between rounded-2xl p-2 text-left transition-all hover:bg-white/5"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-10 items-center justify-center rounded-xl border border-admin-gold/20 bg-admin-gold/10 shadow-[0_0_15px_rgba(212,175,55,0.1)] transition-all group-hover:scale-105">
            <Headset className="size-5 text-admin-gold" strokeWidth={2.5} />
          </div>
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
            Canais de Atendimento
          </h2>
        </div>
        <ChevronDown
          className={`size-5 text-zinc-500 transition-all duration-300 group-hover:text-white ${
            isOpen ? "rotate-180 text-admin-gold" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-2">
            <div className="admin-glass relative space-y-4 overflow-hidden border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex-grow space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                      WhatsApp da Operação
                    </Label>
                    <span className="rounded-full border border-[#25d366]/20 bg-[#25d366]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#25d366]">
                      Atendimento & Vendas
                    </span>
                  </div>
                  <p className="ml-1 text-[9.5px] leading-snug text-zinc-500">
                    Número que receberá contatos diretos de clientes.
                  </p>
                  <div className="group relative">
                    <div className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 border-r border-white/10 pr-2.5">
                      <MessageCircle className="size-3.5 text-[#25d366]" />
                      <span className="text-[11px] font-black text-zinc-500">
                        +55
                      </span>
                    </div>
                    <LocalBufferedInput
                      useShadcn
                      mask="phone"
                      delay={350}
                      value={whatsappNumber}
                      onFlush={onChangeWhatsappNumber}
                      placeholder="Ex: (34) 99999-9999"
                      className="h-10 rounded-xl border-white/10 bg-black/40 pl-16 text-xs font-bold text-white transition-all placeholder:text-zinc-700 focus:bg-black/60 focus:ring-admin-gold/50"
                      autoComplete="tel"
                      disabled={isOffline}
                      validate={(val) => {
                        if (!val) return "WhatsApp é obrigatório";
                        const clean = val.replace(/\D/g, "");
                        if (clean.length < 10 || clean.length > 11) {
                          return "Informe DDD + número (10 ou 11 dígitos)";
                        }
                        return null;
                      }}
                    />
                  </div>
                  <div className="space-y-1 rounded-lg border border-white/5 bg-zinc-950/40 p-2.5">
                    <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                      <Info className="size-3 text-admin-gold" />
                      <span>Formato e Protocolo</span>
                    </div>
                    <p className="text-[9px] leading-relaxed text-zinc-400">
                      Informe DDD + número (ex:{" "}
                      <code className="font-mono font-bold text-admin-gold">
                        34999999999
                      </code>
                      ). O código{" "}
                      <code className="font-mono text-zinc-300">55</code> é
                      adicionado automaticamente.
                    </p>
                  </div>
                </div>

                <div className="flex-grow space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                      Horário de Funcionamento
                    </Label>
                    <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-blue-400">
                      Expediente
                    </span>
                  </div>
                  <p className="ml-1 text-[9.5px] leading-snug text-zinc-500">
                    Informa aos clientes no PWA o expediente de suporte.
                  </p>
                  <div className="group relative">
                    <div className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 items-center border-r border-white/10 pr-2.5">
                      <Clock className="size-3.5 text-admin-gold" />
                    </div>
                    <LocalBufferedInput
                      useShadcn
                      delay={350}
                      value={businessHours}
                      onFlush={onChangeBusinessHours}
                      placeholder="Ex: Seg-Sáb: 9h às 18h"
                      className="h-10 rounded-xl border-white/10 bg-black/40 pl-11 text-xs font-bold text-white transition-all placeholder:text-zinc-700 focus:bg-black/60 focus:ring-admin-gold/50"
                      autoComplete="off"
                      disabled={isOffline}
                    />
                  </div>
                  <div className="space-y-1 rounded-lg border border-white/5 bg-zinc-950/40 p-2.5">
                    <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                      <Clock className="size-3 text-zinc-500" />
                      <span>Exemplos recomendados</span>
                    </div>
                    <p className="text-[9px] leading-relaxed text-zinc-400">
                      •{" "}
                      <code className="font-mono text-zinc-300">
                        Seg-Sáb: 9h às 18h
                      </code>
                      <br />•{" "}
                      <code className="font-mono text-zinc-300">
                        Seg a Sex: 8h às 18h | Sáb: 8h às 12h
                      </code>
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 border-t border-white/5 pt-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                      Mensagem de Compartilhamento de Produtos
                    </Label>
                    <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-purple-400">
                      Divulgação
                    </span>
                  </div>
                  <p className="ml-1 text-[9.5px] leading-snug text-zinc-500">
                    Texto anexado quando um usuário compartilha um produto. O nome do produto, o preço e o link serão adicionados abaixo.
                  </p>
                </div>

                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3.5 top-3">
                        <Share2 className="size-3.5 text-zinc-500" />
                      </div>
                      <LocalBufferedTextarea
                        useShadcn
                        delay={350}
                        value={shareText}
                        onFlush={onChangeShareText}
                        placeholder="Ex: Confira este produto incrível que encontrei!"
                        className="min-h-[80px] resize-none rounded-xl border-white/10 bg-black/40 p-3 pl-10 text-xs font-medium leading-relaxed text-white transition-all placeholder:text-zinc-700 focus:bg-black/60 focus:ring-admin-gold/50"
                        disabled={isOffline}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="ml-1 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      Visualização da Mensagem no WhatsApp
                    </span>
                    <div className="relative flex min-h-[90px] flex-col justify-end overflow-hidden rounded-xl border border-emerald-500/10 bg-[#0b141a] p-2.5 shadow-inner">
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#25d366_1.5px,transparent_1.5px)] opacity-[0.03] [background-size:16px_16px]" />

                      <div className="relative z-10 max-w-[85%] space-y-1 self-end rounded-xl rounded-tr-none border border-white/10 bg-[#0b141a] p-2 text-white shadow-lg">
                        <p className="break-words text-[11px] font-semibold text-emerald-400">
                          {shareText || "Confira os produtos da Ikous!"}
                        </p>

                        <div className="space-y-1 rounded-lg border border-white/5 bg-black/40 p-1.5 text-[9px]">
                          <div className="flex gap-1.5">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded border border-white/5 bg-zinc-800 text-[8px] font-black text-admin-gold">
                              IMG
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[9px] font-bold text-zinc-200">
                                Fone de Ouvido Bluetooth
                              </p>
                              <p className="mt-0.5 text-[8px] text-zinc-400">
                                R$ 189,90
                              </p>
                            </div>
                          </div>
                          <p className="truncate border-t border-white/5 pt-0.5 text-[8px] font-medium text-[#00a884]">
                            ikcous.com/produto/fone-de-ouvido-bluetooth
                          </p>
                        </div>

                        <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[7px] text-zinc-500">
                          <span>12:00</span>
                          <span className="flex text-[#53bdeb]">✓✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ==========================================
// Modules Section (Memoized)
// ==========================================
const ModulesSection = memo(function ModulesSection({
  enableReviews,
  enableCoupons,
  isOffline,
  onChangeEnableReviews,
  onChangeEnableCoupons,
}: {
  enableReviews: boolean;
  enableCoupons: boolean;
  isOffline: boolean;
  onChangeEnableReviews: (val: boolean) => void;
  onChangeEnableCoupons: (val: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex w-full select-none items-center justify-between rounded-2xl p-2 text-left transition-all hover:bg-white/5"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.1)] transition-all group-hover:scale-105">
            <Boxes className="size-5 text-blue-400" strokeWidth={2.5} />
          </div>
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
            Módulos de Sistema
          </h2>
        </div>
        <ChevronDown
          className={`size-5 text-zinc-500 transition-all duration-300 group-hover:text-white ${
            isOpen ? "rotate-180 text-admin-gold" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-2">
            <div className="admin-glass space-y-2.5 border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4">
              <div
                className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all duration-300 ${
                  enableReviews
                    ? "border-blue-500/20 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.05)]"
                    : "border-white/5 bg-white/5 hover:border-white/10"
                }`}
              >
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                    enableReviews
                      ? "border-blue-500/30 bg-blue-500/10 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]"
                      : "border-white/5 bg-zinc-950/80 text-zinc-500"
                  }`}
                >
                  <MessageSquare className="size-4.5" />
                </div>
                <div className="flex-1 space-y-1 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-white">
                      Avaliações de Usuário
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0 text-[7.5px] font-black uppercase tracking-wider ${
                        enableReviews
                          ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                          : "border-white/5 bg-zinc-900 text-zinc-500"
                      }`}
                    >
                      Prova Social
                    </span>
                  </div>
                  <p className="text-[8.5px] font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
                    Permitir feedback social em produtos
                  </p>
                  <p className="text-[9.5px] leading-snug text-zinc-500">
                    Habilita comentários e notas com estrelas nas páginas de
                    produtos. Clientes podem compartilhar fotos e experiências
                    reais.
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span
                      className={`size-1 rounded-full ${enableReviews ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`}
                    />
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                      {enableReviews
                        ? "Habilitado e ativo no app"
                        : "Desativado"}
                    </span>
                  </div>
                </div>
                <div className="self-center pl-1.5">
                  <Switch
                    checked={enableReviews}
                    onCheckedChange={onChangeEnableReviews}
                    className="data-[state=checked]:bg-blue-500 scale-90"
                    disabled={isOffline}
                  />
                </div>
              </div>

              <div
                className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all duration-300 ${
                  enableCoupons
                    ? "border-amber-500/20 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
                    : "border-white/5 bg-white/5 hover:border-white/10"
                }`}
              >
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                    enableCoupons
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                      : "border-white/5 bg-zinc-950/80 text-zinc-500"
                  }`}
                >
                  <Tag className="size-4.5" />
                </div>
                <div className="flex-1 space-y-1 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-white">
                      Motor de Cupons
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0 text-[7.5px] font-black uppercase tracking-wider ${
                        enableCoupons
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          : "border-white/5 bg-zinc-900 text-zinc-500"
                      }`}
                    >
                      Conversão e Vendas
                    </span>
                  </div>
                  <p className="text-[8.5px] font-bold uppercase leading-none tracking-widest text-zinc-400">
                    Ativar validação de descontos no checkout
                  </p>
                  <p className="text-[9.5px] leading-snug text-zinc-500">
                    Habilita o campo de cupom no carrinho e checkout. Permite
                    validar e aplicar descontos percentuais ou fixos definidos.
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span
                      className={`size-1 rounded-full ${enableCoupons ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`}
                    />
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                      {enableCoupons
                        ? "Habilitado e ativo no app"
                        : "Desativado"}
                    </span>
                  </div>
                </div>
                <div className="self-center pl-1.5">
                  <Switch
                    checked={enableCoupons}
                    onCheckedChange={onChangeEnableCoupons}
                    className="data-[state=checked]:bg-admin-gold scale-90"
                    disabled={isOffline}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ==========================================
// Notifications Section (Memoized)
// ==========================================
const NotificationsSection = memo(function NotificationsSection({
  realTimeSalesAlerts,
  pushMarketingEnabled,
  isOffline,
  onChangeRealTimeSalesAlerts,
  onChangePushMarketingEnabled,
}: {
  realTimeSalesAlerts: boolean;
  pushMarketingEnabled: boolean;
  isOffline: boolean;
  onChangeRealTimeSalesAlerts: (val: boolean) => void;
  onChangePushMarketingEnabled: (val: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex w-full select-none items-center justify-between rounded-2xl p-2 text-left transition-all hover:bg-white/5"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.1)] transition-all group-hover:scale-105">
            <Bell className="size-5 text-purple-400" strokeWidth={2.5} />
          </div>
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
            Inteligência de Notificação
          </h2>
        </div>
        <ChevronDown
          className={`size-5 text-zinc-500 transition-all duration-300 group-hover:text-white ${
            isOpen ? "rotate-180 text-admin-gold" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-2">
            <div className="admin-glass relative space-y-2.5 overflow-hidden border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4">
              <div
                className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all duration-300 ${
                  realTimeSalesAlerts
                    ? "border-emerald-500/20 bg-emerald-500/5 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                    : "border-white/5 bg-white/5 hover:border-white/10"
                }`}
              >
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                    realTimeSalesAlerts
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                      : "border-white/5 bg-zinc-950/80 text-zinc-500"
                  }`}
                >
                  <Sparkles className="size-4.5" />
                </div>
                <div className="flex-1 space-y-1 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-white">
                      Alertas de Venda Ativa
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0 text-[7.5px] font-black uppercase tracking-wider ${
                        realTimeSalesAlerts
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-white/5 bg-zinc-900 text-zinc-500"
                      }`}
                    >
                      Gatilho de Urgência
                    </span>
                  </div>
                  <p className="text-[8.5px] font-bold uppercase leading-none tracking-widest text-zinc-400">
                    Feedback visual imediato para novos pedidos
                  </p>
                  <p className="text-[9.5px] leading-snug text-zinc-500">
                    Exibe popups discretos no site informando sobre compras
                    recentes de outros usuários. Estimula o gatilho da escassez e da
                    prova social.
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span
                      className={`size-1 rounded-full ${realTimeSalesAlerts ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`}
                    />
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                      {realTimeSalesAlerts
                        ? "Habilitado e ativo no app"
                        : "Desativado"}
                    </span>
                  </div>
                </div>
                <div className="self-center pl-1.5">
                  <Switch
                    checked={realTimeSalesAlerts}
                    onCheckedChange={onChangeRealTimeSalesAlerts}
                    className="data-[state=checked]:bg-emerald-500 scale-90"
                    disabled={isOffline}
                  />
                </div>
              </div>

              <div
                className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all duration-300 ${
                  pushMarketingEnabled
                    ? "border-purple-500/20 bg-purple-500/5 shadow-[0_0_15px_rgba(168,85,247,0.05)]"
                    : "border-white/5 bg-white/5 hover:border-white/10"
                }`}
              >
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                    pushMarketingEnabled
                      ? "border-purple-500/30 bg-purple-500/10 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.15)]"
                      : "border-white/5 bg-zinc-950/80 text-zinc-500"
                  }`}
                >
                  <Megaphone className="size-4.5" />
                </div>
                <div className="flex-1 space-y-1 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-white">
                      Push Marketing Automation
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0 text-[7.5px] font-black uppercase tracking-wider ${
                        pushMarketingEnabled
                          ? "border-purple-500/30 bg-purple-500/10 text-purple-400"
                          : "border-white/5 bg-zinc-900 text-zinc-500"
                      }`}
                    >
                      Retenção & Engajamento
                    </span>
                  </div>
                  <p className="text-[8.5px] font-bold uppercase leading-none tracking-widest text-zinc-400">
                    Broadcast de ofertas via sistema
                  </p>
                  <p className="text-[9.5px] leading-snug text-zinc-500">
                    Dispara automaticamente ofertas personalizadas, avisos de
                    promoções exclusivas e lembretes de carrinhos abandonados.
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span
                      className={`size-1 rounded-full ${pushMarketingEnabled ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`}
                    />
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                      {pushMarketingEnabled
                        ? "Habilitado e ativo no app"
                        : "Desativado"}
                    </span>
                  </div>
                </div>
                <div className="self-center pl-1.5">
                  <Switch
                    checked={pushMarketingEnabled}
                    onCheckedChange={onChangePushMarketingEnabled}
                    className="data-[state=checked]:bg-purple-500 scale-90"
                    disabled={isOffline}
                  />
                </div>
              </div>
              <div className="absolute -bottom-10 -right-10 size-32 rounded-full bg-purple-500/5 blur-[80px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ==========================================
// Connection Diagnostics Section (Glassmorphism)
// ==========================================
const ConnectionDiagnosticsSection = memo(
  function ConnectionDiagnosticsSection() {
    const [isOpen, setIsOpen] = useState(false);
    const [testStatus, setTestStatus] = useState<
      "idle" | "testing" | "success" | "error"
    >("idle");
    const [avgLatency, setAvgLatency] = useState<number | null>(null);
    const [minLatency, setMinLatency] = useState<number | null>(null);
    const [maxLatency, setMaxLatency] = useState<number | null>(null);
    const [packetLoss, setPacketLoss] = useState<number>(0);

    const handleTestConnectivity = async () => {
      setTestStatus("testing");
      setAvgLatency(null);
      setMinLatency(null);
      setMaxLatency(null);
      setPacketLoss(0);

      const pings: number[] = [];
      let failed = 0;
      const totalTests = 4;

      for (let i = 0; i < totalTests; i++) {
        const startTime = performance.now();
        try {
          // Call a simple query to measure response time
          const { error } = await supabase
            .from("produtos")
            .select("id")
            .limit(1);

          const endTime = performance.now();
          if (error) throw error;
          pings.push(endTime - startTime);
        } catch (err) {
          console.error("[Diagnostics] Ping failed:", err);
          failed++;
        }
        // Small pause between pings
        if (i < totalTests - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      const lossPercent = Math.round((failed / totalTests) * 100);
      setPacketLoss(lossPercent);

      if (pings.length > 0) {
        const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
        const min = Math.round(Math.min(...pings));
        const max = Math.round(Math.max(...pings));
        setAvgLatency(avg);
        setMinLatency(min);
        setMaxLatency(max);
        setTestStatus(lossPercent > 50 ? "error" : "success");
      } else {
        setTestStatus("error");
      }
    };

    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="group flex w-full select-none items-center justify-between rounded-2xl p-2 text-left transition-all hover:bg-white/5"
        >
          <div className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all group-hover:scale-105">
              <RefreshCw className="size-5 text-amber-500" strokeWidth={2.5} />
            </div>
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
              Diagnóstico de Conexão
            </h2>
          </div>
          <ChevronDown
            className={`size-5 text-zinc-500 transition-all duration-300 group-hover:text-white ${
              isOpen ? "rotate-180 text-admin-gold" : ""
            }`}
          />
        </button>

        <div
          className={`grid transition-all duration-300 ease-in-out ${
            isOpen
              ? "grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="pt-2">
              <div className="admin-glass group relative overflow-hidden border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4">
                <div className="flex flex-col gap-2.5">
                  <p className="text-left text-[9.5px] leading-snug text-zinc-400">
                    Meça a latência (ping) e perda de pacotes entre o seu
                    navegador e o banco de dados do Supabase. Útil para
                    identificar lentidão ou instabilidade na sua rede local.
                  </p>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {/* Latency metric */}
                    <div className="flex min-h-[60px] flex-col justify-between rounded-xl border border-white/5 bg-zinc-950/40 p-2.5">
                      <span className="text-[7.5px] font-black uppercase leading-none tracking-widest text-zinc-500">
                        Latência Média
                      </span>
                      {testStatus === "testing" ? (
                        <div className="my-1 h-5 w-12 animate-pulse rounded bg-white/5" />
                      ) : avgLatency !== null ? (
                        <div className="my-1 flex items-baseline gap-0.5">
                          <span
                            className={`text-xl font-black tracking-tight ${
                              avgLatency < 120
                                ? "text-emerald-400"
                                : avgLatency < 250
                                  ? "text-amber-400"
                                  : "text-red-400"
                            }`}
                          >
                            {avgLatency}
                          </span>
                          <span className="text-[8px] font-bold text-zinc-500">
                            ms
                          </span>
                        </div>
                      ) : (
                        <span className="my-1 text-xs font-bold text-zinc-600">
                          —
                        </span>
                      )}
                      <span className="text-[7.5px] font-bold uppercase tracking-wider text-zinc-600">
                        {avgLatency !== null
                          ? avgLatency < 120
                            ? "Excelente"
                            : avgLatency < 250
                              ? "Moderado"
                              : "Conexão Lenta"
                          : "Aguardando Teste"}
                      </span>
                    </div>

                    {/* Min/Max Latency */}
                    <div className="flex min-h-[60px] flex-col justify-between rounded-xl border border-white/5 bg-zinc-950/40 p-2.5">
                      <span className="text-[7.5px] font-black uppercase leading-none tracking-widest text-zinc-500">
                        Variação (Min / Max)
                      </span>
                      {testStatus === "testing" ? (
                        <div className="my-1 h-5 w-16 animate-pulse rounded bg-white/5" />
                      ) : minLatency !== null && maxLatency !== null ? (
                        <div className="my-1 flex items-baseline gap-1 text-xs font-black text-zinc-200">
                          <span>{minLatency}</span>
                          <span className="font-normal text-zinc-600">/</span>
                          <span>{maxLatency}</span>
                          <span className="text-[8px] font-bold text-zinc-500">
                            ms
                          </span>
                        </div>
                      ) : (
                        <span className="my-1 text-xs font-bold text-zinc-600">
                          —
                        </span>
                      )}
                      <span className="text-[7.5px] font-bold uppercase tracking-wider text-zinc-600">
                        Tempo limite
                      </span>
                    </div>

                    {/* Packet loss */}
                    <div className="flex min-h-[60px] flex-col justify-between rounded-xl border border-white/5 bg-zinc-950/40 p-2.5">
                      <span className="text-[7.5px] font-black uppercase leading-none tracking-widest text-zinc-500">
                        Perda de Pacotes
                      </span>
                      {testStatus === "testing" ? (
                        <div className="my-1 h-5 w-8 animate-pulse rounded bg-white/5" />
                      ) : testStatus !== "idle" ? (
                        <div className="my-1 flex items-baseline gap-0.5">
                          <span
                            className={`text-xl font-black tracking-tight ${
                              packetLoss === 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {packetLoss}
                          </span>
                          <span className="text-[8px] font-bold text-zinc-500">
                            %
                          </span>
                        </div>
                      ) : (
                        <span className="my-1 text-xs font-bold text-zinc-600">
                          —
                        </span>
                      )}
                      <span className="text-[7.5px] font-bold uppercase tracking-wider text-zinc-600">
                        {testStatus !== "idle"
                          ? packetLoss === 0
                            ? "Conexão Estável"
                            : "Instabilidade Detectada"
                          : "Aguardando Teste"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      disabled={testStatus === "testing"}
                      onClick={handleTestConnectivity}
                      className="flex h-8.5 select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-amber-500/30 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                    >
                      {testStatus === "testing" ? (
                        <>
                          <RefreshCw className="size-3 animate-spin text-amber-500" />
                          <span>Medindo...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="size-3 text-amber-500" />
                          <span>Testar Conectividade</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

const cleanConfigForForm = (cfg: StoreConfig): StoreConfig => {
  if (!cfg) return cfg;
  let whatsappNumber = cfg.whatsappNumber || "";
  whatsappNumber = whatsappNumber.replace(/\D/g, "");
  if (whatsappNumber.startsWith("55") && whatsappNumber.length > 10) {
    whatsappNumber = whatsappNumber.slice(2);
  }
  return {
    ...cfg,
    whatsappNumber,
    freeShippingMin:
      cfg.freeShippingMin !== undefined && cfg.freeShippingMin !== null
        ? Number(cfg.freeShippingMin)
        : 0,
    shippingFee:
      cfg.shippingFee !== undefined && cfg.shippingFee !== null
        ? Number(cfg.shippingFee)
        : 0,
  };
};

function isConfigDirty(
  a: Partial<StoreConfig>,
  b: Partial<StoreConfig>,
): boolean {
  if (!a || !b) return a !== b;

  const getCleanPhone = (val: any) => {
    const clean = (val || "").toString().replace(/\D/g, "");
    return clean.startsWith("55") && clean.length > 10 ? clean.slice(2) : clean;
  };

  const getNum = (val: any) =>
    val !== undefined && val !== null ? Number(val) : 0;

  if (getNum(a.freeShippingMin) !== getNum(b.freeShippingMin)) return true;
  if (getNum(a.shippingFee) !== getNum(b.shippingFee)) return true;
  if (getCleanPhone(a.whatsappNumber) !== getCleanPhone(b.whatsappNumber))
    return true;

  if ((a.shareText || "") !== (b.shareText || "")) return true;
  if ((a.businessHours || "") !== (b.businessHours || "")) return true;
  if (!!a.enableReviews !== !!b.enableReviews) return true;
  if (!!a.enableCoupons !== !!b.enableCoupons) return true;
  if ((a.primaryColor || "") !== (b.primaryColor || "")) return true;
  if ((a.themeMode || "") !== (b.themeMode || "")) return true;
  if (!!a.realTimeSalesAlerts !== !!b.realTimeSalesAlerts) return true;
  if (!!a.pushMarketingEnabled !== !!b.pushMarketingEnabled) return true;
  if ((a.originCep || "") !== (b.originCep || "")) return true;
  if ((a.shippingProvider || "flat_fee") !== (b.shippingProvider || "flat_fee"))
    return true;
  if ((a.logoUrl || "") !== (b.logoUrl || "")) return true;
  if ((a.minAppVersion || "") !== (b.minAppVersion || "")) return true;

  const arrA = Array.isArray(a.enabledShippingMethods)
    ? a.enabledShippingMethods
    : [];
  const arrB = Array.isArray(b.enabledShippingMethods)
    ? b.enabledShippingMethods
    : [];
  if (arrA.length !== arrB.length) return true;
  const sortedA = [...arrA].sort();
  const sortedB = [...arrB].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return true;
  }

  return false;
}

export const AdminSettingsView = memo(function AdminSettingsView({
  active,
  onSetDirty,
}: Readonly<AdminSettingsViewProps>) {
  const { config, isLoaded, updateConfig, refresh } = useStore();
  const isOffline = useOnlineStatus();
  const [formData, setFormData] = useState(() => cleanConfigForForm(config));
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const hasInitialSyncRef = useRef(false);
  const [shippingCreds, setShippingCreds] = useState<{ [key: string]: any }>(
    {},
  );

  // Load credentials on mount for the admin
  useEffect(() => {
    const fetchShippingCreds = async () => {
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
        }
      } catch (err) {
        console.error("Error fetching shipping credentials:", err);
      }
    };
    if (isLoaded) {
      fetchShippingCreds();
    }
  }, [isLoaded]);

  const onChangeFreeShippingMin = useCallback((val: number) => {
    setFormData((prev) => ({ ...prev, freeShippingMin: val }));
  }, []);

  const onChangeOriginCep = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, originCep: val }));
  }, []);

  const onChangeShippingProvider = useCallback(
    (val: "flat_fee" | "melhor_envio" | "frenet") => {
      setFormData((prev) => ({ ...prev, shippingProvider: val }));
    },
    [],
  );

  const onChangeEnabledShippingMethods = useCallback((val: string[]) => {
    setFormData((prev) => ({ ...prev, enabledShippingMethods: val }));
  }, []);

  const onChangeShippingCreds = useCallback((provider: string, creds: any) => {
    setShippingCreds((prev) => ({ ...prev, [provider]: creds }));
  }, []);

  const onChangeShippingFee = useCallback((val: number) => {
    setFormData((prev) => ({ ...prev, shippingFee: val }));
  }, []);

  const onChangeWhatsappNumber = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, whatsappNumber: val }));
  }, []);

  const onChangeBusinessHours = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, businessHours: val }));
  }, []);

  const onChangeShareText = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, shareText: val }));
  }, []);

  const onChangeEnableReviews = useCallback((val: boolean) => {
    haptic.light();
    setFormData((prev) => ({ ...prev, enableReviews: val }));
  }, []);

  const onChangeEnableCoupons = useCallback((val: boolean) => {
    haptic.light();
    setFormData((prev) => ({ ...prev, enableCoupons: val }));
  }, []);

  const onChangeRealTimeSalesAlerts = useCallback((val: boolean) => {
    haptic.light();
    setFormData((prev) => ({ ...prev, realTimeSalesAlerts: val }));
  }, []);

  const onChangePushMarketingEnabled = useCallback((val: boolean) => {
    haptic.light();
    setFormData((prev) => ({ ...prev, pushMarketingEnabled: val }));
  }, []);

  useEffect(() => {
    if (isLoaded && config) {
      if (!hasInitialSyncRef.current) {
        setFormData(cleanConfigForForm(config));
        hasInitialSyncRef.current = true;
      } else {
        setFormData((prev) => {
          if (!prev) return cleanConfigForForm(config);
          const isFormDirty = isConfigDirty(config, prev);
          return isFormDirty ? prev : cleanConfigForForm(config);
        });
      }
    }
  }, [config, isLoaded]);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        refresh({ onlyConfig: true });
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [active, refresh]);

  // Reset helper modals when tab becomes inactive
  useEffect(() => {
    if (!active) {
      setShowHelpModal(false);
      setIsSaving(false);
    }
  }, [active]);

  useEffect(() => {
    if (!onSetDirty || !config || !formData) return;
    const isDirty = isConfigDirty(config, formData);
    onSetDirty(isDirty);
    return () => {
      onSetDirty(false);
    };
  }, [formData, config, onSetDirty]);

  const handleSubmit = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para salvar as configurações do marketplace.",
      });
      return;
    }
    if (isSaving) return;

    // Basic validation
    if (!formData.whatsappNumber) {
      toast.error("WhatsApp é obrigatório");
      return;
    }

    let cleanWhatsApp = formData.whatsappNumber.replaceAll(/\D/g, "");
    if (cleanWhatsApp.length < 10) {
      toast.error("WhatsApp inválido");
      return;
    }

    if (cleanWhatsApp.length === 10 || cleanWhatsApp.length === 11) {
      cleanWhatsApp = `55${cleanWhatsApp}`;
    }

    const sanitizedFormData = {
      ...formData,
      whatsappNumber: cleanWhatsApp,
      freeShippingMin: Math.max(0, formData.freeShippingMin || 0),
      shippingFee: Math.max(0, formData.shippingFee || 0),
    };

    setIsSaving(true);
    try {
      await updateConfig(sanitizedFormData);

      // Save shipping credentials if provider is not flat_fee
      if (
        sanitizedFormData.shippingProvider &&
        sanitizedFormData.shippingProvider !== "flat_fee"
      ) {
        const provider = sanitizedFormData.shippingProvider;
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

      onSetDirty?.(false);
    } catch (err) {
      console.error("[AdminSettingsView] Error updating config:", err);
      toast.error("Erro ao salvar as credenciais de frete");
    } finally {
      setIsSaving(false);
    }
  };

  // Removed early return loading block to prevent visual layout shifts

  return (
    <div className="h-auto bg-admin-bg pb-28 duration-200 animate-in fade-in lg:pb-8">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
            <span className="flex flex-nowrap items-baseline whitespace-nowrap">
              <span className="italic text-white">Ajustes</span>
            </span>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
              title="Guia de Configurações e Ajuda"
            >
              <HelpCircle className="size-4" />
            </button>
          </h1>
          <button
            onClick={handleSubmit}
            disabled={!isLoaded || isOffline || isSaving}
            className="flex h-9.5 shrink-0 items-center gap-2 rounded-lg bg-admin-gold px-3.5 text-[9.5px] font-black uppercase tracking-widest text-white shadow-[0_0_30px_rgba(212,175,55,0.2)] transition-all hover:bg-admin-gold/90 hover:shadow-[0_0_40px_rgba(212,175,55,0.3)] active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:gap-3 sm:px-5"
          >
            {isSaving ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Save className="size-4" />
                <span>
                  Salvar<span className="hidden sm:inline"> Alterações</span>
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-3 pb-8">
        {isOffline && (
          <div className="flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="size-5 shrink-0 animate-pulse text-red-500" />
            <span>
              Você está offline. O salvamento das configurações está
              desabilitado até restabelecer a rede.
            </span>
          </div>
        )}

        {!isLoaded ? (
          <div className="mt-4 animate-pulse space-y-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex h-20 flex-col justify-between rounded-[2rem] border border-white/5 bg-zinc-900/30 p-6"
              >
                <Skeleton className="h-4 w-1/3 rounded-md bg-white/5" />
                <Skeleton className="h-3 w-1/2 rounded-md bg-white/5" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <LogisticsSection
              freeShippingMin={formData.freeShippingMin}
              shippingFee={formData.shippingFee}
              isOffline={isOffline}
              onChangeFreeShippingMin={onChangeFreeShippingMin}
              onChangeShippingFee={onChangeShippingFee}
              originCep={formData.originCep}
              shippingProvider={formData.shippingProvider}
              enabledShippingMethods={formData.enabledShippingMethods}
              shippingCreds={shippingCreds}
              onChangeOriginCep={onChangeOriginCep}
              onChangeShippingProvider={onChangeShippingProvider}
              onChangeEnabledShippingMethods={onChangeEnabledShippingMethods}
              onChangeShippingCreds={onChangeShippingCreds}
            />

            <SupportSection
              whatsappNumber={formData.whatsappNumber}
              businessHours={formData.businessHours}
              shareText={formData.shareText}
              isOffline={isOffline}
              onChangeWhatsappNumber={onChangeWhatsappNumber}
              onChangeBusinessHours={onChangeBusinessHours}
              onChangeShareText={onChangeShareText}
            />

            <ModulesSection
              enableReviews={formData.enableReviews}
              enableCoupons={formData.enableCoupons}
              isOffline={isOffline}
              onChangeEnableReviews={onChangeEnableReviews}
              onChangeEnableCoupons={onChangeEnableCoupons}
            />

            <NotificationsSection
              realTimeSalesAlerts={formData.realTimeSalesAlerts ?? true}
              pushMarketingEnabled={formData.pushMarketingEnabled ?? false}
              isOffline={isOffline}
              onChangeRealTimeSalesAlerts={onChangeRealTimeSalesAlerts}
              onChangePushMarketingEnabled={onChangePushMarketingEnabled}
            />

            <ConnectionDiagnosticsSection />
          </>
        )}
      </div>

      {/* Modal de Ajuda */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 text-left backdrop-blur-md duration-300 animate-in fade-in sm:p-6">
          <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/95 p-5 text-sm text-zinc-300 shadow-[0_0_50px_rgba(0,0,0,0.8)] duration-300 animate-in zoom-in-95 sm:max-h-[85vh] sm:rounded-[2.5rem] sm:p-8">
            {/* Header */}
            <div className="mb-4 flex shrink-0 items-center justify-between border-b border-white/5 pb-4">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-admin-gold">
                <HelpCircle className="size-5 animate-pulse text-admin-gold" />
                Guia de Configurações do Sistema
              </h3>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="flex size-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/50 text-sm font-bold text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto pb-6 pr-1 text-sm text-zinc-300">
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-zinc-400">
                  Nesta tela são ajustados os parâmetros gerais e regras de
                  funcionamento do seu marketplace, como fretes, raio de atuação
                  e canais de atendimento.
                </p>

                <div className="space-y-3">
                  <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Seções de Ajustes
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                        <Truck className="size-4 text-emerald-500" />
                        Logística & Entregas
                      </div>
                      <p className="text-xs text-zinc-400">
                        Define o preço de frete cobrado por padrão, o tempo de
                        entrega informado ao cliente e a distância máxima (raio)
                        que o marketplace atende.
                      </p>
                    </div>

                    <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                        <Headset className="size-4 text-admin-gold" />
                        Atendimento & WhatsApp
                      </div>
                      <p className="text-xs text-zinc-400">
                        O número de telefone configurado para o WhatsApp da
                        loja. É para onde as mensagens automáticas de
                        confirmação de pedido serão enviadas.
                      </p>
                    </div>

                    <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                        <Boxes className="size-4 text-sky-500" />
                        Contatos Oficiais
                      </div>
                      <p className="text-xs text-zinc-400">
                        Informações institucionais como endereço físico,
                        telefone fixo e e-mail de suporte que aparecem no rodapé
                        do app dos clientes.
                      </p>
                    </div>

                    <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                        <Bell className="size-4 text-purple-500" />
                        Notificações e Ajustes
                      </div>
                      <p className="text-xs text-zinc-400">
                        Controla parâmetros visuais, atalhos rápidos para cupons
                        e banners da loja na base do painel.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 justify-end border-t border-white/5 pt-4">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="rounded-xl bg-admin-gold px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-admin-gold/90"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
