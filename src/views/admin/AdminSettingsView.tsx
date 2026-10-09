import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  CreditCard,
  HelpCircle,
  Layers,
  Palette,
  RefreshCw,
  RotateCcw,
  Store,
  Truck,
  Wifi,
} from "lucide-react";
import { Suspense, lazy, memo, useEffect, useState } from "react";

import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { FormasDePagamentoSection } from "@/components/admin/settings/FormasDePagamentoCard";
import { PoliticaDeDevolucaoSection } from "@/components/admin/settings/PoliticaDeDevolucaoSection";
import {
  type ConfigDoProvedor,
  NOME_DO_PROVEDOR,
  PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR,
  type ProvedorFrete,
  buscarConfiguracaoDeFrete,
  emailDeContatoValido,
} from "@/components/admin/settings/TransportadorasCard";
import {
  type ChaveDoGrupoDeAjustes,
  GRUPOS_DE_AJUSTES,
  type PortaDoGrupoDeAjustes,
  subtitulosDosGrupos,
} from "@/components/admin/settings/grupos-de-ajustes";
import { Skeleton } from "@/components/ui/skeleton";
import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { NOMES_DO_PAINEL, type TelaDoPainel } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { pagamentoOnlineLigado } from "@/lib/flags";
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
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

// Peça 20 (14/09/2026): chaves do Mercado Pago do lojista + guia com prompt
// pronto + teste de conexão — conteúdo inteiro mora no próprio componente
// (junto do arquivo de conteúdo do guia); aqui só a porta.
const MercadoPagoSection = lazy(() =>
  import("@/components/admin/settings/MercadoPagoSection").then((module) => ({
    default: module.MercadoPagoSection,
  })),
);

// ==========================================
// Diagnóstico de Conexão (G7b, painel simples): o resultado é uma frase —
// conexão boa, lenta ou sem internet — com o que fazer; os números (ms e
// tentativas sem resposta) ficam num detalhe, para quem quiser.
// ==========================================
type ResultadoDaConexao = "boa" | "lenta" | "sem-internet";

interface MedidaDaConexao {
  /** Tempo médio de resposta em ms; `null` = nenhuma tentativa respondeu. */
  readonly media: number | null;
  readonly minima: number | null;
  readonly maxima: number | null;
  readonly falhas: number;
  readonly tentativas: number;
}

// Mesmo corte de antes (abaixo de 250 ms era "Excelente"/"Moderado"); uma
// tentativa sem resposta já é conexão lenta (antes: "Instabilidade
// Detectada").
function resultadoDaConexao(medida: MedidaDaConexao): ResultadoDaConexao {
  if (medida.media === null) return "sem-internet";
  if (medida.falhas > 0 || medida.media >= 250) return "lenta";
  return "boa";
}

const PALAVRAS_DA_CONEXAO = new Map<
  ResultadoDaConexao,
  { readonly titulo: string; readonly frase: string; readonly cor: string }
>([
  [
    "boa",
    {
      titulo: "Conexão boa",
      frase: "A loja responde rápido neste aparelho.",
      cor: "text-emerald-400",
    },
  ],
  [
    "lenta",
    {
      titulo: "Conexão lenta",
      frase:
        "A loja demora (ou às vezes não responde) neste aparelho. Se o painel travar, tente outra rede: Wi-Fi ou dados móveis.",
      cor: "text-amber-400",
    },
  ],
  [
    "sem-internet",
    {
      titulo: "Sem internet",
      frase:
        "Este aparelho não conseguiu falar com a loja. Confira o Wi-Fi ou os dados móveis e teste de novo.",
      cor: "text-red-400",
    },
  ],
]);

const ConnectionDiagnosticsSection = memo(
  function ConnectionDiagnosticsSection() {
    const [isOpen, setIsOpen] = useState(true);
    const [testando, setTestando] = useState(false);
    const [medida, setMedida] = useState<MedidaDaConexao | null>(null);

    const handleTestConnectivity = async () => {
      setTestando(true);
      setMedida(null);

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

      const temResposta = pings.length > 0;
      setMedida({
        media: temResposta
          ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)
          : null,
        minima: temResposta ? Math.round(Math.min(...pings)) : null,
        maxima: temResposta ? Math.round(Math.max(...pings)) : null,
        falhas: failed,
        tentativas: totalTests,
      });
      setTestando(false);
    };

    const palavras = medida
      ? PALAVRAS_DA_CONEXAO.get(resultadoDaConexao(medida))
      : undefined;

    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
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
            strokeWidth={2.25}
            className={cn(
              "size-5 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300",
              isOpen && "rotate-180",
            )}
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
                <div className="flex flex-col gap-3">
                  <p className="text-left text-[11px] leading-snug text-zinc-400">
                    Teste se a internet deste aparelho chega bem até a sua loja.
                    Ajuda a saber se uma lentidão do painel vem da sua rede.
                  </p>

                  {testando ? (
                    <div
                      aria-hidden="true"
                      className="h-16 animate-pulse rounded-xl bg-white/5"
                    />
                  ) : medida && palavras ? (
                    <div
                      role="status"
                      className="space-y-1.5 rounded-xl border border-white/5 bg-zinc-950/40 p-3"
                    >
                      <p className={cn("text-sm font-black", palavras.cor)}>
                        {palavras.titulo}
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-400">
                        {palavras.frase}
                      </p>
                      <details className="text-[11px] text-zinc-500">
                        <summary className="min-h-11 cursor-pointer select-none py-2 font-bold text-zinc-400">
                          Ver os números
                        </summary>
                        <ul className="space-y-0.5">
                          {medida.media !== null && (
                            <>
                              <li>
                                Tempo médio de resposta: {medida.media} ms
                              </li>
                              <li>
                                Mais rápida: {medida.minima} ms · mais lenta:{" "}
                                {medida.maxima} ms
                              </li>
                            </>
                          )}
                          <li>
                            Tentativas sem resposta: {medida.falhas} de{" "}
                            {medida.tentativas}
                          </li>
                        </ul>
                      </details>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">
                      Ainda não testada neste aparelho.
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={testando}
                      onClick={handleTestConnectivity}
                      className="flex min-h-11 select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3.5 text-[11px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-amber-500/30 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <RefreshCw
                        className={cn(
                          "size-3 text-amber-500",
                          testando && "animate-spin",
                        )}
                      />
                      <span>
                        {testando ? "Testando…" : "Testar a conexão agora"}
                      </span>
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
 * título ("Formas de pagamento — 3 na entrega"). Mora DENTRO do <button>
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
  abrirGatilho,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo?: string;
  readonly icone: React.ElementType;
  readonly comPendencia?: boolean;
  /**
   * FORMAS DE PAGAMENTO POR LOJA (25/09/2026): incrementa de FORA (um botão
   * de outra seção — "Formas de pagamento" abrindo "Mercado Pago", sem
   * duplicar o switch que exige credencial) para forçar esta seção a abrir.
   * Efeito colateral, não estado controlado: continua sendo a própria seção
   * quem manda no clique normal do cabeçalho (fechar continua funcionando).
   */
  readonly abrirGatilho?: number;
  readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    if (abrirGatilho !== undefined && abrirGatilho > 0) setAberta(true);
    // Só reage a um NOVO pedido de abrir (gatilho subiu) — nunca ao
    // clique/pendência internos, que já têm o próprio caminho acima.
  }, [abrirGatilho]);

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
              <span className="block truncate text-[11px] font-medium normal-case tracking-normal text-zinc-500">
                {subtitulo}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {aberta && comPendencia && (
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">
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

// Ícone de cada porta (o nome e a rota vêm de GRUPOS_DE_AJUSTES). Map + `.get`:
// índice de variável acorda o object-injection do eslint. Guarda o ELEMENTO pronto, não o componente: um
// componente tirado do Map no render dispara react-hooks/static-components.
const CLASSE_DO_ICONE_DA_PORTA = "relative size-[18px]";
const ICONE_DA_PORTA = new Map<TelaDoPainel, React.ReactNode>([
  [
    "admin-about-store",
    <Store key="s" className={CLASSE_DO_ICONE_DA_PORTA} strokeWidth={2.25} />,
  ],
  [
    "admin-banners",
    <Palette key="p" className={CLASSE_DO_ICONE_DA_PORTA} strokeWidth={2.25} />,
  ],
  [
    "admin-carousels",
    <Layers key="l" className={CLASSE_DO_ICONE_DA_PORTA} strokeWidth={2.25} />,
  ],
  [
    "admin-shipping",
    <Truck key="t" className={CLASSE_DO_ICONE_DA_PORTA} strokeWidth={2.25} />,
  ],
]);

const GRUPO_POR_CHAVE = new Map(GRUPOS_DE_AJUSTES.map((g) => [g.chave, g]));

/**
 * Cartão-porta de um grupo: leva a outra tela do painel. Continua
 * role="button" com onNavigate (o guard `ajustes-grupos-e-portas` clica em
 * TODAS elas); o nome vem de NOMES_DO_PAINEL, a linha de apoio da constante.
 */
function PortaDeAjustes({
  porta,
  onNavigate,
}: {
  readonly porta: PortaDoGrupoDeAjustes;
  readonly onNavigate: (view: View) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(porta.tela)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(porta.tela);
        }
      }}
      className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-white/5 bg-zinc-950/40 p-4 shadow-xl transition-all duration-300 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
    >
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-admin-gold/[0.18] to-admin-gold/[0.04] text-admin-gold shadow-[0_2px_12px_-4px] shadow-admin-gold/25 ring-1 ring-admin-gold/20">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-admin-gold/[0.32] to-admin-gold/[0.10] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        {ICONE_DA_PORTA.get(porta.tela)}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-xs font-black uppercase tracking-[0.2em] text-white">
          {NOMES_DO_PAINEL[porta.tela]}
        </h3>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
          {porta.descricao}
        </p>
      </div>
      <ArrowUpRight className="size-4 shrink-0 text-zinc-500 transition-colors duration-300 group-hover:text-admin-gold" />
    </div>
  );
}

/**
 * Grupo da tela de Ajustes (desenho SALÃO+PORÃO, 13/09/2026; seis grupos
 * fixos desde o painel simples, 09/10/2026). O título e as portas vêm de
 * GRUPOS_DE_AJUSTES pela `chave` — a ajuda lê a mesma constante. Os
 * acordeões do grupo entram como `children`, depois das portas.
 *
 * `subtitulos` (E5): a linha de estado sob o título ("Falta: WhatsApp"),
 * vinda de `subtitulosDosGrupos` (a mesma função dos seis passos). Grupo sem
 * entrada no mapa não desenha a linha. É um `<p>` irmão do `<h2>`: o título
 * do grupo continua sendo só o nome.
 */
function GrupoDeAjustes({
  chave,
  onNavigate,
  subtitulos,
  children,
}: {
  readonly chave: ChaveDoGrupoDeAjustes;
  readonly onNavigate: (view: View) => void;
  readonly subtitulos: ReadonlyMap<ChaveDoGrupoDeAjustes, string>;
  readonly children?: React.ReactNode;
}) {
  const grupo = GRUPO_POR_CHAVE.get(chave);
  if (!grupo) return null;
  const subtitulo = subtitulos.get(chave);
  return (
    <section
      id={`grupo-de-ajustes-${chave}`}
      className="scroll-mt-24 space-y-3"
    >
      <h2 className="px-1 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
        {grupo.titulo}
      </h2>
      {subtitulo && (
        <p className="-mt-1 px-1 text-xs font-medium text-zinc-300">
          {subtitulo}
        </p>
      )}
      {grupo.portas.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {grupo.portas.map((porta) => (
            <PortaDeAjustes
              key={porta.tela}
              porta={porta}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Indicador "Conexão" do grupo Ferramentas (desenho SALÃO+PORÃO; o cartão de
 * quatro indicadores onde ele nasceu saiu em 09/10/2026 — só este sobrou).
 * Espelho PURO: ícone + rótulo curto + valor lido do que já existe — sem
 * ação, sem fetch novo, sem estado.
 *
 * `estado` escolhe SÓ a paleta visual do tile — container do ícone tintado
 * pelo estado + dot de status na frente do rótulo (pulsa apenas em "vivo", o
 * único estado momentâneo). Não carrega julgamento de dado nenhum: o VALOR e
 * a COR do valor continuam sendo escolha do chamador.
 */
type EstadoDoIndicador = "vivo" | "problema";

// Paleta por estado do tile: container do ícone + dot do rótulo, com glow
// fraco da própria cor.
const PALETA_VIVA = {
  container:
    "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20 shadow-[0_0_16px_-6px] shadow-emerald-500/40",
  dot: "bg-emerald-400",
};
const PALETA_DE_PROBLEMA = {
  container:
    "bg-red-500/10 text-red-400 ring-red-500/20 shadow-[0_0_16px_-6px] shadow-red-500/40",
  dot: "bg-red-400",
};

function IndicadorDoPainel({
  icone: Icone,
  rotulo,
  valor,
  cor = "text-zinc-200",
  estado,
}: {
  readonly icone: React.ElementType;
  readonly rotulo: string;
  readonly valor: string;
  readonly cor?: string;
  readonly estado: EstadoDoIndicador;
}) {
  const paleta = estado === "vivo" ? PALETA_VIVA : PALETA_DE_PROBLEMA;
  return (
    <div className="flex min-h-11 min-w-0 flex-col gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-xl ring-1 backdrop-blur-sm",
          paleta.container,
        )}
      >
        <Icone className="size-[18px]" strokeWidth={2.25} />
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">
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

// ── Nível do PIX ────────────────────────────────────────────────────────
// TRÊS níveis, os mesmos do termômetro (StatusPagamentoPix). O rascunho do
// desenho pedia "PIX ativo / não configurado" (2 rótulos) e o crítico de
// desenho do lote E vetou: com a chave pública ausente o pagamento está
// QUEBRADO (a tela de pagamento nem carrega) e "ativo" mentiria — a mesma
// mentira que o laudo 0109 (D1) combateu. E "desligado" é escolha da
// lojista (pagamento na entrega), não "não configurado". "Funcionando" só
// vale com `pagamentoOnlineLigado() && pixConfiguradoNoBuild(chave)`. O
// rótulo em si só o termômetro escreve (H6: o status do PIX aparece uma vez);
// aqui o nível alimenta o subtítulo do grupo Pagamentos.
type NivelDoPix = "ok" | "alerta" | "off";

export const AdminSettingsView = memo(function AdminSettingsView({
  onNavigate,
  active,
  onSetDirty,
}: Readonly<AdminSettingsViewProps>) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Peça 20: mesma trava das demais — chave digitada e não salva não pode
  // sumir num clique no cabeçalho da seção.
  const [pagamentosPendente, setPagamentosPendente] = useState(false);

  // FORMAS DE PAGAMENTO POR LOJA (25/09/2026): mesma trava, seção PRÓPRIA
  // (cada switch salva sozinho — a pendência aqui é só "uma gravação está
  // em voo", pelo mesmo motivo que a trava existe: fechar no meio de um
  // salvamento em curso não pode desmontar o componente por baixo dele).
  const [formasPagamentoPendente, setFormasPagamentoPendente] = useState(false);
  // Devoluções (plano 2026-09-26): mesma trava — política editada e não
  // salva não some num clique no cabeçalho da seção.
  const [politicaDevolucaoPendente, setPoliticaDevolucaoPendente] =
    useState(false);
  // Contador que só CRESCE: o botão "Configurar credenciais" da seção nova
  // incrementa para abrir a seção Mercado Pago de fora (SecaoColapsavel
  // continua dona do próprio fechar).
  const [abrirMercadoPagoGatilho, setAbrirMercadoPagoGatilho] = useState(0);

  // Espelha a soma das pendências para o App (onSetDirty = setIsAdminDirty):
  // é o que liga as guardas de beforeunload, diálogo de navegação e popstate
  // — mesmo contrato da tela de Frete (AdminShippingView). Identidade e
  // horário saíram desta soma em 22/09/2026: os acordeões duplicados desta
  // tela foram removidos — a edição (e a pendência dela) mora só em
  // AdminAboutStoreView agora. As Transportadoras saíram em 09/10/2026 (H5):
  // a pendência do token é somada pela tela de Frete, onde a seção mora.
  useEffect(() => {
    if (active !== false)
      onSetDirty?.(
        pagamentosPendente ||
          formasPagamentoPendente ||
          politicaDevolucaoPendente,
      );
  }, [
    active,
    pagamentosPendente,
    formasPagamentoPendente,
    politicaDevolucaoPendente,
    onSetDirty,
  ]);

  // Reset helper modals when tab becomes inactive
  useEffect(() => {
    if (active === false) {
      setShowHelpModal(false);
    }
  }, [active]);

  // ── Estado do PIX: MESMAS fontes do StatusPagamentoPix, avaliadas UMA
  // vez aqui no hub e compartilhadas pelo subtítulo de Pagamentos e pelo
  // termômetro no topo do grupo Pagamentos — o ÚNICO status do PIX da tela
  // (H6, painel simples; antes ele se repetia em "Minha loja está no ar?",
  // em "Formas de pagamento" e no bloco do Mercado Pago). O
  // contrato de pix-configurado-no-build exige este import cru DENTRO deste
  // arquivo (mesma regra do AdminDashboardView) — não extrair para
  // componente/arquivo novo sem atualizar aquele teste.
  //
  // mp-9: `pagamentoOnlineLigado()` é o retrato SÍNCRONO da ficha injetada
  // no BOOT da página. Salvar, testar, Pausar e Retomar (MercadoPagoSection,
  // logo abaixo) escrevem `store_config.pagamento_online` pela edge e devolvem
  // o estado GRAVADO — sem este eco, a mesma tela mostrava dois estados do
  // dinheiro (subtítulo de Pagamentos e termômetro presos no valor velho)
  // até um recarregamento completo, enquanto a própria seção dizia "a
  // vitrine reflete em até 1 minuto". Estado LOCAL da sessão de
  // propósito: a ficha global (configuracaoDaLoja) não se reescreve em
  // memória, e a vitrine segue com o atraso do cache do porteiro.
  const [pixLigado, setPixLigado] = useState(() => pagamentoOnlineLigado());
  // Também estado local: `ligar_pix` só devolve ligado com a Public Key
  // publicada na ficha junto (edge, mp-8), então o eco de "ligado" também
  // acende a chave — senão o painel trocaria "Desligado" por um alarme
  // vermelho falso até o próximo reload (ressalva da revisão de mp-9).
  const [pixChaveOk, setPixChaveOk] = useState(() =>
    pixConfiguradoNoBuild(chavePublicaMercadoPago() ?? undefined),
  );
  const nivelDoPix: NivelDoPix = !pixLigado
    ? "off"
    : pixChaveOk
      ? "ok"
      : "alerta";

  // "Ver o PIX em Pagamentos" (Minha loja está no ar?): abre a seção do
  // Mercado Pago (o mesmo gatilho de "Configurar credenciais") e rola até o
  // termômetro, no topo do grupo.
  const irParaOPixEmPagamentos = () => {
    setAbrirMercadoPagoGatilho((n) => n + 1);
    setTimeout(() => {
      document
        .getElementById("grupo-de-ajustes-pagamentos")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  // FORMAS DE PAGAMENTO POR LOJA (25/09/2026): ausente/inválido cai nas 3
  // (mesma regra de tratamento de config velha/corrompida que o resto do
  // app usa — loja de ontem não muda de comportamento sozinha).
  const formasNaEntrega = formasPagamentoNaEntregaValidas(
    config.formasPagamentoEntrega,
  );

  // RELEASE 1.5.7 v2 (EMENDA R2, R2-5): quem está ligado vem da MESMA edge
  // que a seção de Transportadoras usa (`ler_configuracao_frete`) — nunca
  // do espelho `config.shippingProvider`, que no modo multi não decide mais
  // nada (R1-3/R2-1). `null` = ainda não sabemos (leitura em curso ou
  // falhou); o subtítulo de "Entrega e frete" não chuta nesse meio-tempo.
  const [ligadosDeFrete, setLigadosDeFrete] = useState<
    readonly ProvedorFrete[] | null
  >(null);
  // Achado 2 (revisão Opus, rodada 2): guarda o `Map` de provedores junto
  // com `ligados` — sem ele não dá para saber se um provedor ligado está
  // de fato COMPLETO (a SuperFrete precisa de `contato_email` válido;
  // mesma régua da tela de Frete). Um provedor "ligado" mas incompleto
  // não pode aparecer aqui como se estivesse cotando de verdade.
  const [provedoresDeFrete, setProvedoresDeFrete] = useState<
    ReadonlyMap<ProvedorFrete, ConfigDoProvedor>
  >(() => new Map());
  // A leitura roda CADA VEZ que a aba Ajustes fica ativa (H5, painel
  // simples): as Transportadoras moram na tela de Frete agora, e Ajustes é
  // aba mantida montada — salvar a transportadora lá e voltar aqui não pode
  // deixar o subtítulo de "Entrega e frete" contando a leitura velha. Só a
  // leitura da vez em curso escreve (`vivo`): uma resposta atrasada de uma
  // ida anterior não sobrescreve a nova.
  useEffect(() => {
    if (active === false) return;
    let vivo = true;
    buscarConfiguracaoDeFrete().then((resultado) => {
      if (!vivo) return;
      setLigadosDeFrete(resultado.ok ? resultado.config.ligados : null);
      if (resultado.ok) setProvedoresDeFrete(resultado.config.provedores);
    });
    return () => {
      vivo = false;
    };
  }, [active]);

  // Transportadoras com cotação REAL ligada, só com o que esta tela JÁ leu
  // (nenhuma chamada nova): ligada, com chave salva e — quando o provedor
  // exige — e-mail de contato válido. Mesma régua da tela de Frete
  // (`provedoresNacional`). `null` = a leitura ainda não chegou.
  const nomesLigadosDeFrete =
    ligadosDeFrete === null
      ? null
      : ligadosDeFrete
          .filter((p) => {
            const salvo = provedoresDeFrete.get(p);
            const incompleta =
              PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(p) &&
              !emailDeContatoValido(salvo?.contato_email);
            return (salvo?.tem_chave ?? false) && !incompleta;
          })
          .map((p) => NOME_DO_PROVEDOR.get(p) ?? p);

  // O subtítulo de status de cada grupo — a mesma função dos seis passos do
  // Início (grupos-de-ajustes.ts); aqui só se entregam os fatos.
  const subtitulos = subtitulosDosGrupos({
    config,
    formasNaEntrega,
    nivelDoPix,
    nomesLigados: nomesLigadosDeFrete,
  });

  return (
    <div className="pb-admin h-auto bg-admin-bg duration-200 animate-in fade-in lg:pb-12">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-white/5 bg-admin-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-settings"]}>
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
            {/* ── Os grupos com o que o lojista edita. O cartão "Como está
                sua loja" (4 indicadores) SAIU em 09/10/2026 (painel simples,
                E5): o estado de cada grupo é a linha sob o título dele,
                calculada pela mesma função dos seis passos do Início.
                Vive DENTRO do ramo isLoaded, porque estado com config pela
                metade é estado mentiroso. ── */}
            {/* Minha loja: porta única para a edição de marca, endereço,
                horário e descrição (pedido do dono, 20/09/2026). "Nome, logo
                e cores" e "Atendimento" — os dois acordeões que moravam
                aqui — SAÍRAM em 22/09/2026: eram duplicados de
                AdminAboutStoreView, que já monta os MESMOS componentes
                (IdentitySettingsSection, BusinessHoursSection) com o mesmo
                contrato de salvamento. A edição existe só lá; o atalho para
                lá é o cartão deste grupo. */}
            <GrupoDeAjustes
              chave="minha-loja"
              onNavigate={onNavigate}
              subtitulos={subtitulos}
            />

            {/* Aparência do app: Banners e Vitrines — só portas. */}
            <GrupoDeAjustes
              chave="aparencia"
              onNavigate={onNavigate}
              subtitulos={subtitulos}
            />

            {/* Entrega e frete: só a PORTA para a tela de Frete e o
                subtítulo do grupo (H5, painel simples, 09/10/2026). As
                Transportadoras e as Consultas de frete, que moravam aqui em
                acordeões, foram para a tela de Frete — o frete mora num lugar
                só. */}
            <GrupoDeAjustes
              chave="entrega"
              onNavigate={onNavigate}
              subtitulos={subtitulos}
            />

            {/* ── Pagamentos (peça 20, pedido do dono 14/09 por voz): o
                lojista cadastra as chaves do Mercado Pago dele — guia com
                prompt pronto para o agente de IA do app do MP, salvar e
                testar conexão ali mesmo. Desde a mp-9 o que Salvar, Testar,
                Pausar e Retomar gravam volta por `onPixAlternado` para o
                subtítulo deste grupo e para o termômetro — era a mesma tela
                contando dois estados do dinheiro. Nascida FECHADA como as
                demais: ajuste feito uma vez. */}
            <GrupoDeAjustes
              chave="pagamentos"
              onNavigate={onNavigate}
              subtitulos={subtitulos}
            >
              {/* O termômetro do PIX no TOPO do grupo: o ÚNICO status do PIX
                  da tela (H6, painel simples, P2 aprovada). "Minha loja está
                  no ar?", "Formas de pagamento" e o bloco do Mercado Pago
                  deixaram de repetir o estado — cada um aponta para cá ou só
                  traz a ação (Pausar/Retomar). */}
              <StatusPagamentoPix ligado={pixLigado} chaveOk={pixChaveOk} />

              {/* FORMAS DE PAGAMENTO POR LOJA (25/09/2026, migration
                  20261174000000): ANTES do Mercado Pago (pedido explícito do
                  brief) — a lojista decide primeiro O QUE aceita na
                  entrega/retirada, e só depois mexe nas credenciais do
                  pagamento pelo app. Nascida FECHADA como as demais. */}
              <SecaoColapsavel
                titulo="Formas de pagamento"
                subtitulo={`${formasNaEntrega.length} na entrega`}
                icone={Banknote}
                comPendencia={formasPagamentoPendente}
              >
                <FormasDePagamentoSection
                  formasNaEntrega={formasNaEntrega}
                  pixLigado={pixLigado}
                  pixChaveOk={pixChaveOk}
                  isOffline={isOffline}
                  updateConfig={updateConfig}
                  onDirtyMudou={setFormasPagamentoPendente}
                  onAbrirMercadoPago={() =>
                    setAbrirMercadoPagoGatilho((n) => n + 1)
                  }
                />
              </SecaoColapsavel>

              <SecaoColapsavel
                titulo="Mercado Pago"
                subtitulo="Chaves do seu Mercado Pago no app"
                icone={CreditCard}
                comPendencia={pagamentosPendente}
                abrirGatilho={abrirMercadoPagoGatilho}
              >
                <Suspense
                  fallback={
                    <p className="text-sm text-zinc-400">
                      Carregando Mercado Pago…
                    </p>
                  }
                >
                  <MercadoPagoSection
                    onDirtyMudou={setPagamentosPendente}
                    onPixAlternado={(ligado, chaveNaLoja) => {
                      setPixLigado(ligado);
                      // `chaveNaLoja` só vem preenchido no eco do `ler`
                      // (mp-10): é o único dos quatro que NÃO garante chave
                      // publicada quando `ligado` é `true` — `ler` devolve o
                      // retrato cru da ficha (`pagamento_online`), que pode
                      // estar ligada com a Public Key ausente (teste X6).
                      // Com o dado do servidor em mãos, usamos ELE; sem ele
                      // (eco de `ligar_pix`/`salvar`, que a edge só acende
                      // com a chave publicada JUNTO — mp-8), a inferência
                      // antiga continua válida: ligado -> chave OK. Sem esta
                      // distinção o painel acendia "Funcionando" com o PIX
                      // quebrado assim que o lojista abria esta seção
                      // (achado BLOQUEIA da revisão de mp-10).
                      if (chaveNaLoja !== undefined) {
                        setPixChaveOk(chaveNaLoja);
                      } else if (ligado) {
                        setPixChaveOk(true);
                      }
                    }}
                  />
                </Suspense>
              </SecaoColapsavel>
            </GrupoDeAjustes>

            {/* ── Regras de troca e devolução (antes "Pós-venda"; plano 2026-09-26, seção "Devoluções"; P3 do
                AGENTS.md): a política de trocas e devoluções de CADA loja —
                prazos (com os mínimos da lei), formas de devolver e o texto
                que o cliente lê. Nascida FECHADA como as demais. */}
            <GrupoDeAjustes
              chave="devolucao"
              onNavigate={onNavigate}
              subtitulos={subtitulos}
            >
              <SecaoColapsavel
                titulo="Trocas e devoluções"
                subtitulo="Prazos, formas de devolver e a política da loja"
                icone={RotateCcw}
                comPendencia={politicaDevolucaoPendente}
              >
                <PoliticaDeDevolucaoSection
                  isOffline={isOffline}
                  onDirtyMudou={setPoliticaDevolucaoPendente}
                />
              </SecaoColapsavel>
            </GrupoDeAjustes>

            {/*
              A porta "Avisar clientes" morou AQUI de 24/08 a 30/08/2026 e
              SAIU por decisão do Gabriel: o lugar dela é a tela de Clientes
              (hoje o `AtalhosDaAba` de Clientes). O motivo que a trouxe para cá em 24/08 (zero
              portas visíveis para `admin-push` no celular) já não existe: o
              sino parou de escolher destino. O Voltar de `admin-push`
              continua sensível à origem (pai-da-tela-do-admin).
            */}

            {/* ── PORÃO: consulta rara e técnica, no pé da tela ── */}
            <GrupoDeAjustes
              chave="ferramentas"
              onNavigate={onNavigate}
              subtitulos={subtitulos}
            >
              {/* "Conexão": o único indicador do antigo cartão "Como está
                  sua loja" que sobrou — mora aqui, junto de "Minha loja está
                  no ar?" (painel simples, E5). Espelho puro de
                  `useOnlineStatus`, sem fetch. */}
              <div className="grid grid-cols-2 gap-2.5">
                <IndicadorDoPainel
                  icone={Wifi}
                  rotulo="Conexão"
                  valor={isOffline ? "Offline" : "Online"}
                  cor={isOffline ? "text-red-400" : "text-emerald-400"}
                  estado={isOffline ? "problema" : "vivo"}
                />
              </div>
              {/* Status de funcionamento — COLAPSADA por padrão (pedido do
                  Gabriel, 02/09: status é consulta rara, não porta de
                  trabalho; a tela abre mostrando o que o lojista edita).
                  Desde H6 mostra só a conexão; o PIX é um atalho para o
                  termômetro de Pagamentos (um status do PIX só). */}
              <SecaoColapsavel
                titulo="Minha loja está no ar?"
                subtitulo="A conexão deste aparelho com a loja"
                icone={Activity}
              >
                <div className="space-y-3">
                  <ConnectionDiagnosticsSection />
                  <button
                    type="button"
                    onClick={irParaOPixEmPagamentos}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-white/5 bg-zinc-950/40 px-4 text-left text-[11px] font-bold text-zinc-300 transition-colors hover:border-admin-gold/30 hover:text-white"
                  >
                    <span>
                      O estado do PIX pelo app fica no topo de Pagamentos.
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-admin-gold">
                      Ver o PIX em Pagamentos
                      <ArrowUpRight className="size-3.5" />
                    </span>
                  </button>
                </div>
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
            Esta tela reúne o que a sua loja precisa, nestes grupos:{" "}
            {GRUPOS_DE_AJUSTES.map((g) => g.titulo).join(", ")}. Sob o título de
            cada grupo uma linha diz como ele está (por exemplo, o que falta
            preencher em Minha loja), com o que já está salvo. Cada seção abre
            com um clique.
          </p>

          {GRUPOS_DE_AJUSTES.map((grupo) => (
            <div key={grupo.chave} className="space-y-3">
              <h4 className="border-l-2 border-admin-gold pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
                {grupo.titulo}
              </h4>
              <p className="rounded-2xl border border-white/5 bg-zinc-900/40 p-4 text-xs text-zinc-400">
                {grupo.ajuda}
              </p>
            </div>
          ))}
        </div>
      </AdminHelpModal>
    </div>
  );
});
