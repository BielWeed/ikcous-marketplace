import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AjudaDoCrm } from "@/components/admin/crm/AjudaDoCrm";
import { CanaisDoCrm } from "@/components/admin/crm/CanaisDoCrm";
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import { FunilEPedidosDoCrm } from "@/components/admin/crm/FunilEPedidosDoCrm";
import {
  FOCO_DO_CRM,
  SUPERFICIE_DO_CRM,
} from "@/components/admin/crm/PecasDoCrm";
import { VisaoGeralDoCrm } from "@/components/admin/crm/VisaoGeralDoCrm";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useCrmVisao, useDashboardClassico } from "@/hooks/useCrm";
import { instanteDoDia, useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import {
  PERIODOS_DO_CRM,
  comparacaoDoPeriodo,
  formatarIntervaloCurto,
  intervaloDoPeriodo,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PeriodoDoCrm, SegmentoCrm } from "@/types/crm";
import { ChevronDown, HelpCircle, RefreshCw } from "lucide-react";
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

/**
 * `rotuloCurto` só existe onde o rótulo completo não cabe na grade de 4
 * colunas do celular (print do Gabriel, 27/09: "FUNIL E PEDIDOS" cortava);
 * a partir de `sm` o rótulo completo volta a aparecer (ver render abaixo).
 * O nome acessível (`aria-label`) é sempre o rótulo completo, mas ele
 * sempre COMEÇA pelo `rotuloCurto` visível ("Visão" → "Visão geral", "Funil"
 * → "Funil e pedidos") — é o que a re-revisão pediu para não violar WCAG
 * 2.5.3 (Label in Name): quem dita por voz o que lê na tela tem de achar o
 * controle.
 */
const ABAS: readonly {
  readonly id: AbaDoCrm;
  readonly rotulo: string;
  readonly rotuloCurto?: string;
}[] = [
  { id: "visao", rotulo: "Visão geral", rotuloCurto: "Visão" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "canais", rotulo: "Canais" },
  { id: "funil", rotulo: "Funil e pedidos", rotuloCurto: "Funil" },
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

  // O intervalo de "Hoje"/"7 dias"/"30 dias"… é contado a partir do DIA de
  // hoje, que acompanha o relógio: tela aberta (ou voltando do segundo plano)
  // depois da meia-noite recalcula o intervalo e busca de novo.
  const dia = useDiaDeSaoPaulo(ativo);
  const intervalo = useMemo(
    () => intervaloDoPeriodo(periodo, instanteDoDia(dia)),
    [periodo, dia],
  );
  const comparacao = comparacaoDoPeriodo(periodo, intervalo);

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
      // `overflow-x-clip`, não `overflow-x-hidden`: rede de segurança contra
      // rolagem lateral (achado do dono, 28/09/2026 — a tela do CRM
      // transbordava 56-64px por causa de um enfeite `absolute` com
      // deslocamento negativo dentro de um cartão, corrigido na origem em
      // TopProductsList.tsx). `overflow-x-hidden` criaria um novo contêiner
      // de rolagem e quebraria o `sticky` da barra de abas/período (o
      // acoplamento overflow-x/overflow-y do CSS vira `overflow-y: auto`
      // computado); `clip` não tem esse acoplamento.
      className="pb-admin h-auto overflow-x-clip bg-admin-bg text-white selection:bg-emerald-500/30 lg:pb-12"
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-6 sm:gap-4 sm:px-6">
        <AdminPageHeader
          titulo={NOMES_DO_PAINEL["admin-crm"]}
          tituloEncolhe
          acoes={
            <button
              type="button"
              disabled={sincronizando || isOffline}
              onClick={sincronizar}
              className="group flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-full border border-solid border-admin-border bg-admin-surface p-2 transition-all hover:bg-admin-raised disabled:opacity-50 sm:px-4"
              aria-label="Sincronizar os números do CRM"
            >
              <RefreshCw
                className={cn(
                  "size-4 text-zinc-400 transition-transform duration-700 group-hover:rotate-180",
                  sincronizando && "animate-spin",
                )}
                aria-hidden="true"
              />
              <span className="hidden text-[11px] font-black uppercase tracking-widest text-zinc-400 sm:inline">
                Sincronizar
              </span>
            </button>
          }
        >
          <button
            type="button"
            onClick={() => setMostrarAjuda(true)}
            className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95"
            title="Guia de Ajuda e Informações"
            aria-label="Guia de Ajuda e Informações"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full border border-solid border-admin-border bg-admin-surface text-zinc-500 transition-all duration-300 group-hover:border-admin-border-strong group-hover:text-white"
            >
              <HelpCircle className="size-4.5" aria-hidden="true" />
            </span>
          </button>
        </AdminPageHeader>
      </div>
      <p className="text-admin-text-soft px-4 text-xs sm:px-6">
        Vendas pagas · app e balcão
      </p>

      {/* Barra fixa: abas + período. Filha direta do bloco que rola, para o
          sticky andar junto com a tela inteira. Os dois controles vivem num
          trilho segmentado (`SUPERFICIE_DO_CRM`, a mesma superfície dos
          cartões de KPI, com p-1) — sem uma superfície tão visível quanto a
          deles, abas e período viravam "palavras soltas" sobre o fundo escuro do painel.
          Até 1023px o trilho é uma GRADE de colunas iguais (nada de
          `overflow-x-auto`): as 4 abas e os 6 períodos cabem inteiros sem
          rolar nem cortar texto (print do Gabriel, 27/09, no celular). A
          partir de `lg` volta a virar fileira (`lg:flex`) — mas com
          `lg:flex-wrap`: a barra lateral do admin (`aside` de 256px a partir
          de `lg`, `AdminLayout.tsx`) come parte da largura, e entre 1024 e
          ~1131px a fileira completa não cabe (achado da re-revisão, medido:
          o trilho de período estourava a tela em 1100px). Com `flex-wrap` o
          período desce para a 2ª linha só nessa faixa estreita; em 1280/1440
          continua tudo numa linha só, idêntico a antes. */}
      <div className="sticky top-0 z-30 mt-2 border-b border-admin-border bg-admin-bg/95 backdrop-blur-md">
        <div className="flex flex-col gap-2 pb-2 pt-1 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:px-6">
          <div
            role="tablist"
            aria-label="Seções do CRM"
            className={cn(
              SUPERFICIE_DO_CRM,
              "mx-4 grid grid-cols-4 gap-1 rounded-[18px] p-1 sm:mx-6 lg:mx-0 lg:flex lg:w-auto",
            )}
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
                  aria-label={item.rotulo}
                  tabIndex={selecionada ? 0 : -1}
                  onClick={() => trocarAba(item.id)}
                  onKeyDown={aoTeclarNasAbas}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-xl px-1 text-center text-[13px] font-bold transition-colors lg:w-auto lg:shrink-0 lg:px-3.5",
                    FOCO_DO_CRM,
                    selecionada
                      ? "bg-admin-gold-fill text-admin-gold-ink shadow"
                      : "text-zinc-400 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {item.rotuloCurto ? (
                    <>
                      <span className="sm:hidden" aria-hidden="true">
                        {item.rotuloCurto}
                      </span>
                      <span className="hidden sm:inline" aria-hidden="true">
                        {item.rotulo}
                      </span>
                    </>
                  ) : (
                    item.rotulo
                  )}
                </button>
              );
            })}
          </div>

          {aba !== "clientes" && (
            <div className="px-4 sm:px-6 lg:ml-auto lg:px-0">
              <div
                role="group"
                aria-label="Período"
                className={cn(
                  SUPERFICIE_DO_CRM,
                  "grid grid-cols-5 gap-0.5 p-1 lg:flex",
                )}
              >
                {PERIODOS_DO_CRM.filter((item) =>
                  ["hoje", "7d", "30d", "mes"].includes(item.id),
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={periodo === item.id}
                    onClick={() => setPeriodo(item.id)}
                    className={cn(
                      "flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl border border-solid px-0 text-xs font-semibold lg:px-3",
                      FOCO_DO_CRM,
                      periodo === item.id
                        ? "border-admin-gold bg-admin-gold/15 text-admin-gold"
                        : "border-transparent text-admin-text-2",
                    )}
                  >
                    {item.rotulo}
                  </button>
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Mais períodos"
                      aria-pressed={periodo === "90d" || periodo === "ano"}
                      className={cn(
                        "flex min-h-11 items-center justify-center rounded-xl border border-solid text-xs font-semibold lg:px-3",
                        FOCO_DO_CRM,
                        periodo === "90d" || periodo === "ano"
                          ? "border-admin-gold bg-admin-gold/15 text-admin-gold"
                          : "border-transparent text-admin-text-2",
                      )}
                    >
                      {periodo === "90d"
                        ? "90 dias"
                        : periodo === "ano"
                          ? "Ano"
                          : "Mais"}
                      <ChevronDown
                        className="hidden size-3 min-[360px]:inline"
                        aria-hidden="true"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PERIODOS_DO_CRM.filter(
                      (item) => item.id === "90d" || item.id === "ano",
                    ).map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onSelect={() => setPeriodo(item.id)}
                        className="min-h-11"
                      >
                        {item.rotulo}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-4 px-4 sm:px-6">
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
                    intervalo={formatarIntervaloCurto(intervalo)}
                    erro={erro}
                    offline={isOffline}
                    aoTentar={atualizarVisao}
                    classico={classico}
                    active={ativo && visivel}
                    onNavigate={onNavigate}
                    aoVerSegmento={verSegmento}
                  />
                ) : item.id === "clientes" ? (
                  <ClientesDoCrm
                    erro={erro}
                    aoTentar={atualizarVisao}
                    segmentosDisponiveis={visao != null}
                    offline={isOffline}
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
                    erro={erro}
                    offline={isOffline}
                    aoTentar={atualizarVisao}
                    visao={visao}
                    carregando={carregando}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <FunilEPedidosDoCrm
                    erro={erro}
                    offline={isOffline}
                    aoTentar={atualizarVisao}
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
