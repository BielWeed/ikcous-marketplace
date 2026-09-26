import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { AtalhosDoInicio } from "@/components/admin/inicio/AtalhosDoInicio";
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { HojeNaLoja } from "@/components/admin/inicio/HojeNaLoja";
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import { PerfilDaLoja } from "@/components/admin/inicio/PerfilDaLoja";
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePainelInicio } from "@/hooks/usePainelInicio";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { pagamentoOnlineLigado } from "@/lib/flags";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { pixConfiguradoNoBuild } from "@/lib/pix-configurado-no-build";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { AlertCircle, HelpCircle, RefreshCw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminDashboardViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
}

/**
 * Ponte entre os dados vivos (useStore) e o componente PURO
 * LojaProntaEEstoqueBaixo. Separada do corpo do Início e SEMPRE renderizada
 * dentro de um <LocalErrorBoundary>: useStore lança se chamado fora de um
 * StoreProvider, e isolar a chamada aqui garante que essa falha derrube só
 * este cartão — nunca o Início inteiro.
 *
 * O número de "estoque baixo" vem de `painel_inicio().pendencias` (a mesma
 * leitura que alimenta o "Para fazer") — o Início não chama mais a RPC de
 * analytics do dashboard antigo, que foi para a aba Visão geral do CRM.
 */
function SecaoLojaProntaEEstoqueBaixo({
  estoqueBaixo,
  estoqueCarregando,
  onNavigate,
  onTentarDeNovo,
}: Readonly<{
  estoqueBaixo: number | null;
  estoqueCarregando: boolean;
  onNavigate: (view: View, id?: string) => void;
  onTentarDeNovo: () => void;
}>) {
  const { config, isLoaded, products, loadingProducts } = useStore();

  return (
    <LojaProntaEEstoqueBaixo
      stats={estoqueBaixo == null ? null : { inventoryAlerts: estoqueBaixo }}
      originCep={config.originCep}
      ligado={pagamentoOnlineLigado()}
      chaveOk={pixConfiguradoNoBuild(chavePublicaMercadoPago() ?? undefined)}
      produtos={products}
      configCarregando={!isLoaded}
      produtosCarregando={loadingProducts}
      estoqueCarregando={estoqueCarregando}
      onNavigate={onNavigate}
      onTentarDeNovo={onTentarDeNovo}
    />
  );
}

/** Mesma ideia da ponte acima: `useStore` isolado atrás do boundary. */
function PerfilDaLojaComDados({
  responsavel,
}: Readonly<{ responsavel: string | null }>) {
  const { config } = useStore();
  return (
    <PerfilDaLoja
      nome={nomeDaLoja(config)}
      logoUrl={config.logoUrl ?? null}
      cidade={config.storeCity ?? null}
      uf={config.storeState ?? null}
      responsavel={responsavel}
    />
  );
}

/**
 * Início do painel (rota `admin-dashboard`, a porta do painel): o perfil da
 * loja, o dinheiro de hoje e do mês, o que está pendente, a assinatura e os
 * dois botões grandes — Dashboard CRM (onde mora o dashboard de métricas que
 * era esta tela, intacto, na aba Visão geral) e Financeiro.
 */
export const AdminDashboardView = memo(function AdminDashboardView({
  onNavigate,
  active,
}: Readonly<AdminDashboardViewProps>) {
  const ativo = active ?? false;
  const { profile } = useAuth();
  const isOffline = useOnlineStatus();
  const { ref: viewRef } = useScrollRestoration("admin-dashboard", ativo);
  const { prefetchView } = usePrefetchOnHover();
  const {
    painel,
    assinatura,
    assinaturaLida,
    carregando,
    erro,
    erroAssinatura,
    atualizar,
  } = usePainelInicio(ativo);
  const [mostrarAjuda, setMostrarAjuda] = useState(false);

  const responsavel =
    typeof profile?.full_name === "string" && profile.full_name.trim() !== ""
      ? profile.full_name.trim()
      : null;

  // Voltou a conexão com a tela aberta: busca de novo (mesmo gesto do
  // dashboard antigo).
  const estavaOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (estavaOfflineRef.current && !isOffline && ativo) {
      toast.success("Conexão restabelecida. Atualizando o Início...", {
        icon: "⚡",
      });
      void atualizar();
    }
    estavaOfflineRef.current = isOffline;
  }, [isOffline, ativo, atualizar]);

  const semNumeros = carregando && !painel;

  return (
    <div
      ref={viewRef}
      className="pb-admin h-auto bg-[#09090b] text-white selection:bg-emerald-500/30 lg:pb-12"
    >
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <AdminPageHeader
          titulo="Início"
          acoes={
            <button
              type="button"
              disabled={carregando || isOffline}
              onClick={() => void atualizar()}
              className="group flex min-h-11 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:bg-white/10 disabled:opacity-50 sm:px-6 sm:py-3"
              aria-label="Sincronizar os números do Início"
            >
              <RefreshCw
                className={cn(
                  "size-4 text-zinc-400 transition-transform duration-700 group-hover:rotate-180",
                  carregando && "animate-spin",
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
            title="Como ler o Início"
            aria-label="Como ler o Início"
          >
            <HelpCircle className="size-4.5" aria-hidden="true" />
          </button>
          <PontoDeOperacao sincronizando={carregando} />
        </AdminPageHeader>
      </div>

      <div className="mt-4 space-y-4 px-4 sm:space-y-6 sm:px-6">
        <LocalErrorBoundary
          fallback={
            <PerfilDaLoja
              nome={nomeDaLoja(null)}
              logoUrl={null}
              cidade={null}
              uf={null}
              responsavel={responsavel}
            />
          }
        >
          <PerfilDaLojaComDados responsavel={responsavel} />
        </LocalErrorBoundary>

        {erro && !carregando ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-300"
          >
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-xs">{erro}</p>
            <button
              type="button"
              onClick={() => void atualizar()}
              className="flex min-h-11 shrink-0 items-center rounded-xl border border-red-500/20 px-3 text-[10px] font-black uppercase tracking-wider text-red-300 transition-colors hover:bg-red-500/10"
            >
              Tentar de novo
            </button>
          </div>
        ) : null}

        {/* Celular: uma coluna na ordem de leitura (Hoje → botões → mês →
            pendências → 14 dias → assinatura). Computador: duas colunas
            alinhadas por linha — a ordem do DOM continua a de leitura. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <LocalErrorBoundary>
              <HojeNaLoja hoje={painel?.hoje ?? null} carregando={semNumeros} />
            </LocalErrorBoundary>
          </div>
          <div className="lg:col-start-3 lg:row-start-1">
            <AtalhosDoInicio
              onNavigate={onNavigate}
              aoPrepararDestino={prefetchView}
            />
          </div>
          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <LocalErrorBoundary>
              <NumerosDoMes
                painel={painel}
                carregando={semNumeros}
                onNavigate={onNavigate}
              />
            </LocalErrorBoundary>
          </div>
          <div className="lg:col-start-3 lg:row-start-2">
            <LocalErrorBoundary>
              <ParaFazer
                painel={painel}
                carregando={semNumeros}
                onNavigate={onNavigate}
              />
            </LocalErrorBoundary>
          </div>
          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
            <LocalErrorBoundary>
              <SerieDe14Dias
                serie={painel?.serie14d ?? []}
                carregando={semNumeros}
              />
            </LocalErrorBoundary>
          </div>
          <div className="lg:col-start-3 lg:row-start-3">
            <LocalErrorBoundary>
              <CartaoDaAssinatura
                assinatura={assinatura}
                lida={assinaturaLida}
                carregando={carregando}
                erro={erroAssinatura}
                onTentarDeNovo={() => void atualizar()}
              />
            </LocalErrorBoundary>
          </div>
        </div>

        {/* Estoque baixo + checklist "loja pronta para vender" */}
        <LocalErrorBoundary>
          <SecaoLojaProntaEEstoqueBaixo
            estoqueBaixo={painel?.pendencias.estoqueBaixo ?? null}
            estoqueCarregando={semNumeros}
            onNavigate={onNavigate}
            onTentarDeNovo={() => void atualizar()}
          />
        </LocalErrorBoundary>
      </div>

      <AdminHelpModal
        isOpen={mostrarAjuda}
        onClose={() => setMostrarAjuda(false)}
        title="Como ler o Início"
      >
        <div className="space-y-4 text-xs leading-relaxed text-zinc-400">
          <p>
            O Início é o resumo do dia da sua loja — app e balcão juntos. Os
            números contam só o dinheiro que entrou de verdade (PIX confirmado,
            pagamento online aprovado ou recebido na mão).
          </p>
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-white">Hoje:</strong> quanto entrou hoje,
              quanto veio do app e quanto do balcão, comparado com o mesmo dia
              da semana passada.
            </li>
            <li>
              <strong className="text-white">Lucro estimado:</strong> a receita
              do mês menos o custo cadastrado dos produtos vendidos. Produto sem
              custo cadastrado conta custo zero.
            </li>
            <li>
              <strong className="text-white">
                Saldo em contas e a receber:
              </strong>{" "}
              vêm do Financeiro (caixa, banco e Mercado Pago).
            </li>
            <li>
              <strong className="text-white">Para fazer:</strong> cada linha
              leva direto à tela que resolve a pendência.
            </li>
            <li>
              <strong className="text-white">Assinatura:</strong> o plano é
              administrado fora do app; aqui ele só é exibido.
            </li>
          </ul>
          <p>
            As métricas completas (o antigo Dashboard, clientes, canais e funil)
            ficam no botão <strong className="text-white">Dashboard CRM</strong>
            .
          </p>
        </div>
      </AdminHelpModal>
    </div>
  );
});
