import { useAvisosDoLojista } from "@/hooks/useAvisosDoLojista";
import type { View } from "@/types";
import type { Aviso, TipoDeAviso } from "@/utils/avisos-do-lojista";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  Star,
  TriangleAlert,
} from "lucide-react";
import { memo } from "react";

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
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 text-left shadow-lg transition-all duration-300 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
    >
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl border ${cor}`}
      >
        <Icone className="size-4" strokeWidth={2.5} />
      </div>

      <div className="min-w-0 flex-1">
        <span className="mb-0.5 block text-[9px] font-black uppercase leading-none tracking-widest text-zinc-500">
          {rotulo}
          {quando ? ` · ${quando}` : ""}
        </span>
        <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
          {aviso.titulo}
        </h3>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-zinc-400">
          {aviso.detalhe}
        </p>
      </div>

      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-admin-gold group-hover:text-black">
        <ArrowUpRight className="size-3.5 stroke-[2.5]" />
      </div>
    </button>
  );
});

const Bloco = memo(function Bloco({
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
        <h2 className="text-[10px] font-black uppercase tracking-widest text-admin-gold/70">
          {titulo}
        </h2>
        <span className="text-[10px] text-zinc-500">{legenda}</span>
      </div>
      {avisos.map((aviso) => (
        <LinhaDeAviso key={aviso.id} aviso={aviso} onNavigate={onNavigate} />
      ))}
    </section>
  );
});

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
              <h1 className="text-base font-black leading-none tracking-tight text-white">
                Notificações
              </h1>
              <p className="mt-1 text-[10px] leading-none text-zinc-500">
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

        {avisos.length === 0 && !carregando && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-zinc-950/40 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="size-5" />
            </div>
            <h2 className="text-sm font-black tracking-tight text-white">
              Tudo em dia
            </h2>
            <p className="max-w-xs text-[11px] leading-snug text-zinc-500">
              Nenhum pedido, pergunta ou avaliação esperando por você, e nenhum
              produto acabando.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

export default AdminNotificationsView;
