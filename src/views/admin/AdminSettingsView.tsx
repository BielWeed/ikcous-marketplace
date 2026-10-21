import {
  Activity,
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronRight,
  Coins,
  Droplet,
  GalleryHorizontal,
  HelpCircle,
  ImageIcon,
  KeyRound,
  type LucideIcon,
  Mail,
  PackageCheck,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Truck,
  Wifi,
} from "lucide-react";
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { IconePix } from "@/components/admin/primitivos/IconePix";
import { AparenciaDoPainel } from "@/components/admin/settings/AparenciaDoPainel";
import {
  CartaoPeloAppBloco,
  FormasDePagamentoSection,
} from "@/components/admin/settings/FormasDePagamentoCard";
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
import {
  CARTAO_AJUSTES,
  IconeDeAjustes,
  type MatizDeAjustes,
} from "@/components/admin/settings/visual-ajustes";
import "@/components/admin/settings/ajustes.css";
import { Skeleton } from "@/components/ui/skeleton";
import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { NOMES_DO_PAINEL, type TelaDoPainel } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { transportadoraVendeForaDaCidade } from "@/lib/aviso-transportadora-sem-pagamento";
import { pagamentoOnlineLigado } from "@/lib/flags";
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
import { publicarPagamentoPeloApp } from "@/lib/pagamento-pelo-app-no-painel";
import { pixConfiguradoNoBuild } from "@/lib/pix-configurado-no-build";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import {
  StatusPagamentoCartao,
  StatusPagamentoPix,
} from "@/views/admin/StatusPagamentoPix";

import type { View } from "@/types";

// Laudo 0109 (D1): o painel não tinha NENHUMA menção ao estado do
// pagamento — o lojista descobria que a loja não aceita PIX pela queixa do
// cliente. Escala etapa 3 (11/09/2026): a flag e a chave pública deixaram de
// vir do build e passaram a vir da ficha da loja
// (src/config/configuracaoDaLoja.ts), lida do banco de cada loja pelo
// porteiro. `null`/`false` é o "não configurada".
interface AdminSettingsViewProps {
  // `id` opcional: a seção de privacidade abre a ficha da cliente (admin-user-detail).
  onNavigate: (view: View, id?: string) => void;
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

// E-mail da loja (14/10/2026, pedido do dono): a lojista cadastra o Gmail que
// envia o e-mail do pedido, com o passo a passo dentro da tela. Carregada sob
// demanda, como o Mercado Pago: só é baixada (e só fala com o servidor) quando
// a seção é aberta.
const EmailDaLojaSection = lazy(() =>
  import("@/components/admin/settings/EmailDaLojaSection").then((module) => ({
    default: module.EmailDaLojaSection,
  })),
);

// Pedidos de privacidade dos clientes (14/10/2026, LGPD): exclusão de conta e
// correção de e-mail pedidas pelo app e atendidas à mão pela loja. Carregada sob
// demanda, como o E-mail da loja: só é baixada (e só lê o banco) quando a seção
// é aberta. O sino do painel já avisa quando há pedido esperando.
const PrivacidadeDosClientesSection = lazy(() =>
  import("@/components/admin/settings/PrivacidadeDosClientesSection").then(
    (module) => ({
      default: module.PrivacidadeDosClientesSection,
    }),
  ),
);

// ==========================================
// Diagnóstico de Conexão (G7b, painel simples): o resultado é uma frase —
// conexão boa, lenta ou sem internet — com o que fazer; os números (ms e
// tentativas sem resposta) ficam num detalhe, para quem quiser.
// ==========================================
type ResultadoDaConexao =
  | "boa"
  | "lenta"
  | "sem-internet"
  | "loja-sem-resposta";

interface MedidaDaConexao {
  /** Tempo médio de resposta em ms; `null` = nenhuma tentativa respondeu. */
  readonly media: number | null;
  readonly minima: number | null;
  readonly maxima: number | null;
  readonly falhas: number;
  readonly tentativas: number;
  /** `navigator.onLine` no fim do teste: o aparelho diz que tem rede. */
  readonly aparelhoOnline: boolean;
}

// Mesmo corte de antes (abaixo de 250 ms era "Excelente"/"Moderado"); uma
// tentativa sem resposta já é conexão lenta (antes: "Instabilidade
// Detectada"). Nenhuma resposta com o aparelho ONLINE é a loja que não
// respondeu (erro do servidor), não falta de internet: mandar conferir o
// Wi-Fi seria mandar mexer no lugar errado.
function resultadoDaConexao(medida: MedidaDaConexao): ResultadoDaConexao {
  if (medida.media === null) {
    return medida.aparelhoOnline ? "loja-sem-resposta" : "sem-internet";
  }
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
      cor: "text-orange-300",
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
  [
    "loja-sem-resposta",
    {
      titulo: "A loja não respondeu",
      frase: "A loja não respondeu agora. Tente de novo em instantes.",
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
        aparelhoOnline: navigator.onLine,
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
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl p-2 text-left"
        >
          <span className="flex items-center gap-3">
            <IconeDeAjustes icone={Wifi} matiz="ciano" />
            <span className="text-base font-bold">Diagnóstico de Conexão</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`size-5 shrink-0 text-zinc-400 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
        <div
          hidden={!isOpen}
          className="space-y-4 rounded-3xl border border-admin-border-strong bg-gradient-to-br from-admin-raised to-admin-surface p-4"
        >
          <p className="text-xs leading-relaxed text-zinc-400">
            Teste se a internet deste aparelho chega bem até a sua loja. Ajuda a
            saber se uma lentidão do painel vem da sua rede.
          </p>
          <div role="status" aria-live="polite" className="space-y-3">
            {testando ? (
              <p className="flex items-center gap-2 text-sm text-sky-300">
                <RefreshCw aria-hidden="true" className="size-5 animate-spin" />
                Testando… Medindo a resposta da loja.
              </p>
            ) : medida && palavras ? (
              <>
                <p className={cn("text-lg font-bold", palavras.cor)}>
                  {palavras.titulo}
                </p>
                {medida.media !== null && (
                  <p
                    aria-label="Tempo médio de resposta"
                    className="text-4xl font-bold tabular-nums text-white"
                  >
                    {medida.media} ms
                  </p>
                )}
                <p className="text-sm leading-relaxed text-zinc-300">
                  {palavras.frase}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-300">
                Ainda não testada neste aparelho.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={testando}
            onClick={handleTestConnectivity}
            className="ajustes-primario flex min-h-11 items-center justify-center gap-2"
          >
            <RefreshCw
              aria-hidden="true"
              className={cn("size-5", testando && "animate-spin")}
            />
            {testando ? "Testando…" : "Testar a conexão agora"}
          </button>
          {medida && (
            <details className="text-xs text-zinc-400">
              <summary className="min-h-11 cursor-pointer py-3 text-sm text-zinc-200">
                Ver os números
              </summary>
              <ul className="space-y-3 rounded-2xl bg-admin-raised p-3">
                {medida.media !== null && (
                  <>
                    <li>Tempo médio de resposta: {medida.media} ms</li>
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
          )}
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
  aoAbrir,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo?: string;
  readonly icone: LucideIcon;
  readonly comPendencia?: boolean;
  /**
   * FORMAS DE PAGAMENTO POR LOJA (25/09/2026): incrementa de FORA (um botão
   * de outra seção — "Formas de pagamento" abrindo "Mercado Pago", sem
   * duplicar o switch que exige credencial) para forçar esta seção a abrir.
   * Efeito colateral, não estado controlado: continua sendo a própria seção
   * quem manda no clique normal do cabeçalho (fechar continua funcionando).
   */
  readonly abrirGatilho?: number;
  readonly aoAbrir?: () => void;
  readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const conteudoId = useId();
  useEffect(() => {
    if (aberta) aoAbrir?.();
  }, [aberta, aoAbrir]);

  useEffect(() => {
    if (abrirGatilho !== undefined && abrirGatilho > 0) setAberta(true);
    // Só reage a um NOVO pedido de abrir (gatilho subiu) — nunca ao
    // clique/pendência internos, que já têm o próprio caminho acima.
  }, [abrirGatilho]);

  return (
    <div className="min-w-0 rounded-2xl border border-admin-border bg-admin-surface p-3">
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
        aria-controls={conteudoId}
        className="group flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <IconeDeAjustes
            icone={Icone}
            matiz={
              Icone === Mail
                ? "verde"
                : Icone === ShieldCheck || Icone === Banknote
                  ? "roxo"
                  : Icone === RotateCcw
                    ? "rosa"
                    : "ciano"
            }
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold leading-snug text-white">
              {titulo}
            </span>
            {subtitulo && (
              <span className="block text-[11px] font-medium normal-case tracking-normal text-zinc-500">
                {subtitulo}
              </span>
            )}
          </span>
        </span>
        <span className="flex max-w-[40%] shrink-0 flex-wrap items-center justify-end gap-2">
          {aberta && comPendencia && (
            <span className="text-[11px] font-black uppercase tracking-widest text-orange-300">
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

      <div id={conteudoId}>
        {aberta && <div className="min-w-0 pt-4">{children}</div>}
      </div>
    </div>
  );
}

// Ícone de cada porta (o nome e a rota vêm de GRUPOS_DE_AJUSTES). Map + `.get`:
// índice de variável acorda o object-injection do eslint. Guarda o ELEMENTO pronto, não o componente: um
// componente tirado do Map no render dispara react-hooks/static-components.
const CLASSE_DO_ICONE_DA_PORTA = "size-5";
const ICONE_DA_PORTA = new Map<TelaDoPainel, React.ReactNode>([
  [
    "admin-about-store",
    <Store
      key="s"
      aria-hidden="true"
      className={CLASSE_DO_ICONE_DA_PORTA}
      strokeWidth={2.25}
    />,
  ],
  [
    "admin-banners",
    <ImageIcon
      key="p"
      aria-hidden="true"
      className={CLASSE_DO_ICONE_DA_PORTA}
      strokeWidth={2.25}
    />,
  ],
  [
    "admin-carousels",
    <GalleryHorizontal
      key="l"
      aria-hidden="true"
      className={CLASSE_DO_ICONE_DA_PORTA}
      strokeWidth={2.25}
    />,
  ],
  [
    "admin-free-shipping-card",
    <Truck
      key="frete-card"
      aria-hidden="true"
      className={CLASSE_DO_ICONE_DA_PORTA}
      strokeWidth={2.25}
    />,
  ],
  [
    "admin-app-color",
    <Droplet
      key="c"
      aria-hidden="true"
      className={CLASSE_DO_ICONE_DA_PORTA}
      strokeWidth={2.25}
    />,
  ],
  [
    "admin-shipping",
    <Truck
      key="t"
      aria-hidden="true"
      className={CLASSE_DO_ICONE_DA_PORTA}
      strokeWidth={2.25}
    />,
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
      data-porta-ajustes={porta.tela}
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(porta.tela)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(porta.tela);
        }
      }}
      className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-admin-border bg-admin-surface bg-gradient-to-r from-white/[0.05] to-transparent px-3.5 py-3 text-left shadow-lg transition-all hover:border-admin-border-strong hover:from-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold active:scale-[0.99]"
    >
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${porta.tela === "admin-banners" ? "border-pink-400/30 bg-pink-400/15 text-pink-300" : porta.tela === "admin-carousels" ? "border-violet-400/30 bg-violet-400/15 text-violet-300" : porta.tela === "admin-app-color" ? "border-amber-400/30 bg-amber-400/15 text-amber-300" : porta.tela === "admin-shipping" ? "border-orange-400/30 bg-orange-400/15 text-orange-300" : "border-blue-400/30 bg-blue-400/15 text-blue-300"}`}
      >
        {ICONE_DA_PORTA.get(porta.tela)}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-bold leading-tight text-white">
          {NOMES_DO_PAINEL[porta.tela]}
        </h3>
        <p className="mt-0.5 text-xs text-zinc-400">{porta.descricao}</p>
      </div>
      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
      />
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
const VISUAL_DO_GRUPO = new Map<
  ChaveDoGrupoDeAjustes,
  { icone: LucideIcon; matiz: MatizDeAjustes }
>([
  ["minha-loja", { icone: Store, matiz: "azul" }],
  ["aparencia", { icone: Palette, matiz: "roxo" }],
  ["entrega", { icone: Truck, matiz: "laranja" }],
  ["pagamentos", { icone: Coins, matiz: "verde" }],
  ["devolucao", { icone: RotateCcw, matiz: "rosa" }],
  ["ferramentas", { icone: SlidersHorizontal, matiz: "ciano" }],
]);

function GrupoDeAjustes({
  chave,
  onNavigate,
  subtitulos,
  children,
  comPendencia = false,
  abrirGatilho,
  subtituloExtra,
}: {
  readonly chave: ChaveDoGrupoDeAjustes;
  readonly onNavigate: (view: View) => void;
  readonly subtitulos: ReadonlyMap<ChaveDoGrupoDeAjustes, string>;
  readonly children?: React.ReactNode | ((aberta: boolean) => React.ReactNode);
  readonly comPendencia?: boolean;
  readonly abrirGatilho?: number;
  readonly subtituloExtra?: string;
}) {
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    if (abrirGatilho) setAberta(true);
  }, [abrirGatilho]);
  const grupo = GRUPO_POR_CHAVE.get(chave);
  const visual = VISUAL_DO_GRUPO.get(chave);
  if (!grupo || !visual) return null;
  const subtitulo =
    subtituloExtra ??
    subtitulos.get(chave) ??
    (chave === "aparencia"
      ? "Banners, vitrines e cor do app"
      : chave === "devolucao"
        ? "Prazos, formas de devolver e política"
        : undefined);
  const direta = chave === "entrega";
  return (
    <section
      id={`grupo-de-ajustes-${chave}`}
      aria-label={grupo.titulo}
      className={`${CARTAO_AJUSTES} scroll-mt-24 !p-0`}
    >
      <h2>
        <button
          type="button"
          onKeyDown={(evento) => {
            if (direta && (evento.key === "Enter" || evento.key === " ")) {
              evento.preventDefault();
              onNavigate("admin-shipping");
            }
          }}
          data-cabecalho-grupo=""
          data-porta-ajustes={direta ? "admin-shipping" : undefined}
          aria-label={grupo.titulo}
          aria-describedby={
            [
              subtitulo ? `subtitulo-${chave}` : null,
              aberta && comPendencia ? `pendencia-${chave}` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-expanded={direta ? undefined : aberta}
          aria-controls={direta ? undefined : `conteudo-${chave}`}
          onClick={() => {
            if (direta) {
              onNavigate("admin-shipping");
              return;
            }
            if (aberta && comPendencia) return;
            setAberta((antes) => !antes);
          }}
          className="flex min-h-11 w-full items-center gap-3 rounded-3xl p-3 text-left focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <IconeDeAjustes icone={visual.icone} matiz={visual.matiz} />
          <span className="min-w-0 flex-1">
            <span
              data-grupo-titulo=""
              className="block text-[15px] font-bold leading-snug text-white"
            >
              {grupo.titulo}
            </span>
            {subtitulo && (
              <span
                data-grupo-subtitulo=""
                id={`subtitulo-${chave}`}
                className={`mt-1 block text-xs font-normal leading-relaxed ${subtitulo.startsWith("Falta:") ? "text-orange-300" : "text-zinc-400"}`}
              >
                {subtitulo}
              </span>
            )}
            {aberta && comPendencia && (
              <span
                id={`pendencia-${chave}`}
                className="mt-1 block text-xs font-normal text-orange-300"
              >
                Salve antes de fechar
              </span>
            )}
          </span>
          {direta ? (
            <ChevronRight
              aria-hidden="true"
              className="size-5 shrink-0 text-zinc-400"
            />
          ) : (
            <ChevronDown
              aria-hidden="true"
              className={`size-5 shrink-0 text-zinc-400 ${aberta ? "rotate-180" : ""}`}
            />
          )}
        </button>
      </h2>
      {!direta && (
        <div
          id={`conteudo-${chave}`}
          data-conteudo-grupo=""
          hidden={!aberta}
          className="space-y-3 border-t border-admin-border p-3"
        >
          {grupo.portas.map((porta) => (
            <PortaDeAjustes
              key={porta.tela}
              porta={porta}
              onNavigate={onNavigate}
            />
          ))}
          {typeof children === "function" ? children(aberta) : children}
        </div>
      )}
    </section>
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
  // E-mail da loja (14/10/2026): Gmail ou senha de app digitados e não salvos
  // não somem num clique no cabeçalho da seção.
  const [emailPendente, setEmailPendente] = useState(false);
  // Pedidos de privacidade (14/10/2026): nota de resposta digitada e não salva.
  const [privacidadePendente, setPrivacidadePendente] = useState(false);
  // Contador que só CRESCE: o botão "Configurar credenciais" da seção nova
  // incrementa para abrir a seção Mercado Pago de fora (SecaoColapsavel
  // continua dona do próprio fechar).
  const [abrirMercadoPagoGatilho, setAbrirMercadoPagoGatilho] = useState(0);
  // Mesmo gênero de contador, só do "Configurar credenciais": além de abrir
  // a seção, pede os campos das chaves já à mostra. O "Ver o PIX em
  // Pagamentos" de Ferramentas abre a seção sem ele.
  const [abrirChavesGatilho, setAbrirChavesGatilho] = useState(0);
  const [abrirPagamentosGatilho, setAbrirPagamentosGatilho] = useState(0);
  const [relerCartaoGatilho, setRelerCartaoGatilho] = useState(0);
  const relerCartao = useCallback(
    () => setRelerCartaoGatilho((n) => n + 1),
    [],
  );

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
          politicaDevolucaoPendente ||
          emailPendente ||
          privacidadePendente,
      );
  }, [
    active,
    pagamentosPendente,
    formasPagamentoPendente,
    politicaDevolucaoPendente,
    emailPendente,
    privacidadePendente,
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
    setAbrirPagamentosGatilho((n) => n + 1);
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

  // A transportadora está de fato OFERECIDA ao cliente de outra cidade? Com
  // o que esta tela já leu (a mesma lista acima); sem leitura (`null`) não se
  // chuta. Pausar o pagamento pelo app avisa disso ANTES (MercadoPagoSection).
  const transportadoraVende = transportadoraVendeForaDaCidade({
    cobertura: config.shippingCoverage,
    nomesLigados: nomesLigadosDeFrete,
  });

  // O subtítulo de status de cada grupo — a mesma função dos seis passos do
  // Início (grupos-de-ajustes.ts); aqui só se entregam os fatos.
  const subtitulos = subtitulosDosGrupos({
    config,
    formasNaEntrega,
    nivelDoPix,
    nomesLigados: nomesLigadosDeFrete,
  });

  return (
    <div className="ajustes pb-admin h-auto duration-200 animate-in fade-in lg:pb-12">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-admin-border bg-admin-bg/95 p-5 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-settings"]}>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95"
              title="Guia de Configurações e Ajuda"
              aria-label="Guia de Configurações e Ajuda"
            >
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-full border border-admin-border bg-admin-surface text-zinc-300 transition-all duration-300 group-hover:border-admin-border-strong group-hover:text-white"
              >
                <HelpCircle aria-hidden="true" className="size-5" />
              </span>
            </button>
          </AdminPageHeader>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-5 pb-8">
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
          <div
            role="status"
            aria-label="Carregando ajustes"
            className="mt-4 animate-pulse space-y-6"
          >
            <span className="sr-only">Carregando ajustes…</span>
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex h-20 flex-col justify-between rounded-[2rem] border border-admin-border bg-zinc-900/30 p-6"
              >
                <Skeleton className="h-4 w-1/3 rounded-md bg-white/5" />
                <Skeleton className="h-3 w-1/2 rounded-md bg-white/5" />
              </div>
            ))}
          </div>
        ) : (
          <CartaoPeloAppBloco
            pixLigado={pixLigado}
            pixChaveOk={pixChaveOk}
            isOffline={isOffline}
            onDirtyMudou={setFormasPagamentoPendente}
            relerGatilho={relerCartaoGatilho}
          >
            {(
              resumoDoCartao,
              controlesDoCartao,
              estadoDoCartao,
              cartaoLigado,
            ) => (
              <>
                <section
                  aria-label="Recebimentos"
                  aria-busy={estadoDoCartao === "carregando"}
                  className={`${CARTAO_AJUSTES} mb-7 space-y-3 !p-3`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold">Recebimentos</h3>
                    <button
                      type="button"
                      aria-label="Gerenciar recebimentos"
                      onClick={() => {
                        setAbrirPagamentosGatilho((n) => n + 1);
                        setTimeout(
                          () =>
                            document
                              .getElementById("grupo-de-ajustes-pagamentos")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              }),
                          0,
                        );
                      }}
                      className="flex min-h-11 items-center gap-2 text-xs text-zinc-400"
                    >
                      Gerenciar{" "}
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                  <dl className="space-y-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-3">
                      <dt className="flex items-center gap-2 text-sm font-bold">
                        <IconeDeAjustes icone={IconePix} matiz="verde" />
                        PIX
                      </dt>
                      <dd className="pt-1 text-right text-xs text-zinc-400">
                        {nivelDoPix === "ok"
                          ? "Funcionando"
                          : nivelDoPix === "alerta"
                            ? "Chave ausente"
                            : "Desligado"}
                      </dd>
                    </div>
                    {resumoDoCartao}
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-3">
                      <dt className="flex items-center gap-2 text-sm font-bold">
                        <IconeDeAjustes icone={PackageCheck} matiz="azul" />
                        Na entrega
                      </dt>
                      <dd className="pt-1 text-right text-xs text-zinc-400">
                        {formasNaEntrega.length
                          ? formasNaEntrega
                              .map((forma) =>
                                forma === "pix"
                                  ? "PIX"
                                  : forma === "card"
                                    ? "cartão"
                                    : "dinheiro",
                              )
                              .join(", ")
                              .replace(/, ([^,]*)$/, " e $1")
                          : "Nenhuma forma ligada"}
                      </dd>
                    </div>
                  </dl>
                  {estadoDoCartao === "falhou" && (
                    <button
                      type="button"
                      onClick={relerCartao}
                      disabled={formasPagamentoPendente}
                      className="ajustes-secundario min-h-11"
                    >
                      <RefreshCw aria-hidden="true" className="size-4" />
                      Atualizar recebimentos
                    </button>
                  )}
                </section>
                <p className="py-1 text-[11px] font-bold tracking-wider text-zinc-400">
                  CONFIGURAÇÕES · 6 GRUPOS
                </p>
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
                  comPendencia={emailPendente || privacidadePendente}
                  onNavigate={onNavigate}
                  subtitulos={subtitulos}
                >
                  {/* E-mail da loja (14/10/2026): o Gmail que envia o e-mail do
                  pedido e o código de login. Nascida FECHADA como as demais;
                  com algo digitado e não salvo, o cabeçalho não fecha. */}
                  <SecaoColapsavel
                    titulo="E-mail da loja"
                    subtitulo="O Gmail que envia os e-mails do pedido aos seus clientes"
                    icone={Mail}
                    comPendencia={emailPendente}
                  >
                    <Suspense
                      fallback={
                        <p className="text-sm text-zinc-400">
                          Carregando E-mail da loja…
                        </p>
                      }
                    >
                      <EmailDaLojaSection onDirtyMudou={setEmailPendente} />
                    </Suspense>
                  </SecaoColapsavel>
                  {/* Pedidos de privacidade dos clientes (14/10/2026, LGPD): a
                  cliente pede, pelo app, a exclusão da conta ou a correção do
                  e-mail; a loja atende à mão e marca aqui. SEM botão de apagar.
                  Nascida FECHADA; com nota digitada e não salva, não fecha. */}
                  <SecaoColapsavel
                    titulo="Pedidos de privacidade dos clientes"
                    subtitulo="Exclusão de conta e correção de e-mail pedidas pelo app"
                    icone={ShieldCheck}
                    comPendencia={privacidadePendente}
                  >
                    <Suspense
                      fallback={
                        <p className="text-sm text-zinc-400">
                          Carregando os pedidos…
                        </p>
                      }
                    >
                      <PrivacidadeDosClientesSection
                        onNavigate={onNavigate}
                        onDirtyMudou={setPrivacidadePendente}
                      />
                    </Suspense>
                  </SecaoColapsavel>
                </GrupoDeAjustes>

                {/* Aparência do app: Banners e Vitrines — só portas. */}
                <GrupoDeAjustes
                  chave="aparencia"
                  onNavigate={onNavigate}
                  subtitulos={subtitulos}
                >
                  {/* Cores do PRÓPRIO painel (Escuro, Claro, Confortável), só
                  neste aparelho: não mexe na vitrine dos clientes. */}
                  <SecaoColapsavel
                    titulo="Aparência do painel"
                    subtitulo="Escuro, claro ou confortável, só neste aparelho"
                    icone={Palette}
                  >
                    <AparenciaDoPainel />
                  </SecaoColapsavel>
                </GrupoDeAjustes>

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
                  comPendencia={pagamentosPendente || formasPagamentoPendente}
                  abrirGatilho={
                    abrirPagamentosGatilho + abrirMercadoPagoGatilho
                  }
                  onNavigate={onNavigate}
                  subtitulos={subtitulos}
                >
                  {/* Mesmos sinais dos controles, só leitura. O cartão depende
                  também da liberação do pagamento pelo app, como no checkout. */}
                  <StatusPagamentoPix ligado={pixLigado} chaveOk={pixChaveOk} />
                  <StatusPagamentoCartao
                    ligado={pixLigado && cartaoLigado}
                    chaveOk={pixChaveOk}
                    estado={estadoDoCartao}
                  />

                  {/* FORMAS DE PAGAMENTO POR LOJA (25/09/2026, migration
                  20261174000000): ANTES do Mercado Pago (pedido explícito do
                  brief) — a lojista decide primeiro O QUE aceita na
                  entrega/retirada, e só depois mexe nas credenciais do
                  pagamento pelo app. Nascida FECHADA como as demais. */}
                  <SecaoColapsavel
                    titulo="Formas de pagamento"
                    aoAbrir={relerCartao}
                    abrirGatilho={abrirPagamentosGatilho}
                    subtitulo={`${formasNaEntrega.length} na entrega`}
                    icone={Banknote}
                    comPendencia={formasPagamentoPendente}
                  >
                    <FormasDePagamentoSection
                      cartaoPeloApp={controlesDoCartao}
                      formasNaEntrega={formasNaEntrega}
                      pixLigado={pixLigado}
                      pixChaveOk={pixChaveOk}
                      isOffline={isOffline}
                      updateConfig={updateConfig}
                      onDirtyMudou={setFormasPagamentoPendente}
                      onAbrirMercadoPago={() => {
                        setAbrirMercadoPagoGatilho((n) => n + 1);
                        // "Configurar credenciais" cai direto nos campos das
                        // chaves (Avançado + Suas chaves abertos).
                        setAbrirChavesGatilho((n) => n + 1);
                      }}
                    />
                  </SecaoColapsavel>

                  <SecaoColapsavel
                    titulo="Mercado Pago"
                    subtitulo="Chaves do seu Mercado Pago no app"
                    icone={KeyRound}
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
                        abrirChavesGatilho={abrirChavesGatilho}
                        transportadoraVende={transportadoraVende}
                        onPixAlternado={(ligado, chaveNaLoja) => {
                          setPixLigado(ligado);
                          // A tela de Frete é OUTRA aba (as duas ficam montadas):
                          // o mesmo eco do servidor vai para ela, que o usa para
                          // avisar da transportadora sem aviso falso.
                          publicarPagamentoPeloApp(ligado);
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
                  comPendencia={politicaDevolucaoPendente}
                  onNavigate={onNavigate}
                  subtitulos={subtitulos}
                >
                  {(aberta) => (
                    <SecaoColapsavel
                      abrirGatilho={aberta ? 1 : 0}
                      titulo="Trocas e devoluções"
                      subtitulo="Prazos, formas de devolver e a política da loja"
                      icone={RotateCcw}
                      comPendencia={politicaDevolucaoPendente}
                    >
                      <PoliticaDeDevolucaoSection
                        ativa={active !== false && aberta}
                        isOffline={isOffline}
                        onDirtyMudou={setPoliticaDevolucaoPendente}
                      />
                    </SecaoColapsavel>
                  )}
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
                  subtituloExtra={`Conexão · ${isOffline ? "Offline" : "Online"}`}
                  onNavigate={onNavigate}
                  subtitulos={subtitulos}
                >
                  {(aberta) => (
                    <>
                      <p className="text-xs text-zinc-400">
                        Conexão · {isOffline ? "Offline" : "Online"}
                      </p>
                      {/* Status de funcionamento — COLAPSADA por padrão (pedido do
                  Gabriel, 02/09: status é consulta rara, não porta de
                  trabalho; a tela abre mostrando o que o lojista edita).
                  Desde H6 mostra só a conexão; o PIX é um atalho para o
                  termômetro de Pagamentos (um status do PIX só). */}
                      <SecaoColapsavel
                        titulo="Minha loja está no ar?"
                        abrirGatilho={aberta ? 1 : 0}
                        subtitulo="A conexão deste aparelho com a loja"
                        icone={Activity}
                      >
                        <div className="space-y-3">
                          <ConnectionDiagnosticsSection />
                          <button
                            type="button"
                            onClick={irParaOPixEmPagamentos}
                            className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-admin-border bg-admin-raised p-3 text-left text-xs text-zinc-300"
                          >
                            <span>
                              O estado do PIX pelo app fica no topo de
                              Pagamentos.
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-sky-300">
                              Ver o PIX em Pagamentos
                              <ChevronRight
                                aria-hidden="true"
                                className="size-3.5"
                              />
                            </span>
                          </button>
                        </div>
                      </SecaoColapsavel>
                    </>
                  )}
                </GrupoDeAjustes>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="flex min-h-11 w-full min-w-11 items-center justify-between gap-3 py-4 text-left text-xs text-zinc-300"
                >
                  Guia de Configurações e Ajuda{" "}
                  <HelpCircle aria-hidden="true" className="size-5 shrink-0" />
                </button>
              </>
            )}
          </CartaoPeloAppBloco>
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
              <h4 className="border-l-2 border-sky-400 pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
                {grupo.titulo}
              </h4>
              <p className="rounded-2xl border border-admin-border bg-zinc-900/40 p-4 text-xs text-zinc-400">
                {grupo.ajuda}
              </p>
            </div>
          ))}
        </div>
      </AdminHelpModal>
    </div>
  );
});
