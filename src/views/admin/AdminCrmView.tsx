import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { AjudaDoCrm } from "@/components/admin/crm/AjudaDoCrm";
import { CanaisDoCrm } from "@/components/admin/crm/CanaisDoCrm";
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import { FunilEPedidosDoCrm } from "@/components/admin/crm/FunilEPedidosDoCrm";
import { VisaoGeralDoCrm } from "@/components/admin/crm/VisaoGeralDoCrm";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { useCrmVisao, useDashboardClassico } from "@/hooks/useCrm";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { PERIODOS_DO_CRM, intervaloDoPeriodo } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PeriodoDoCrm, SegmentoCrm } from "@/types/crm";
import { AlertCircle, HelpCircle, RefreshCw } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

interface AdminCrmViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

type AbaDoCrm = "visao" | "clientes" | "canais" | "funil";

const ABAS: readonly { readonly id: AbaDoCrm; readonly rotulo: string }[] = [
  { id: "visao", rotulo: "Visão geral" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "canais", rotulo: "Canais" },
  { id: "funil", rotulo: "Funil e pedidos" },
];

/**
 * Dashboard CRM (`admin-crm`): gestão do app E da loja física num só lugar.
 * Chips de período fixos no topo alimentam `crm_visao`; as abas são Visão
 * geral (8 números + o dashboard que era o Início, intacto), Clientes (RFM),
 * Canais e Funil e pedidos. Aba visitada fica montada (escondida) para não
 * perder busca, página nem gráfico ao ir e voltar.
 */
export function AdminCrmView({ onNavigate, active }: AdminCrmViewProps) {
  const ativo = active ?? false;
  const isOffline = useOnlineStatus();
  const { ref: viewRef } = useScrollRestoration("admin-crm", ativo);
  const [periodo, setPeriodo] = useState<PeriodoDoCrm>("30d");
  const [aba, setAba] = useState<AbaDoCrm>("visao");
  const [abasMontadas, setAbasMontadas] = useState<ReadonlySet<AbaDoCrm>>(
    () => new Set<AbaDoCrm>(["visao"]),
  );
  const [segmento, setSegmento] = useState<SegmentoCrm | null>(null);
  const [sinalDeAtualizacao, setSinalDeAtualizacao] = useState(0);
  const [mostrarAjuda, setMostrarAjuda] = useState(false);
  const abasRef = useRef(new Map<AbaDoCrm, HTMLButtonElement>());

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo), [periodo]);
  const comparacao =
    PERIODOS_DO_CRM.find((p) => p.id === periodo)?.comparacao ??
    "vs. período anterior";

  const {
    visao,
    carregando,
    erro,
    atualizar: atualizarVisao,
  } = useCrmVisao(intervalo, ativo);
  const classico = useDashboardClassico(ativo, atualizarVisao);
  const { carregar: carregarClassico } = classico;
  const sincronizando = carregando || classico.carregando;

  const trocarAba = useCallback((nova: AbaDoCrm) => {
    setAba(nova);
    setAbasMontadas((montadas) =>
      montadas.has(nova) ? montadas : new Set([...montadas, nova]),
    );
  }, []);

  const verSegmento = useCallback(
    (novo: SegmentoCrm) => {
      setSegmento(novo);
      trocarAba("clientes");
    },
    [trocarAba],
  );

  const sincronizar = useCallback(() => {
    atualizarVisao();
    void carregarClassico(true);
    setSinalDeAtualizacao((n) => n + 1);
  }, [atualizarVisao, carregarClassico]);

  // Voltou a conexão com a tela aberta: busca tudo de novo.
  const estavaOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (estavaOfflineRef.current && !isOffline && ativo) {
      toast.success("Conexão restabelecida. Atualizando o CRM...", {
        icon: "⚡",
      });
      sincronizar();
    }
    estavaOfflineRef.current = isOffline;
  }, [isOffline, ativo, sincronizar]);

  // Setas/Home/End na fileira de abas (padrão WAI-ARIA de tabs).
  const aoTeclarNasAbas = (evento: KeyboardEvent<HTMLButtonElement>) => {
    const atual = ABAS.findIndex((a) => a.id === aba);
    let proxima = atual;
    if (evento.key === "ArrowRight") proxima = (atual + 1) % ABAS.length;
    else if (evento.key === "ArrowLeft")
      proxima = (atual - 1 + ABAS.length) % ABAS.length;
    else if (evento.key === "Home") proxima = 0;
    else if (evento.key === "End") proxima = ABAS.length - 1;
    else return;
    evento.preventDefault();
    const destino = ABAS.at(proxima);
    if (!destino) return;
    trocarAba(destino.id);
    abasRef.current.get(destino.id)?.focus();
  };

  return (
    <div
      ref={viewRef}
      className="pb-admin h-auto bg-[#09090b] text-white selection:bg-emerald-500/30 lg:pb-12"
    >
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <AdminPageHeader
          titulo="Dashboard CRM"
          acoes={
            <button
              type="button"
              disabled={sincronizando || isOffline}
              onClick={sincronizar}
              className="group flex min-h-11 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:bg-white/10 disabled:opacity-50 sm:px-6 sm:py-3"
              aria-label="Sincronizar os números do CRM"
            >
              <RefreshCw
                className={cn(
                  "size-4 text-zinc-400 transition-transform duration-700 group-hover:rotate-180",
                  sincronizando && "animate-spin",
                )}
                aria-hidden="true"
              />
              <span className="hidden text-[10px] font-black uppercase tracking-widest text-zinc-400 sm:inline">
                Sincronizar
              </span>
            </button>
          }
        >
          <button
            type="button"
            onClick={() => setMostrarAjuda(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
            title="Guia de Ajuda e Informações"
            aria-label="Guia de Ajuda e Informações"
          >
            <HelpCircle className="size-4.5" aria-hidden="true" />
          </button>
          <PontoDeOperacao sincronizando={sincronizando} />
        </AdminPageHeader>
      </div>

      {/* Barra fixa: abas + período. Filha direta do bloco que rola, para o
          sticky andar junto com a tela inteira. */}
      <div className="sticky top-0 z-30 mt-2 border-b border-white/5 bg-[#09090b]/95 backdrop-blur-md">
        <div className="flex flex-col gap-2 py-2.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div
            role="tablist"
            aria-label="Seções do CRM"
            className="custom-scrollbar-hidden flex gap-1 overflow-x-auto px-4 sm:px-6 lg:px-0"
          >
            {ABAS.map((item) => {
              const selecionada = item.id === aba;
              return (
                <button
                  key={item.id}
                  ref={(no) => {
                    if (no) abasRef.current.set(item.id, no);
                    else abasRef.current.delete(item.id);
                  }}
                  type="button"
                  role="tab"
                  id={`crm-aba-${item.id}`}
                  aria-selected={selecionada}
                  aria-controls={`crm-painel-${item.id}`}
                  tabIndex={selecionada ? 0 : -1}
                  onClick={() => trocarAba(item.id)}
                  onKeyDown={aoTeclarNasAbas}
                  className={cn(
                    "min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3.5 text-xs font-black uppercase tracking-wider transition-colors",
                    selecionada
                      ? "bg-white text-black"
                      : "text-zinc-400 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {item.rotulo}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Período"
            className="custom-scrollbar-hidden flex gap-1.5 overflow-x-auto px-4 sm:px-6 lg:px-0"
          >
            {PERIODOS_DO_CRM.map((item) => {
              const escolhido = item.id === periodo;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={escolhido}
                  onClick={() => setPeriodo(item.id)}
                  className={cn(
                    "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[11px] font-bold transition-colors",
                    escolhido
                      ? "border-admin-gold/50 bg-admin-gold/15 text-admin-gold"
                      : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-white",
                  )}
                >
                  {item.rotulo}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4 px-4 sm:mt-6 sm:px-6">
        {erro && !carregando ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-300"
          >
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-xs">{erro}</p>
            <button
              type="button"
              onClick={atualizarVisao}
              className="flex min-h-11 shrink-0 items-center rounded-xl border border-red-500/20 px-3 text-[10px] font-black uppercase tracking-wider transition-colors hover:bg-red-500/10"
            >
              Tentar de novo
            </button>
          </div>
        ) : null}

        {ABAS.filter((item) => abasMontadas.has(item.id)).map((item) => {
          const visivel = item.id === aba;
          return (
            <div
              key={item.id}
              role="tabpanel"
              id={`crm-painel-${item.id}`}
              aria-labelledby={`crm-aba-${item.id}`}
              hidden={!visivel}
            >
              <LocalErrorBoundary>
                {item.id === "visao" ? (
                  <VisaoGeralDoCrm
                    visao={visao}
                    carregando={carregando}
                    comparacao={comparacao}
                    classico={classico}
                    active={ativo && visivel}
                    onNavigate={onNavigate}
                    aoVerSegmento={verSegmento}
                  />
                ) : item.id === "clientes" ? (
                  <ClientesDoCrm
                    segmentos={visao?.segmentos ?? []}
                    carregandoSegmentos={carregando}
                    segmento={segmento}
                    aoMudarSegmento={setSegmento}
                    active={ativo && visivel}
                    onNavigate={onNavigate}
                    sinalDeAtualizacao={sinalDeAtualizacao}
                  />
                ) : item.id === "canais" ? (
                  <CanaisDoCrm
                    visao={visao}
                    carregando={carregando}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <FunilEPedidosDoCrm
                    visao={visao}
                    carregando={carregando}
                    onNavigate={onNavigate}
                  />
                )}
              </LocalErrorBoundary>
            </div>
          );
        })}
      </div>

      <AjudaDoCrm
        isOpen={mostrarAjuda}
        onClose={() => setMostrarAjuda(false)}
      />
    </div>
  );
}
