import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
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
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useCrmVisao, useDashboardClassico } from "@/hooks/useCrm";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import {
  PERIODOS_DO_CRM,
  formatarIntervaloCurto,
  intervaloDoPeriodo,
} from "@/lib/crm";
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
      // `overflow-x-clip`, não `overflow-x-hidden`: rede de segurança contra
      // rolagem lateral (achado do dono, 28/09/2026 — a tela do CRM
      // transbordava 56-64px por causa de um enfeite `absolute` com
      // deslocamento negativo dentro de um cartão, corrigido na origem em
      // TopProductsList.tsx). `overflow-x-hidden` criaria um novo contêiner
      // de rolagem e quebraria o `sticky` da barra de abas/período (o
      // acoplamento overflow-x/overflow-y do CSS vira `overflow-y: auto`
      // computado); `clip` não tem esse acoplamento.
      className="pb-admin h-auto overflow-x-clip bg-[#09090b] text-white selection:bg-emerald-500/30 lg:pb-12"
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
              className="group flex min-h-11 items-center gap-3 rounded-2xl border border-solid border-white/10 bg-white/5 px-4 py-2 transition-all hover:bg-white/10 disabled:opacity-50 sm:px-6 sm:py-3"
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
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-solid border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
            title="Guia de Ajuda e Informações"
            aria-label="Guia de Ajuda e Informações"
          >
            <HelpCircle className="size-4.5" aria-hidden="true" />
          </button>
          <PontoDeOperacao sincronizando={sincronizando} />
        </AdminPageHeader>
      </div>

      {/* Barra fixa: abas + período. Filha direta do bloco que rola, para o
          sticky andar junto com a tela inteira. Os dois controles vivem num
          trilho segmentado (`SUPERFICIE_DO_CRM`, a mesma superfície dos
          cartões de KPI, com p-1) — sem uma superfície tão visível quanto a
          deles, abas e período viravam "palavras soltas" sobre o #09090b.
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
      <div className="sticky top-0 z-30 mt-2 border-b border-white/5 bg-[#09090b]/95 backdrop-blur-md">
        <div className="flex flex-col gap-1.5 py-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-2 lg:px-6 lg:py-2">
          <div
            role="tablist"
            aria-label="Seções do CRM"
            className={cn(
              SUPERFICIE_DO_CRM,
              "mx-4 grid grid-cols-4 gap-1 p-1 sm:mx-6 lg:mx-0 lg:flex lg:w-auto",
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
                    "flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg px-1 text-center text-[11px] font-bold transition-colors lg:w-auto lg:shrink-0 lg:px-3.5 lg:text-xs lg:font-black lg:uppercase lg:tracking-wider",
                    FOCO_DO_CRM,
                    selecionada
                      ? "bg-white text-black shadow"
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

          {/* `lg:ml-auto` empurra o bloco para a direita mesmo quando o
              `lg:flex-wrap` acima o joga para a 2ª linha sozinho — nessa
              hora `justify-between` do pai não tem mais um segundo item na
              mesma linha para "empurrar" contra. */}
          <div className="flex flex-col gap-1 px-4 sm:px-6 lg:ml-auto lg:items-end lg:px-0">
            <div
              role="group"
              aria-label="Período"
              className={cn(
                SUPERFICIE_DO_CRM,
                "grid grid-cols-6 gap-1 p-1 lg:flex lg:w-auto",
              )}
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
                      "flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg border border-solid px-1 text-center text-[11px] font-bold transition-colors lg:w-auto lg:shrink-0 lg:px-3.5",
                      FOCO_DO_CRM,
                      escolhido
                        ? "border-admin-gold/40 bg-admin-gold/15 text-admin-gold"
                        : "border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {item.rotulo}
                  </button>
                );
              })}
            </div>
            {/* Datas do intervalo escolhido e contra o que ele compara —
                sem isso, "Mês" ou "90 dias" não dizem quais dias entram. */}
            <p className="px-1 text-[11px] leading-snug text-zinc-400">
              <span className="font-semibold tabular-nums text-zinc-300">
                {formatarIntervaloCurto(intervalo)}
              </span>{" "}
              · {comparacao}
            </p>
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
              className="flex min-h-11 shrink-0 items-center rounded-xl border border-solid border-red-500/20 px-3 text-[10px] font-black uppercase tracking-wider transition-colors hover:bg-red-500/10"
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
