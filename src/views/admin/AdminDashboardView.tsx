import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { AtalhosDoInicio } from "@/components/admin/inicio/AtalhosDoInicio";
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { CartaoDeAvisosDoAparelho } from "@/components/admin/inicio/CartaoDeAvisosDoAparelho";
import { HojeNaLoja } from "@/components/admin/inicio/HojeNaLoja";
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import { PerfilDaLoja } from "@/components/admin/inicio/PerfilDaLoja";
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import {
  ACAO_PRINCIPAL_INICIO,
  BOTAO_INICIO,
  CARTAO_INICIO,
} from "@/components/admin/inicio/visualDoInicio";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { buildIdentity } from "@/config/buildIdentity";
import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePainelInicio } from "@/hooks/usePainelInicio";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { formatarInteiro } from "@/lib/crm";
import { pagamentoOnlineLigado } from "@/lib/flags";
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { pixConfiguradoNoBuild } from "@/lib/pix-configurado-no-build";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { AlertCircle, HelpCircle, Package, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
  somenteBoasVindas,
}: Readonly<{
  estoqueBaixo: number | null;
  estoqueCarregando: boolean;
  onNavigate: (view: View, id?: string) => void;
  onTentarDeNovo: () => void;
  somenteBoasVindas?: boolean;
}>) {
  const { config, isLoaded, products, loadingProducts } = useStore();

  return (
    <LojaProntaEEstoqueBaixo
      stats={estoqueBaixo == null ? null : { inventoryAlerts: estoqueBaixo }}
      config={config}
      ligado={pagamentoOnlineLigado()}
      chaveOk={pixConfiguradoNoBuild(chavePublicaMercadoPago() ?? undefined)}
      // Mesma normalização de AdminSettingsView e CheckoutView: ausente ou
      // corrompido cai no padrão das três formas.
      formasNaEntrega={formasPagamentoNaEntregaValidas(
        config.formasPagamentoEntrega,
      )}
      produtos={products}
      configCarregando={!isLoaded}
      produtosCarregando={loadingProducts}
      estoqueCarregando={estoqueCarregando}
      onNavigate={onNavigate}
      onTentarDeNovo={onTentarDeNovo}
      somenteBoasVindas={somenteBoasVindas}
    />
  );
}

/**
 * Mesma ideia da ponte acima: `useStore` isolado atrás do boundary.
 *
 * A imagem é o ÍCONE DO APP (papel `icon_192`, o mesmo do pin do mapa em
 * "Sobre a loja" e da tela inicial do celular), não a logo larga do
 * cabeçalho: pedido do dono (28/09), porque a logo-palavra "SAVY",
 * transparente e escura, sumia no quadrado escuro deste cartão. O ícone vem
 * quadrado, com fundo próprio e por loja — `buildIdentity` é a ficha que o
 * porteiro escreve para o host aberto (`icon_192` é obrigatório nela). Se a
 * imagem falhar, o `PerfilDaLoja` mostra a inicial.
 */
function PerfilDaLojaComDados({
  responsavel,
}: Readonly<{ responsavel: string | null }>) {
  const { config } = useStore();
  return (
    <PerfilDaLoja
      nome={nomeDaLoja(config)}
      logoUrl={buildIdentity.localUrls.icon_192}
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

  // O cartão de avisos se fecha com o foco do teclado dentro dele: o foco vai
  // para o título do Início, e não para o corpo da página.
  const focarNoTitulo = useCallback(() => {
    const titulo = viewRef.current?.querySelector("h1");
    if (titulo instanceof HTMLElement) {
      titulo.tabIndex = -1;
      // Título já à vista: o foco não deve rolar a página (um pulo à toa). Fora
      // da tela, deixa o navegador trazê-lo para onde a pessoa possa ver.
      const caixa = titulo.getBoundingClientRect();
      const aVista = caixa.top >= 0 && caixa.bottom <= window.innerHeight;
      titulo.focus(aVista ? { preventScroll: true } : undefined);
    }
  }, [viewRef]);

  const semNumeros = carregando && !painel;

  return (
    <div
      ref={viewRef}
      className="pb-admin h-auto bg-admin-bg text-white selection:bg-emerald-500/30 lg:pb-12"
    >
      <div className="px-5 pt-6 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-x-6">
        <div className="flex flex-wrap items-center justify-between gap-3 [&_h1]:normal-case [&_h1]:tracking-tight [&_h1_span]:not-italic">
          <AdminPageHeader
            titulo={NOMES_DO_PAINEL["admin-dashboard"]}
            acoes={
              <>
                <button
                  type="button"
                  disabled={carregando || isOffline}
                  onClick={() => void atualizar()}
                  className="flex min-h-11 items-center gap-2 rounded-2xl border border-teal-300/15 bg-teal-300/5 px-3 text-sm font-semibold text-teal-300 transition-colors hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 disabled:opacity-50"
                  aria-label="Sincronizar os números do Início"
                >
                  <RefreshCw
                    className={cn("size-5", carregando && "animate-spin")}
                    aria-hidden="true"
                  />
                  Sincronizar
                </button>
                <button
                  type="button"
                  onClick={() => setMostrarAjuda(true)}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                  title="Como ler o Início"
                  aria-label="Como ler o Início"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 items-center justify-center rounded-full border border-violet-300/15 bg-violet-300/10 text-violet-300"
                  >
                    <HelpCircle className="size-5" aria-hidden="true" />
                  </span>
                </button>
              </>
            }
          />
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
          <PontoDeOperacao sincronizando={carregando} />
          <span>
            {isOffline
              ? "Sem internet · os valores podem estar desatualizados"
              : carregando
                ? "Atualizando sua loja…"
                : erro
                  ? "Não foi possível atualizar os números"
                  : "Conectado"}
          </span>
        </div>
        <div className="mt-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:max-w-md">
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
        </div>
      </div>

      <div className="space-y-7 px-5 pt-7">
        {erro && !carregando ? (
          <div role="alert" className={`${CARTAO_INICIO} space-y-3`}>
            <div className="flex items-start gap-3">
              <AlertCircle
                className="mt-1 size-5 shrink-0 text-pink-300"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-base font-bold text-white">
                  Não foi possível ler os números
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                  {erro}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void atualizar()}
              className={BOTAO_INICIO}
            >
              <RefreshCw className="size-5" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        ) : null}

        {/* A ordem de leitura do celular também ordena as três colunas do computador. */}
        <div className="space-y-7 lg:grid lg:grid-cols-3 lg:items-start lg:gap-6 lg:space-y-0">
          <div className="min-w-0 space-y-7">
            {painel?.mes.pedidos === 0 &&
            painel.hoje.pedidos === 0 &&
            painel.pendencias.pedidosParaPreparar === 0 ? (
              <LocalErrorBoundary>
                <SecaoLojaProntaEEstoqueBaixo
                  estoqueBaixo={painel.pendencias.estoqueBaixo}
                  estoqueCarregando={semNumeros}
                  onNavigate={onNavigate}
                  onTentarDeNovo={() => void atualizar()}
                  somenteBoasVindas
                />
              </LocalErrorBoundary>
            ) : null}
            <LocalErrorBoundary>
              <HojeNaLoja
                hoje={painel?.hoje ?? null}
                carregando={semNumeros}
                acaoPrincipal={
                  (painel?.pendencias.pedidosParaPreparar ?? 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => onNavigate("admin-orders")}
                      className={ACAO_PRINCIPAL_INICIO}
                    >
                      <Package className="size-5 shrink-0" aria-hidden="true" />
                      Preparar{" "}
                      {formatarInteiro(painel?.pendencias.pedidosParaPreparar)}{" "}
                      {painel?.pendencias.pedidosParaPreparar === 1
                        ? "pedido"
                        : "pedidos"}
                    </button>
                  ) : null
                }
              />
            </LocalErrorBoundary>
            <LocalErrorBoundary>
              <ParaFazer
                painel={painel}
                carregando={semNumeros}
                onNavigate={onNavigate}
                preparoEmDestaque
              />
            </LocalErrorBoundary>
            {/* Montar só à vista preserva a releitura da permissão do aparelho. */}
            {ativo ? (
              <LocalErrorBoundary>
                <CartaoDeAvisosDoAparelho aoFechar={focarNoTitulo} />
              </LocalErrorBoundary>
            ) : null}
          </div>
          <div className="min-w-0 space-y-7">
            <AtalhosDoInicio
              ativa={ativo}
              onNavigate={onNavigate}
              aoPrepararDestino={prefetchView}
            />
            <LocalErrorBoundary>
              <NumerosDoMes
                painel={painel}
                carregando={semNumeros}
                onNavigate={onNavigate}
              />
            </LocalErrorBoundary>
            <LocalErrorBoundary>
              <SerieDe14Dias
                serie={painel?.serie14d ?? []}
                carregando={semNumeros}
                falhou={painel === null && erro !== null}
                onTentarDeNovo={() => void atualizar()}
              />
            </LocalErrorBoundary>
          </div>
          <div className="min-w-0 space-y-7">
            <LocalErrorBoundary>
              <CartaoDaAssinatura
                assinatura={assinatura}
                lida={assinaturaLida}
                carregando={carregando}
                erro={erroAssinatura}
                onTentarDeNovo={() => void atualizar()}
              />
            </LocalErrorBoundary>
            <LocalErrorBoundary>
              <SecaoLojaProntaEEstoqueBaixo
                estoqueBaixo={painel?.pendencias.estoqueBaixo ?? null}
                estoqueCarregando={semNumeros}
                onNavigate={onNavigate}
                onTentarDeNovo={() => void atualizar()}
              />
            </LocalErrorBoundary>
          </div>
        </div>
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
              <strong className="text-white">Vendas pagas hoje:</strong> quanto
              entrou hoje, quanto veio do app e quanto do balcão, comparado com
              o mesmo dia da semana passada até esta mesma hora.
            </li>
            <li>
              <strong className="text-white">Lucro estimado:</strong> o
              resultado do Financeiro no mês — o que entrou, menos estornos e
              devoluções, o custo cadastrado dos produtos vendidos e as despesas
              lançadas (mesmo as ainda não pagas). Produto sem custo cadastrado
              conta custo zero.
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
            ficam no botão{" "}
            <strong className="text-white">
              {NOMES_DO_PAINEL["admin-crm"]}
            </strong>
            .
          </p>
        </div>
      </AdminHelpModal>
    </div>
  );
});
