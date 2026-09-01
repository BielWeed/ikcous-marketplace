import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  HelpCircle,
  Layers,
  MapPin,
  Palette,
  RefreshCw,
  Save,
  Wallet,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";

import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PAGAMENTO_ONLINE_LIGADO } from "@/lib/flags";
import { supabase } from "@/lib/supabase";

import type { View } from "@/types";

// Laudo 0109 (D1): o painel não tinha NENHUMA menção ao estado do
// pagamento — o lojista descobria que a loja não aceita PIX pela queixa do
// cliente. A flag vem do build (src/lib/flags.ts); a chave pública também
// (mesmo deploy). Placeholder do .env.example é o "não configurada".
const CHAVE_PUBLICA_MP = import.meta.env.VITE_MP_PUBLIC_KEY as
  | string
  | undefined;
const CHAVE_PUBLICA_MP_OK =
  !!CHAVE_PUBLICA_MP && CHAVE_PUBLICA_MP !== "YOUR_MP_PUBLIC_KEY_HERE";

interface AdminSettingsViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

// ==========================================
// Store Location Section — cidade e estado da loja
// ==========================================
//
// Até aqui esta tela tinha exatamente dois blocos: diagnóstico de conexão e
// um guia de ajuda. Não havia uma única configuração de loja nela. Este
// cartão é o que faz "Ajustes" ajustar alguma coisa.
//
// O campo de nome NÃO mora aqui: `storeName` grava no banco (StoreContext)
// e as telas do cliente já leem de volta — Header, Home e Busca preferem
// `config.storeName` e só caem no `branding.appName` quando o banco está
// vazio (ver tests/front/nome-da-loja-vem-do-banco.test.tsx). Esta tela
// segue dona só do que ela edita: a localização, no cartão abaixo.
const StoreLocationSection = memo(function StoreLocationSection() {
  const { config, updateConfig } = useStore();
  const [storeCity, setStoreCity] = useState(config.storeCity ?? "");
  const [storeState, setStoreState] = useState(config.storeState ?? "");
  const [businessHours, setBusinessHours] = useState(
    config.businessHours ?? "",
  );
  const [isSaving, setIsSaving] = useState(false);

  // A tela pode montar antes do StoreContext terminar de carregar o config
  // do banco -- sem isto, os campos ficariam presos no valor vazio do
  // primeiro render mesmo depois do fetch resolver.
  useEffect(() => {
    setStoreCity(config.storeCity ?? "");
    setStoreState(config.storeState ?? "");
    setBusinessHours(config.businessHours ?? "");
  }, [config.storeCity, config.storeState, config.businessHours]);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      // Campo vazio grava `null`, não string vazia: `null` é o estado "a
      // loja não configurou" que o resto do app trata como ausência, em vez
      // de imprimir vazio no meio de uma frase.
      const salvou = await updateConfig({
        storeCity: storeCity.trim() || null,
        storeState: storeState.trim().toUpperCase() || null,
        // Horário de atendimento no mesmo molde (laudo caça-bugs 30/08:
        // a sentinela 'Seg-Sáb: 9h às 18h' chegou a ser publicada como se
        // fosse dado real). Vazio = a loja não disse, e a vitrine omite o
        // bloco — nunca publica expediente que ninguém digitou.
        businessHours: businessHours.trim() || null,
      });
      // O toast de erro já sai de dentro do StoreContext (ADMIN-010, #94) --
      // aqui só não seguimos em frente quando o retorno não for `true`.
      if (!salvou) return;
      toast.success("Dados da loja salvos");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 p-2">
        <div className="flex size-10 items-center justify-center rounded-xl border border-admin-gold/20 bg-admin-gold/10 shadow-[0_0_15px_rgba(212,175,55,0.1)]">
          <MapPin className="size-5 text-admin-gold" strokeWidth={2.5} />
        </div>
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
          Localização e Horário da Loja
        </h2>
      </div>

      <div className="admin-glass border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4">
        <div className="flex flex-col gap-3">
          <p className="text-left text-[9.5px] leading-snug text-zinc-400">
            Cidade, estado e horário aparecem para quem compra. Deixe em branco
            o que a loja ainda não quer mostrar -- o app omite, nunca inventa.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
            <div className="space-y-1.5">
              <label
                htmlFor="store-city"
                className="text-xs font-semibold text-zinc-300"
              >
                Cidade
              </label>
              <input
                id="store-city"
                type="text"
                value={storeCity}
                onChange={(e) => setStoreCity(e.target.value)}
                placeholder="Cidade"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-xs font-semibold text-white placeholder-zinc-600 transition-all focus:border-admin-gold focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="store-state"
                className="text-xs font-semibold text-zinc-300"
              >
                Estado (UF)
              </label>
              <input
                id="store-state"
                type="text"
                maxLength={2}
                value={storeState}
                onChange={(e) => setStoreState(e.target.value.toUpperCase())}
                placeholder="UF"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-center font-mono text-xs font-semibold uppercase text-white placeholder-zinc-600 transition-all focus:border-admin-gold focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="store-business-hours"
              className="text-xs font-semibold text-zinc-300"
            >
              Horário de atendimento
            </label>
            <input
              id="store-business-hours"
              type="text"
              value={businessHours}
              onChange={(e) => setBusinessHours(e.target.value)}
              placeholder="Ex: Ter a Sáb, 9h às 18h"
              className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-xs font-semibold text-white placeholder-zinc-600 transition-all focus:border-admin-gold focus:outline-none"
            />
          </div>

          <div className="mt-1 flex justify-end">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-admin-gold/30 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {isSaving ? (
                <RefreshCw className="size-3 animate-spin text-admin-gold" />
              ) : (
                <Save className="size-3 text-admin-gold" />
              )}
              <span>{isSaving ? "Salvando..." : "Salvar"}</span>
            </button>
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
    const [isOpen, setIsOpen] = useState(true);
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
          const { error } = await supabase
            .from("vw_produtos_public")
            .select("id")
            .limit(1);

          const endTime = performance.now();
          if (error) throw error;
          pings.push(endTime - startTime);
        } catch (err) {
          console.error("[Diagnostics] Ping failed:", err);
          failed++;
        }
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
                      className="h-8.5 flex select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-amber-500/30 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
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

export const AdminSettingsView = memo(function AdminSettingsView({
  onNavigate,
  active,
}: Readonly<AdminSettingsViewProps>) {
  const { isLoaded } = useStore();
  const isOffline = useOnlineStatus();
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Reset helper modals when tab becomes inactive
  useEffect(() => {
    if (!active) {
      setShowHelpModal(false);
    }
  }, [active]);

  return (
    <div className="h-auto bg-admin-bg pb-admin lg:pb-12 duration-200 animate-in fade-in">
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
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-3 pb-8">
        {isOffline && (
          <div className="flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="size-5 shrink-0 animate-pulse text-red-500" />
            <span>
              Você está offline. Algumas operações de diagnóstico podem ser
              afetadas.
            </span>
          </div>
        )}

        {!isLoaded ? (
          <div className="mt-4 animate-pulse space-y-6">
            {[1, 2].map((i) => (
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
            {/* Showcase Design Section */}
            <div className="space-y-3 delay-75 duration-300 animate-in fade-in slide-in-from-bottom-2">
              <h2 className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Design & Vitrine
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Card 1: Banners Promocionais */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate("admin-banners")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigate("admin-banners");
                    }
                  }}
                  className="group relative cursor-pointer overflow-hidden rounded-3xl border border-white/5 bg-zinc-950/40 p-5 shadow-xl transition-all duration-500 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
                >
                  {/* Ambient glow */}
                  <div className="absolute -bottom-6 -right-6 size-24 rounded-full bg-admin-gold/5 blur-2xl transition-all duration-700 group-hover:bg-admin-gold/15" />

                  <div className="relative flex flex-col justify-between h-full gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-admin-gold/20 bg-admin-gold/10 text-admin-gold transition-colors duration-300 group-hover:bg-admin-gold group-hover:text-black">
                        <Palette className="size-5" />
                      </div>
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-admin-gold group-hover:text-black">
                        <ArrowUpRight className="size-4 stroke-[2.5]" />
                      </div>
                    </div>
                    <div>
                      <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-admin-gold">
                        Campanhas Visuais
                      </span>
                      <h3 className="text-base font-black leading-tight tracking-tight text-white">
                        Banners Promocionais
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        Personalize artes, artes simples/completas, links de
                        destino e agendamentos.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Card 2: Vitrines (Carrosséis) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate("admin-carousels")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigate("admin-carousels");
                    }
                  }}
                  className="group relative cursor-pointer overflow-hidden rounded-3xl border border-white/5 bg-zinc-950/40 p-5 shadow-xl transition-all duration-500 hover:border-amber-500/30 hover:bg-zinc-900/30 active:scale-[0.98]"
                >
                  {/* Ambient glow */}
                  <div className="absolute -bottom-6 -right-6 size-24 rounded-full bg-amber-500/5 blur-2xl transition-all duration-700 group-hover:bg-amber-500/15" />

                  <div className="relative flex flex-col justify-between h-full gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 transition-colors duration-300 group-hover:bg-amber-500 group-hover:text-black">
                        <Layers className="size-5" />
                      </div>
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-amber-500 group-hover:text-black">
                        <ArrowUpRight className="size-4 stroke-[2.5]" />
                      </div>
                    </div>
                    <div>
                      <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-amber-500">
                        Organização da Home
                      </span>
                      <h3 className="text-base font-black leading-tight tracking-tight text-white">
                        Vitrines (Carrosséis)
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        Customize títulos, reordene posições e ative ou desative
                        carrosséis de produtos.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Card 3: Pagamento online — estado honesto (laudo 0109, D1).
                    Não é porta: é o aviso que faltava para o lojista não
                    descobrir pela queixa do cliente que as chaves não estão
                    no lugar. */}
                <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-zinc-950/40 p-5 shadow-xl">
                  <div className="relative flex flex-col justify-between h-full gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border ${
                          PAGAMENTO_ONLINE_LIGADO && CHAVE_PUBLICA_MP_OK
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                            : "border-amber-500/20 bg-amber-500/10 text-amber-500"
                        }`}
                      >
                        <Wallet className="size-5" />
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                          PAGAMENTO_ONLINE_LIGADO
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                            : "border-white/5 bg-white/5 text-zinc-400"
                        }`}
                      >
                        {PAGAMENTO_ONLINE_LIGADO ? "Ligado" : "Desligado"}
                      </span>
                    </div>
                    <div>
                      <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-admin-gold">
                        Dinheiro do Pedido
                      </span>
                      <h3 className="text-base font-black leading-tight tracking-tight text-white">
                        Pagamento online (PIX)
                      </h3>
                      {PAGAMENTO_ONLINE_LIGADO ? (
                        CHAVE_PUBLICA_MP_OK ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            Ligado e com chave pública no deploy. Antes de
                            divulgar a loja, confira se os segredos
                            MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET estão gravados
                            no Supabase.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs font-semibold text-red-400">
                            A flag está LIGADA, mas a chave pública do Mercado
                            Pago não está no deploy (VITE_MP_PUBLIC_KEY): a
                            tela de pagamento nem carrega para o cliente
                            ("Não foi possível carregar o pagamento."). Grave
                            as chaves MP antes de divulgar a loja.
                          </p>
                        )
                      ) : (
                        <p className="mt-1 text-xs text-zinc-500">
                          O cliente finaliza por pagamento na entrega. Para
                          aceitar PIX/cartão: cadastre as chaves do Mercado Pago
                          (VITE_MP_PUBLIC_KEY no deploy; MP_ACCESS_TOKEN e
                          MP_WEBHOOK_SECRET nos segredos do Supabase) e ligue
                          VITE_PAGAMENTO_ONLINE no deploy.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/*
              A porta "Avisar clientes" morou AQUI de 24/08 a 30/08/2026 e
              SAIU por decisão do Gabriel: o lugar dela é a tela de Clientes
              (componente CustomerBanners), ao lado de "Canais de
              Atendimento". O motivo que a trouxe para cá em 24/08 (zero
              portas visíveis para `admin-push` no celular) já não existe: o
              sino parou de escolher destino. O Voltar de `admin-push`
              continua sensível à origem (pai-da-tela-do-admin).
            */}

            <StoreLocationSection />

            <ConnectionDiagnosticsSection />
          </>
        )}
      </div>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Configurações do Sistema"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você pode gerenciar o design visual da vitrine do
            marketplace e realizar diagnósticos de conectividade do sistema.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Design & Vitrine
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Palette className="size-4 text-admin-gold" />
                  Banner e Carrossel
                </div>
                <p className="text-xs text-zinc-400">
                  Personalize fontes, artes, títulos e selecione os produtos em
                  destaque.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Diagnósticos
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <RefreshCw className="size-4 text-amber-500" />
                  Diagnóstico de Conexão
                </div>
                <p className="text-xs text-zinc-400">
                  Mede a latência e a perda de pacotes com o banco de dados do
                  Supabase.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
