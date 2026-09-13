import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  Clock,
  HelpCircle,
  History,
  Layers,
  Palette,
  RefreshCw,
  Truck,
  Wallet,
  Wifi,
} from "lucide-react";
import { Suspense, lazy, memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { HistoricoCotacoesSection } from "@/components/admin/settings/HistoricoCotacoesCard";
import { TransportadorasSection } from "@/components/admin/settings/TransportadorasCard";
import { Skeleton } from "@/components/ui/skeleton";
import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { lerSupabaseUrl } from "@/lib/env-valores";
import { pagamentoOnlineLigado } from "@/lib/flags";
import { pixConfiguradoNoBuild } from "@/lib/pix-configurado-no-build";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import { StatusPagamentoPix } from "@/views/admin/StatusPagamentoPix";

import type { View } from "@/types";

// Laudo 0109 (D1): o painel não tinha NENHUMA menção ao estado do
// pagamento — o lojista descobria que a loja não aceita PIX pela queixa do
// cliente. Escala etapa 3 (11/09/2026): a flag e a chave pública deixaram de
// vir do build e passaram a vir da ficha da loja
// (src/config/configuracaoDaLoja.ts), lida do banco de cada loja pelo
// porteiro. `null`/`false` é o "não configurada".
interface AdminSettingsViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

const IdentitySettingsSection = lazy(() =>
  import("@/components/admin/settings/IdentitySettingsSection").then(
    (module) => ({ default: module.IdentitySettingsSection }),
  ),
);

const BusinessHoursEditor = memo(function BusinessHoursEditor({
  onDirtyChange,
  active = true,
}: { onDirtyChange: (dirty: boolean) => void; active?: boolean }) {
  const { config, updateConfig } = useStore();
  const saved = config.businessHours ?? "";
  const [baseline, setBaseline] = useState(saved);
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const lifecycle = useRef({ mounted: true, active, serial: 0 });
  if (lifecycle.current.active && !active) lifecycle.current.serial++;
  lifecycle.current.active = active;
  useEffect(() => {
    // Sair da aba invalida o pedido, mas preserva o texto para uma nova tentativa.
    if (!active) setSaving(false);
  }, [active]);
  const lastIncoming = useRef(saved);
  const dirty = value !== baseline;
  // Incoming data only refreshes a pristine editor. A shipping refresh cannot erase typing.
  useEffect(() => {
    if (saved === lastIncoming.current) return;
    lastIncoming.current = saved;
    if (!dirty && !saving) {
      setBaseline(saved);
      setValue(saved);
    }
  }, [saved, dirty, saving]);
  useEffect(() => {
    onDirtyChange(dirty || saving);
  }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    const life = lifecycle.current;
    life.mounted = true;
    return () => {
      life.mounted = false;
      life.serial++;
    };
  }, []);
  async function save() {
    if (saving || !active) return;
    const life = lifecycle.current;
    const serial = ++life.serial;
    const isCurrent = () =>
      life.mounted && life.active && life.serial === serial;
    const chosen = value.trim();
    setSaving(true);
    setError(false);
    try {
      const success = await updateConfig(
        { businessHours: chosen || null },
        { isCurrent, silent: true },
      );
      if (!isCurrent()) return;
      if (success) {
        setBaseline(chosen);
        setValue(chosen);
        toast.success("Horário de atendimento salvo");
      } else setError(true);
    } catch {
      if (isCurrent()) setError(true);
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }
  return (
    <div className="space-y-3 text-sm text-zinc-300">
      <p>
        Informe quando a loja atende. Em branco, o aplicativo omite o horário.
      </p>
      <label htmlFor="store-business-hours">Horário de atendimento</label>
      <input
        id="store-business-hours"
        value={value}
        disabled={saving || !active}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Ex: Ter a Sáb, 9h às 18h"
        className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-white"
      />
      {error && (
        <p role="alert">
          Não foi possível salvar o horário. O texto foi preservado.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving || !active || !dirty}
          onClick={() => void save()}
          className="rounded-lg border border-white/10 px-3 py-2"
        >
          {saving ? "Salvando…" : "Salvar horário"}
        </button>
        <button
          type="button"
          disabled={saving || !active || !dirty}
          onClick={() => {
            setBaseline(saved);
            setValue(saved);
            setError(false);
          }}
          className="rounded-lg border border-white/10 px-3 py-2"
        >
          Descartar horário
        </button>
      </div>
    </div>
  );
});

function BusinessHoursSection({
  onDirtyChange,
  active,
}: {
  onDirtyChange: (dirty: boolean) => void;
  active?: boolean;
}) {
  const { user, session, isAdmin, adminStatus } = useAuth();
  const allowed =
    isAdmin &&
    adminStatus === "admin" &&
    !!user &&
    session?.user.id === user.id;
  useEffect(() => {
    if (!allowed) onDirtyChange(false);
  }, [allowed, onDirtyChange]);
  if (!allowed)
    return <p role="alert">Entre como administrador para editar o horário.</p>;
  return (
    <BusinessHoursEditor
      key={`${lerSupabaseUrl()}|${user.id}`}
      onDirtyChange={onDirtyChange}
      active={active}
    />
  );
}

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
            <div className="relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/[0.18] to-amber-500/[0.04] text-amber-500 shadow-[0_2px_12px_-4px] shadow-amber-500/25 ring-1 ring-amber-500/20">
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-amber-500/[0.32] to-amber-500/[0.10] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
              <RefreshCw className="relative size-[18px]" strokeWidth={2.25} />
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

/**
 * Seção colapsável da tela de Ajustes (pedido do Gabriel, 02/09: separar
 * a tela por partes e deixar as seções técnicas OCULTAS por padrão — o
 * lojista abre a tela para editar o que usa todo dia; status e diagnósticos
 * são consulta rara e ficam atrás de um clique).
 *
 * Nasce FECHADA sempre: sem "lembra a última vez" de propósito — a tela
 * volta enxuta a cada visita, e expandir é um clique.
 *
 * `subtitulo` (desenho SALÃO+PORÃO, 13/09/2026): a linha de estado sob o
 * título ("Entrega e frete — Ativo: Melhor Envio"). Mora DENTRO do <button>
 * de propósito: fora dele a linha vira área morta que não abre a seção, e
 * o estado deixa de fazer parte do nome acessível do controle. Textos vêm
 * truncados (nome de loja longuíssimo não quebra o cabeçalho).
 *
 * `comPendencia`: quando o conteúdo da seção tem alteração não salva, fechar
 * desmonta o conteúdo e jogaria fora o que foi digitado. Enquanto houver
 * pendência o fechamento fica BLOQUEADO, com aviso no cabeçalho — o mesmo
 * gênero de trava que o painel usa para não perder trabalho digitado ao
 * trocar de tela (achado A1 da revisão adversária da frente
 * glm-visual-admin-0209: as seções que contêm formulário precisam dela;
 * seções de consulta podem omitir).
 */
function SecaoColapsavel({
  titulo,
  subtitulo,
  icone: Icone,
  comPendencia = false,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo?: string;
  readonly icone: React.ElementType;
  readonly comPendencia?: boolean;
  readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <div className="rounded-3xl border border-white/5 bg-zinc-950/40 p-4 shadow-xl">
      <button
        type="button"
        onClick={() => {
          if (aberta && comPendencia) {
            // Há trabalho não salvo dentro: fechar descartaria. A saída é o
            // botão Salvar do próprio conteúdo — a seção não some por um
            // clique que o lojista nem percebeu que foi no cabeçalho.
            return;
          }
          setAberta((antes) => !antes);
        }}
        aria-expanded={aberta}
        className="group flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold shadow-[0_2px_12px_-4px] shadow-admin-gold/25 ring-1 ring-admin-gold/20">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-admin-gold/[0.32] to-admin-gold/[0.10] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
            <Icone className="relative size-[18px]" strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-black uppercase tracking-[0.2em] text-white">
              {titulo}
            </span>
            {subtitulo && (
              <span className="block truncate text-[10px] font-medium normal-case tracking-normal text-zinc-500">
                {subtitulo}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {aberta && comPendencia && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">
              Salve antes de fechar
            </span>
          )}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300",
              aberta && "rotate-180",
            )}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {aberta && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Rótulo de grupo da tela de Ajustes (desenho SALÃO+PORÃO, 13/09/2026):
 * um título leve que agrupa seções vizinhas ("Sua loja", "Entrega",
 * "Ferramentas"). MESMO estilo do rótulo que já existia na tela — só
 * ganhou componente para não virar cópia em quatro lugares.
 */
function GrupoDeAjustes({
  titulo,
  children,
}: {
  readonly titulo: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/**
 * Indicador do painel "Como está sua loja" (desenho SALÃO+PORÃO). Espelho
 * PURO: ícone + rótulo curto + valor lido do que já existe — sem ação, sem
 * fetch novo, sem estado. O valor vem truncado: horário e nome de loja
 * longos não empurram os vizinhos do grid.
 *
 * `estado` (refinamento do dono, 13/09: acabamento premium do painel)
 * escolhe SÓ a paleta visual do tile — container do ícone tintado pelo
 * estado + dot de status na frente do rótulo (pulsa apenas em "vivo", o
 * único estado momentâneo). Não carrega julgamento de dado nenhum: o
 * VALOR e a COR do valor continuam sendo escolha do chamador no hub,
 * pelas mesmas fontes de antes.
 */
type EstadoDoIndicador = "vivo" | "problema" | "neutro" | "apagado";

// Paleta por estado do tile: container do ícone + dot do rótulo. Vivo e
// problema ganham glow fraco da própria cor; neutro dourado é o idioma do
// painel; apagado é vidro sem luz — nada a comemorar, nada a temer.
// Map + `.get` no mesmo padrão do ROTULO_DO_PIX/COR_DO_PIX abaixo: acesso
// por índice de variável (`Record[estado]`) acorda o object-injection do
// eslint, e o teto de warnings do repo não abre exceção para estilo.
const PALETA_NEUTRA = {
  container:
    "bg-admin-gold/10 text-admin-gold ring-admin-gold/20 shadow-[0_0_16px_-6px] shadow-admin-gold/40",
  dot: "bg-admin-gold",
};

const PALETA_DO_INDICADOR = new Map<
  EstadoDoIndicador,
  { readonly container: string; readonly dot: string }
>([
  [
    "vivo",
    {
      container:
        "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20 shadow-[0_0_16px_-6px] shadow-emerald-500/40",
      dot: "bg-emerald-400",
    },
  ],
  [
    "problema",
    {
      container:
        "bg-red-500/10 text-red-400 ring-red-500/20 shadow-[0_0_16px_-6px] shadow-red-500/40",
      dot: "bg-red-400",
    },
  ],
  ["neutro", PALETA_NEUTRA],
  [
    "apagado",
    { container: "bg-white/5 text-zinc-300 ring-white/10", dot: "bg-zinc-500" },
  ],
]);

function IndicadorDoPainel({
  icone: Icone,
  rotulo,
  valor,
  cor = "text-zinc-200",
  estado = "neutro",
}: {
  readonly icone: React.ElementType;
  readonly rotulo: string;
  readonly valor: string;
  readonly cor?: string;
  readonly estado?: EstadoDoIndicador;
}) {
  const paleta = PALETA_DO_INDICADOR.get(estado) ?? PALETA_NEUTRA;
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-xl ring-1 backdrop-blur-sm",
          paleta.container,
        )}
      >
        <Icone className="size-[18px]" strokeWidth={2.25} />
      </span>
      <span className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-[0.18em] text-zinc-500">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            paleta.dot,
            estado === "vivo" && "animate-pulse",
          )}
        />
        {rotulo}
      </span>
      <span className={cn("truncate text-sm font-bold leading-tight", cor)}>
        {valor}
      </span>
    </div>
  );
}

// ── Rótulos do painel de estado ─────────────────────────────────────────
// PIX tem TRÊS níveis, réplica do ROTULO do StatusPagamentoPix (linhas
// 55-59) — arquivo do Claude, fora da fronteira. O rascunho do desenho
// pedia "PIX ativo / não configurado" (2 rótulos) e o crítico de desenho
// do lote E vetou: com a chave pública ausente o pagamento está QUEBRADO
// (a tela de pagamento nem carrega) e "ativo" mentiria — a mesma mentira
// que o laudo 0109 (D1) combateu. E "desligado" é escolha da lojista
// (pagamento na entrega), não "não configurado". "Funcionando" só vale
// com `pagamentoOnlineLigado() && pixConfiguradoNoBuild(chave)`.
type NivelDoPix = "ok" | "alerta" | "off";

const ROTULO_DO_PIX = new Map<NivelDoPix, string>([
  ["ok", "Funcionando"],
  ["alerta", "Chave ausente"],
  ["off", "Desligado"],
]);

// Cores espelham o corDoRotulo do StatusPagamentoPix.
const COR_DO_PIX = new Map<NivelDoPix, string>([
  ["ok", "text-emerald-400"],
  ["alerta", "text-red-400"],
  ["off", "text-zinc-500"],
]);

// Estado VISUAL do tile do PIX no painel (paleta do IndicadorDoPainel),
// derivado do MESMO NivelDoPix: ok=vivo (dot pulsa), alerta=problema,
// off=apagado.
const ESTADO_DO_PIX = new Map<NivelDoPix, EstadoDoIndicador>([
  ["ok", "vivo"],
  ["alerta", "problema"],
  ["off", "apagado"],
]);

// Nome amigável do provedor de frete. O fallback de LEITURA é o mesmo do
// resto da tela (`config.shippingProvider || "flat_fee"`, como em
// TransportadorasCard e HistoricoCotacoesCard); valor fora dos 3 conhecidos
// (drift de banco) cai no ramo seguro em vez de imprimir lixo cru.
const NOME_DO_PROVEDOR_DE_FRETE = new Map<string, string>([
  ["flat_fee", "Sem cotação automática"],
  ["melhor_envio", "Melhor Envio"],
  ["frenet", "Frenet"],
]);

export const AdminSettingsView = memo(function AdminSettingsView({
  onNavigate,
  active,
  onSetDirty,
}: Readonly<AdminSettingsViewProps>) {
  const { config, isLoaded } = useStore();
  const isOffline = useOnlineStatus();
  const [showHelpModal, setShowHelpModal] = useState(false);
  // A seção de Transportadoras reporta se tem alteração não salva; enquanto
  // houver, ela não pode ser recolhida (fechar desmonta o conteúdo e
  // descartaria o token digitado — trava explicada no SecaoColapsavel).
  const [transportadorasPendentes, setTransportadorasPendentes] =
    useState(false);

  const [identidadePendente, setIdentidadePendente] = useState(false);
  const [horarioPendente, setHorarioPendente] = useState(false);

  // Espelha a soma das pendências para o App (onSetDirty = setIsAdminDirty):
  // é o que liga as guardas de beforeunload, diálogo de navegação e popstate
  // — mesmo contrato da tela de Frete (AdminShippingView).
  useEffect(() => {
    if (active !== false)
      onSetDirty?.(
        transportadorasPendentes || identidadePendente || horarioPendente,
      );
  }, [
    active,
    transportadorasPendentes,
    identidadePendente,
    horarioPendente,
    onSetDirty,
  ]);

  // Reset helper modals when tab becomes inactive
  useEffect(() => {
    if (active === false) {
      setShowHelpModal(false);
    }
  }, [active]);

  // ── Estado do PIX: MESMAS fontes do StatusPagamentoPix, avaliadas UMA
  // vez aqui no hub e compartilhadas pelo painel e pelo termômetro. O
  // contrato de pix-configurado-no-build exige este import cru DENTRO deste
  // arquivo (mesma regra do AdminDashboardView) — não extrair para
  // componente/arquivo novo sem atualizar aquele teste.
  const pixLigado = pagamentoOnlineLigado();
  const pixChaveOk = pixConfiguradoNoBuild(
    chavePublicaMercadoPago() ?? undefined,
  );
  const nivelDoPix: NivelDoPix = !pixLigado
    ? "off"
    : pixChaveOk
      ? "ok"
      : "alerta";
  const rotuloDoPix = ROTULO_DO_PIX.get(nivelDoPix) ?? "";

  const nomeDoFrete =
    NOME_DO_PROVEDOR_DE_FRETE.get(config.shippingProvider || "flat_fee") ??
    "Sem cotação automática";
  // Vazio após trim = não informado (string de espaços não é horário).
  const horarioSalvo = (config.businessHours ?? "").trim();
  const atendimentoDeRelacao =
    horarioSalvo === "" ? "não informado" : horarioSalvo;
  const nomeDaLoja = (config.storeName ?? "").trim() || "não informado";

  return (
    <div className="pb-admin h-auto bg-admin-bg duration-200 animate-in fade-in lg:pb-12">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader titulo="Ajustes">
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
              title="Guia de Configurações e Ajuda"
            >
              <HelpCircle className="size-4" />
            </button>
          </AdminPageHeader>
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
            {/* ── SALÃO, camada 1: o estado sem clicar (desenho
                SALÃO+PORÃO, 13/09/2026). Card destacado com acento
                dourado — é a resposta da pergunta "como está?". Espelho
                puro do que já existe; vive DENTRO do ramo isLoaded, porque
                indicador com config pela metade é indicador mentiroso
                (o de Frete diria "Sem cotação automática" numa loja
                Melhor Envio durante a carga). */}
            <section className="space-y-3 delay-75 duration-300 animate-in fade-in slide-in-from-bottom-2">
              <h2 className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Como está sua loja
              </h2>
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900/90 via-zinc-950/80 to-admin-gold/[0.06] p-4 shadow-2xl shadow-black/50 sm:p-5">
                <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-admin-gold/50 to-transparent" />
                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                  <IndicadorDoPainel
                    icone={Wifi}
                    rotulo="Conexão"
                    valor={isOffline ? "Offline" : "Online"}
                    cor={isOffline ? "text-red-400" : "text-emerald-400"}
                    estado={isOffline ? "problema" : "vivo"}
                  />
                  <IndicadorDoPainel
                    icone={Wallet}
                    rotulo="Pagamento"
                    valor={rotuloDoPix}
                    cor={COR_DO_PIX.get(nivelDoPix)}
                    estado={ESTADO_DO_PIX.get(nivelDoPix) ?? "apagado"}
                  />
                  <IndicadorDoPainel
                    icone={Truck}
                    rotulo="Frete"
                    valor={nomeDoFrete}
                    cor="text-white"
                    estado="neutro"
                  />
                  <IndicadorDoPainel
                    icone={Clock}
                    rotulo="Atendimento"
                    valor={atendimentoDeRelacao}
                    cor={horarioSalvo === "" ? "text-zinc-500" : "text-white"}
                    estado="apagado"
                  />
                </div>
              </div>
            </section>

            {/* ── SALÃO, camada 2: grupos com o que o lojista edita ── */}
            <GrupoDeAjustes titulo="Sua loja">
              {/* Atalhos de vitrine — versão compacta dos cartões; a porta
                  continua role="button" com onNavigate (o guard
                  porta-de-avisar-clientes clica em TODAS elas). */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-white/5 bg-zinc-950/40 p-4 shadow-xl transition-all duration-300 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
                >
                  <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold shadow-[0_2px_12px_-4px] shadow-admin-gold/25 ring-1 ring-admin-gold/20">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-admin-gold/[0.32] to-admin-gold/[0.10] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    />
                    <Palette
                      className="relative size-[18px]"
                      strokeWidth={2.25}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-black uppercase tracking-[0.2em] text-white">
                      Banners Promocionais
                    </h3>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                      Artes, links e agendamentos
                    </p>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-zinc-500 transition-colors duration-300 group-hover:text-admin-gold" />
                </div>

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
                  className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-white/5 bg-zinc-950/40 p-4 shadow-xl transition-all duration-300 hover:border-amber-500/30 hover:bg-zinc-900/30 active:scale-[0.98]"
                >
                  <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/[0.18] to-amber-500/[0.04] text-amber-500 shadow-[0_2px_12px_-4px] shadow-amber-500/25 ring-1 ring-amber-500/20">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-amber-500/[0.32] to-amber-500/[0.10] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    />
                    <Layers
                      className="relative size-[18px]"
                      strokeWidth={2.25}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-black uppercase tracking-[0.2em] text-white">
                      Vitrines (Carrosséis)
                    </h3>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                      Títulos, ordem e ativação
                    </p>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-zinc-500 transition-colors duration-300 group-hover:text-amber-500" />
                </div>
              </div>

              <SecaoColapsavel
                titulo="Nome, logo e cores"
                subtitulo={nomeDaLoja}
                icone={Palette}
                comPendencia={identidadePendente}
              >
                {/* Lugar reservado (desenho SALÃO+PORÃO): o endereço físico
                    da loja entra aqui, ao lado de Cidade/UF — peça do
                    Claude. NÃO criar stub. */}
                <Suspense
                  fallback={
                    <p className="text-sm text-zinc-400">
                      Carregando identidade…
                    </p>
                  }
                >
                  <IdentitySettingsSection
                    active={active}
                    onDirtyChange={setIdentidadePendente}
                  />
                </Suspense>
              </SecaoColapsavel>

              <SecaoColapsavel
                titulo="Atendimento"
                subtitulo={atendimentoDeRelacao}
                icone={Clock}
                comPendencia={horarioPendente}
              >
                <BusinessHoursSection
                  active={active}
                  onDirtyChange={setHorarioPendente}
                />
              </SecaoColapsavel>
            </GrupoDeAjustes>

            <GrupoDeAjustes titulo="Entrega">
              {/* Transportadoras e cotação de frete — MUDOU DE TELA (frente
                  glm-visual-admin-0209, pedido do Gabriel 02/09: não fazia
                  sentido o token da transportadora morar no meio das regras
                  de frete). Dona de `shippingProvider`,
                  `enabledShippingMethods` e das credenciais — salvar a tela
                  de Frete não toca nelas. COLAPSADA e nascida FECHADA: ajuste
                  raro, feito uma vez. */}
              <SecaoColapsavel
                titulo="Entrega e frete"
                subtitulo={`Ativo: ${nomeDoFrete}`}
                icone={Truck}
                comPendencia={transportadorasPendentes}
              >
                <TransportadorasSection
                  onDirtyMudou={setTransportadorasPendentes}
                />
              </SecaoColapsavel>

              {/* Lugar reservado (desenho SALÃO+PORÃO): o liga/desliga de
                  retirada na loja (`enabled_shipping_methods`) entra aqui —
                  peça do Claude. NÃO criar stub. */}
            </GrupoDeAjustes>

            {/*
              A porta "Avisar clientes" morou AQUI de 24/08 a 30/08/2026 e
              SAIU por decisão do Gabriel: o lugar dela é a tela de Clientes
              (componente CustomerBanners), ao lado de "Canais de
              Atendimento". O motivo que a trouxe para cá em 24/08 (zero
              portas visíveis para `admin-push` no celular) já não existe: o
              sino parou de escolher destino. O Voltar de `admin-push`
              continua sensível à origem (pai-da-tela-do-admin).
            */}

            {/* ── PORÃO: consulta rara e técnica, no pé da tela ── */}
            <GrupoDeAjustes titulo="Ferramentas">
              {/* Status de funcionamento — COLAPSADA por padrão (pedido do
                  Gabriel, 02/09: status é consulta rara, não porta de
                  trabalho; a tela abre mostrando o que o lojista edita). */}
              <SecaoColapsavel
                titulo="Minha loja está no ar?"
                subtitulo={`PIX: ${rotuloDoPix}`}
                icone={Activity}
              >
                <div className="space-y-3">
                  <StatusPagamentoPix ligado={pixLigado} chaveOk={pixChaveOk} />
                  <ConnectionDiagnosticsSection />
                </div>
              </SecaoColapsavel>

              {/* Histórico de cotações de frete — veio da tela de Frete na
                  frente glm-visual-admin-0209: registro técnico de
                  diagnóstico, consulta rara. Busca fresca a cada abertura
                  (a seção só monta quando expandida). */}
              <SecaoColapsavel
                titulo="Consultas de frete"
                subtitulo={`Ativo: ${nomeDoFrete}`}
                icone={History}
              >
                <HistoricoCotacoesSection />
              </SecaoColapsavel>
            </GrupoDeAjustes>
          </>
        )}
      </div>

      {/* Modal de Ajuda — mapa atualizado ao desenho SALÃO+PORÃO */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Configurações do Sistema"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Esta tela responde primeiro COMO ESTÁ a sua loja — conexão,
            pagamento por PIX, frete e horário de atendimento ficam à vista no
            painel do topo. O resto fica em três grupos: Sua loja, Entrega e
            Ferramentas. Cada seção abre com um clique.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Como está sua loja
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold ring-1 ring-admin-gold/20">
                    <Activity className="size-3.5" strokeWidth={2.25} />
                  </span>
                  Painel de estado
                </div>
                <p className="text-xs text-zinc-400">
                  Conexão com a internet, estado do PIX (Funcionando, Chave
                  ausente ou Desligado), frete ativo e horário de atendimento —
                  de relance, atualizado com o que já está salvo.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Sua loja
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold ring-1 ring-admin-gold/20">
                    <Palette className="size-3.5" strokeWidth={2.25} />
                  </span>
                  Banners e Vitrines
                </div>
                <p className="text-xs text-zinc-400">
                  Atalhos da vitrine: artes e agendamentos dos banners; títulos,
                  ordem e ativação dos carrosséis.
                </p>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold ring-1 ring-admin-gold/20">
                    <Clock className="size-3.5" strokeWidth={2.25} />
                  </span>
                  Nome, logo e cores · Atendimento
                </div>
                <p className="text-xs text-zinc-400">
                  Identidade da loja (nome, cidade/UF, logo, cores) e o horário
                  de atendimento que a vitrine mostra.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Entrega
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold ring-1 ring-admin-gold/20">
                    <Truck className="size-3.5" strokeWidth={2.25} />
                  </span>
                  Entrega e frete
                </div>
                <p className="text-xs text-zinc-400">
                  Escolha da transportadora, cotação automática e o token da
                  integração — ajuste raro, feito uma vez.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Ferramentas
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold ring-1 ring-admin-gold/20">
                    <Activity className="size-3.5" strokeWidth={2.25} />
                  </span>
                  Minha loja está no ar?
                </div>
                <p className="text-xs text-zinc-400">
                  Termômetro do pagamento por PIX com o diagnóstico completo, e
                  a medição de latência com o banco de dados do Supabase.
                </p>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold ring-1 ring-admin-gold/20">
                    <History className="size-3.5" strokeWidth={2.25} />
                  </span>
                  Consultas de frete
                </div>
                <p className="text-xs text-zinc-400">
                  Histórico das cotações já feitas à transportadora ativa —
                  registro técnico de diagnóstico.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
