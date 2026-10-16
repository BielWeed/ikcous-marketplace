import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useAvisosDoLojista } from "@/hooks/useAvisosDoLojista";
import {
  type Novidade,
  marcarNovidadeComoLida,
  marcarTodasComoLidas,
  useNovidadesDoAparelho,
} from "@/lib/novidades/armazenamento-local";
import type { View } from "@/types";
import type { Aviso, TipoDeAviso } from "@/utils/avisos-do-lojista";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Star,
  TriangleAlert,
  Wallet,
  XCircle,
} from "lucide-react";
import { memo, useId, useRef, useState } from "react";

interface AdminNotificationsViewProps {
  onNavigate: (view: View, id?: string) => void;
}

/**
 * O que cada tipo de aviso veste. Tabela em vez de uma escada de `if`: o
 * proximo tipo de aviso entra aqui numa linha, e nenhum `switch` espalhado
 * pela tela fica para tras.
 */
const APARENCIA: Record<
  TipoDeAviso,
  { Icone: typeof Bell; cor: string; rotulo: string }
> = {
  pedido: {
    Icone: ShoppingBag,
    cor: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    rotulo: "Pedido",
  },
  cancelamento: {
    Icone: XCircle,
    cor: "border-rose-500/20 bg-rose-500/10 text-rose-400",
    rotulo: "Cancelado",
  },
  devolucao: {
    Icone: RotateCcw,
    cor: "border-violet-500/20 bg-violet-500/10 text-violet-400",
    rotulo: "Devolução",
  },
  privacidade: {
    Icone: ShieldCheck,
    cor: "border-teal-500/20 bg-teal-500/10 text-teal-400",
    rotulo: "Privacidade",
  },
  recebimento: {
    Icone: Wallet,
    cor: "border-teal-500/20 bg-teal-500/10 text-teal-400",
    rotulo: "Pagamento",
  },
  pergunta: {
    Icone: MessageSquare,
    cor: "border-sky-500/20 bg-sky-500/10 text-sky-400",
    rotulo: "Pergunta",
  },
  avaliacao: {
    Icone: Star,
    cor: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    rotulo: "Avaliação",
  },
  estoque: {
    Icone: Package,
    cor: "border-orange-500/20 bg-orange-500/10 text-orange-400",
    rotulo: "Estoque",
  },
};

/** Como cada fonte que caiu e chamada no recado de falha parcial. */
const NOME_DA_FONTE = new Map<TipoDeAviso, string>([
  ["pedido", "pedidos"],
  ["cancelamento", "cancelamentos de clientes"],
  ["devolucao", "devoluções"],
  ["privacidade", "pedidos de privacidade"],
  ["recebimento", "pagamentos por marcar"],
  ["pergunta", "perguntas"],
  ["avaliacao", "avaliações"],
  ["estoque", "produtos"],
]);

function formatarQuando(quando: string): string {
  if (!quando) return "";
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CartaoDeNovidade({ novidade }: { novidade: Readonly<Novidade> }) {
  const [aberta, setAberta] = useState(!novidade.lida);
  const conteudoId = useId();
  const botaoDoCartao = useRef<HTMLButtonElement>(null);
  const grupos = [
    { titulo: "Novidades", itens: novidade.novidades },
    { titulo: "Correções", itens: novidade.correcoes },
    { titulo: "Melhorias", itens: novidade.melhorias },
  ];

  function alternar() {
    const vaiAbrir = !aberta;
    setAberta(vaiAbrir);
    if (vaiAbrir && !novidade.lida) {
      marcarNovidadeComoLida(novidade.versao);
    }
  }

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-zinc-900/70
        bg-gradient-to-r from-white/[0.05] to-transparent shadow-lg ${
          novidade.lida ? "border-white/10" : "border-admin-gold/40"
        }`}
    >
      <h3>
        <button
          ref={botaoDoCartao}
          type="button"
          aria-expanded={aberta}
          aria-controls={conteudoId}
          onClick={alternar}
          className="group flex min-h-11 w-full items-center gap-3
            rounded-2xl p-3.5 text-left transition-all
            hover:bg-admin-gold/[0.08] focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-inset
            focus-visible:ring-admin-gold active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-white">
              {novidade.titulo}
            </span>
            <span className="mt-1 block text-xs text-zinc-400">
              Versão {novidade.versao} ·{" "}
              <time dateTime={novidade.registradaEm}>
                {new Date(novidade.registradaEm).toLocaleDateString("pt-BR")}
              </time>
            </span>
            {!novidade.lida && (
              <span
                className="mt-1 flex items-center gap-1.5 text-xs
                  font-medium text-admin-gold"
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-admin-gold"
                />
                Não lida
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`size-5 shrink-0 text-zinc-400 ${
              aberta ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>

      <div id={conteudoId} hidden={!aberta} className="space-y-3 px-3.5 pb-3.5">
        {grupos.map(({ titulo, itens }) =>
          itens.length > 0 ? (
            <div key={titulo} className="space-y-1">
              <h4 className="text-xs font-bold text-zinc-300">{titulo}</h4>
              <ul
                className="list-disc space-y-1 pl-5 text-sm
                  leading-snug text-zinc-300"
              >
                {itens.map((texto, indice) => (
                  <li key={`${indice}-${texto}`}>{texto}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        {!novidade.lida && (
          <button
            type="button"
            onClick={() => {
              // O botão some ao marcar: o foco vai para o título do cartão.
              botaoDoCartao.current?.focus();
              marcarNovidadeComoLida(novidade.versao);
            }}
            className="min-h-11 rounded-lg border border-white/10
              bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300
              transition-all hover:border-white/20 hover:text-white
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-admin-gold active:scale-95"
          >
            Marcar como lida
          </button>
        )}
      </div>
    </article>
  );
}

function NovidadesDoApp() {
  const { novidades, naoLidas } = useNovidadesDoAparelho();
  const tituloId = useId();
  const titulo = useRef<HTMLHeadingElement>(null);

  if (novidades.length === 0) return null;

  return (
    <section aria-labelledby={tituloId} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2
          ref={titulo}
          id={tituloId}
          tabIndex={-1}
          className="text-[11px] font-black uppercase tracking-widest
            text-admin-gold/70"
        >
          Novidades do app
        </h2>
        {naoLidas > 0 && (
          <button
            type="button"
            onClick={() => {
              // O botão some quando não sobra nada por ler: o foco vai ao título.
              titulo.current?.focus();
              marcarTodasComoLidas();
            }}
            className="min-h-11 rounded-lg border border-white/10
              bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300
              transition-all hover:border-white/20 hover:text-white
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-admin-gold active:scale-95"
          >
            Marcar tudo como lido
          </button>
        )}
      </div>
      {novidades.map((novidade) => (
        <CartaoDeNovidade key={novidade.versao} novidade={novidade} />
      ))}
    </section>
  );
}

const LinhaDeAviso = memo(function LinhaDeAviso({
  aviso,
  onNavigate,
}: {
  aviso: Aviso;
  onNavigate: (view: View, id?: string) => void;
}) {
  const { Icone, cor, rotulo } = APARENCIA[aviso.tipo];
  const quando = formatarQuando(aviso.quando);

  return (
    <button
      type="button"
      data-aviso={aviso.tipo}
      onClick={() => onNavigate(aviso.destino.view, aviso.destino.id)}
      className="group relative flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/70 bg-gradient-to-r from-white/[0.05] to-transparent p-3.5 text-left shadow-lg transition-all duration-300 hover:border-admin-gold/40 hover:from-admin-gold/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold active:scale-[0.99]"
    >
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${cor}`}
      >
        <Icone className="size-5" strokeWidth={2.5} />
      </div>

      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-[11px] font-bold uppercase leading-none tracking-wider text-zinc-300">
          {rotulo}
          {quando ? ` · ${quando}` : ""}
        </span>
        <h3 className="truncate text-[15px] font-bold leading-tight text-white">
          {aviso.titulo}
        </h3>
        <p className="mt-0.5 truncate text-xs font-medium leading-tight text-zinc-400">
          {aviso.detalhe}
        </p>
      </div>

      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:text-admin-gold"
      />
    </button>
  );
});

function Bloco({
  nome,
  titulo,
  legenda,
  avisos,
  onNavigate,
}: {
  nome: string;
  titulo: string;
  legenda: string;
  avisos: Aviso[];
  onNavigate: (view: View, id?: string) => void;
}) {
  // Bloco sem item some inteiro: cabecalho de secao vazia e ruido que faz a
  // tela parecer cheia quando nao ha nada para fazer.
  if (avisos.length === 0) return null;

  return (
    <section data-bloco={nome} className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-admin-gold/70">
          {titulo}
        </h2>
        <span className="text-xs text-zinc-400">{legenda}</span>
      </div>
      {avisos.map((aviso) => (
        <LinhaDeAviso key={aviso.id} aviso={aviso} onNavigate={onNavigate} />
      ))}
    </section>
  );
}

/**
 * A tela de Notificacoes do lojista: o que esta esperando por ele.
 *
 * Ela NAO envia nada para cliente nenhum — isso e a tela "Avisar clientes".
 * E nao tem regra de negocio: quem decide o que vira aviso, em que ordem e
 * o que conta no cracha e o `montarAvisos`, testado a parte. Aqui so se
 * separa a lista em dois blocos e se desenha.
 */
export const AdminNotificationsView = memo(function AdminNotificationsView({
  onNavigate,
}: AdminNotificationsViewProps) {
  const { avisos, carregando, fontesComFalha, recarregar } =
    useAvisosDoLojista();

  const precisaDeVoce = avisos.filter((aviso) => aviso.contaNoCracha);
  const deOlho = avisos.filter((aviso) => !aviso.contaNoCracha);

  return (
    <div className="pb-admin min-h-screen bg-[#09090b] text-white duration-200 animate-in fade-in lg:pb-12">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#09090b]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-admin-gold/30 bg-admin-gold/10 text-admin-gold">
              <Bell className="size-4" />
            </div>
            <div>
              {/* Onda 4 da reforma visual (03/09): o título tinha fórmula
                  própria (text-base) — agora nasce do AdminPageHeader, igual
                  ao resto do painel. */}
              <AdminPageHeader
                titulo={NOMES_DO_PAINEL["admin-notifications"]}
              />
              <p className="mt-1 text-[11px] leading-none text-zinc-400">
                O que está esperando por você
              </p>
            </div>
          </div>

          <button
            type="button"
            data-acao="recarregar"
            onClick={recarregar}
            title="Atualizar os avisos"
            className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-zinc-900 text-zinc-400 transition-all hover:border-white/20 hover:text-white active:scale-95"
          >
            <RefreshCw
              className={`size-3.5 ${carregando ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <NovidadesDoApp />

        {fontesComFalha.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p className="text-[11px] leading-snug text-amber-200/90">
              Não consegui conferir{" "}
              {fontesComFalha
                .map((fonte) => NOME_DA_FONTE.get(fonte) ?? fonte)
                .join(", ")}{" "}
              agora. O resto da lista está completo — toque em atualizar para
              tentar de novo.
            </p>
          </div>
        )}

        <Bloco
          nome="precisa-de-voce"
          titulo="Precisa de você"
          legenda={`${precisaDeVoce.length} ${
            precisaDeVoce.length === 1 ? "item" : "itens"
          }`}
          avisos={precisaDeVoce}
          onNavigate={onNavigate}
        />

        <Bloco
          nome="de-olho"
          titulo="De olho"
          legenda="não conta no sino"
          avisos={deOlho}
          onNavigate={onNavigate}
        />

        {/*
          As tres condicoes sao necessarias, e a terceira e a que faltava:
          "Tudo em dia" AFIRMA que nada esta esperando. Com uma fonte caida a
          tela nao conferiu aquilo — e o recado ambar logo acima ja diz isso.
          Sem esta guarda o lojista lia, em duas linhas seguidas, "nao consegui
          conferir avaliacoes" e "nenhuma avaliacao esperando por voce". O hook
          escolheu dizer a verdade; a tela nao pode desmentir a fonte dela.
        */}
        {avisos.length === 0 && !carregando && fontesComFalha.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-zinc-950/40 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="size-5" />
            </div>
            <h2 className="text-sm font-black tracking-tight text-white">
              Tudo em dia
            </h2>
            <p className="max-w-xs text-xs leading-snug text-zinc-400">
              Nenhum pedido, devolução, pergunta ou avaliação esperando por
              você, e nenhum produto acabando.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

export default AdminNotificationsView;
