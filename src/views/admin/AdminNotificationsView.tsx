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
  Sparkles,
  Star,
  TriangleAlert,
  Wallet,
  XCircle,
} from "lucide-react";
import { memo, useId, useRef, useState } from "react";

interface AdminNotificationsViewProps {
  onNavigate: (view: View, id?: string) => void;
}

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
const SECUNDARIO = `flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#1E1E24] px-3 py-2 text-xs font-semibold text-zinc-100 transition-colors hover:bg-[#26262E] ${FOCO}`;

/**
 * O que cada tipo de aviso veste. Tabela em vez de uma escada de `if`: o
 * proximo tipo de aviso entra aqui numa linha, e nenhum `switch` espalhado
 * pela tela fica para tras.
 */
const APARENCIA: Record<
  TipoDeAviso,
  { Icone: typeof Bell; cor: string; rotulo: string; fonte: string }
> = {
  pedido: {
    Icone: ShoppingBag,
    cor: "#34D399",
    rotulo: "Pedido",
    fonte: "pedidos",
  },
  cancelamento: {
    Icone: XCircle,
    cor: "#FF8BB2",
    rotulo: "Cancelado",
    fonte: "cancelamentos de clientes",
  },
  devolucao: {
    Icone: RotateCcw,
    cor: "#BA9AFF",
    rotulo: "Devolução",
    fonte: "devoluções",
  },
  privacidade: {
    Icone: ShieldCheck,
    cor: "#2DD4BF",
    rotulo: "Privacidade",
    fonte: "pedidos de privacidade",
  },
  recebimento: {
    Icone: Wallet,
    cor: "#66CEDC",
    rotulo: "Pagamento",
    fonte: "pagamentos por marcar",
  },
  pergunta: {
    Icone: MessageSquare,
    cor: "#69C8FF",
    rotulo: "Pergunta",
    fonte: "perguntas",
  },
  avaliacao: {
    Icone: Star,
    cor: "#E9BA7C",
    rotulo: "Avaliação",
    fonte: "avaliações",
  },
  estoque: {
    Icone: Package,
    cor: "#FF9F5A",
    rotulo: "Estoque",
    fonte: "produtos",
  },
};

const NOME_DA_FONTE = new Map(
  Object.entries(APARENCIA).map(([tipo, { fonte }]) => [tipo, fonte]),
);

function formatarQuando(quando: string): string {
  if (!quando) return "";
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
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
    <article className="break-words rounded-2xl border border-white/10 bg-[#17171C]">
      <h3>
        <button
          ref={botaoDoCartao}
          type="button"
          aria-expanded={aberta}
          aria-controls={conteudoId}
          onClick={alternar}
          className={`flex min-h-11 w-full items-start gap-3 rounded-2xl p-3.5 text-left hover:bg-white/5 ${FOCO}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/10 text-violet-300">
            <Sparkles aria-hidden="true" className="size-5" />
          </span>
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
              <span className="mt-2 flex w-fit items-center gap-1.5 rounded-full bg-sky-400/10 px-2 py-1 text-[11px] font-semibold text-sky-300">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-sky-300"
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

      <div
        id={conteudoId}
        hidden={!aberta}
        className="mx-3.5 space-y-3 border-t border-white/10 py-3.5"
      >
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
            className={`${SECUNDARIO} w-full`}
          >
            <CheckCircle2 aria-hidden="true" className="size-4" />
            Marcar como lida
          </button>
        )}
      </div>
    </article>
  );
}

function NovidadesDoApp({
  novidades,
  naoLidas,
  tituloId,
}: {
  novidades: ReadonlyArray<Readonly<Novidade>>;
  naoLidas: number;
  tituloId: string;
}) {
  const titulo = useRef<HTMLHeadingElement>(null);

  if (novidades.length === 0) return null;

  return (
    <section aria-labelledby={tituloId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          ref={titulo}
          id={tituloId}
          tabIndex={-1}
          className={`scroll-mt-40 rounded text-lg font-bold text-zinc-50 ${FOCO}`}
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
            className={SECUNDARIO}
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
  const privacidade = aviso.tipo === "privacidade";
  // Os valores e estados abaixo já estão no texto do hook. Não há nova consulta.
  const valor = aviso.detalhe.match(/^R\$\s*[\d.,]+/)?.[0];
  const detalhe = valor
    ? aviso.detalhe.slice(valor.length).replace(/^\s*—\s*/, "")
    : aviso.detalhe;
  const recebimento =
    aviso.tipo === "recebimento"
      ? aviso.titulo
          .replace(/ entregue: você já recebeu o pagamento\?$/, "")
          .split(/ de (.*)/s)
      : null;
  const orientacao =
    aviso.tipo === "cancelamento"
      ? detalhe.includes("avise o transporte")
        ? "Avise o transporte"
        : detalhe.includes("confira o pedido")
          ? "Confira o pedido"
          : ""
      : "";
  // Cancelamento não ganha selo "Pago": o hook também entrega pedidos já estornados
  // com a mesma frase, e o selo afirmaria um estado financeiro que ele não sabe.
  const status = recebimento ? "Entregue" : "";

  return (
    <button
      type="button"
      data-aviso={aviso.tipo}
      style={{ color: cor }}
      onClick={() => onNavigate(aviso.destino.view, aviso.destino.id)}
      className={`group block min-h-11 w-full min-w-0 whitespace-pre-line break-words rounded-2xl border p-3.5 text-left transition-colors hover:border-white/30 ${FOCO} ${
        privacidade
          ? "border-rose-300/20 bg-gradient-to-b from-[#25191D] to-[#151115]"
          : orientacao
            ? "border-rose-300/20 bg-gradient-to-b from-[#23171F] to-[#101013]"
            : "border-white/10 bg-[#101013]"
      }`}
    >
      <div className="mb-2 flex items-start gap-2">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-xl border"
          style={{ backgroundColor: `${cor}26`, borderColor: `${cor}40` }}
        >
          <Icone aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1 pt-1 text-[11px] font-bold uppercase leading-none tracking-wider">
          {rotulo}
        </span>
        {quando && (
          <time
            dateTime={aviso.quando}
            className="shrink-0 pt-0.5 text-[11px] text-zinc-400"
          >
            {quando}
          </time>
        )}
      </div>

      <div className="flex items-start gap-3">
        <h3
          className={`min-w-0 flex-1 text-[15px] font-bold leading-snug ${privacidade ? "text-rose-300" : "text-zinc-50"}`}
        >
          {recebimento ? "Confirmar recebimento" : aviso.titulo}
        </h3>
        {!privacidade && (
          <ChevronRight
            aria-hidden="true"
            className="size-5 shrink-0 text-zinc-400"
          />
        )}
      </div>

      {recebimento && (
        <>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-zinc-50">
            Você já recebeu o pagamento?
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
            {recebimento[0]} entregue
          </p>
          {recebimento[1] && (
            <p className="text-[13px] leading-relaxed text-zinc-400">
              {recebimento[1]}
            </p>
          )}
        </>
      )}
      {!recebimento && detalhe && (
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
          {privacidade
            ? detalhe.replace("Abra Ajustes > Minha loja. ", "")
            : detalhe}
        </p>
      )}
      {valor && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-lg font-bold leading-snug tracking-tight text-zinc-50">
            {valor}
          </p>
          {status && (
            <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-zinc-300">
              {status}
            </span>
          )}
        </div>
      )}
      {recebimento && (
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400 first-letter:uppercase">
          {detalhe}
        </p>
      )}

      {privacidade && (
        <>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-zinc-50">
            Responder em Ajustes &gt; Minha loja
          </p>
          <span className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#F8D25A] to-[#E2A81E] p-3 text-sm font-bold text-[#1B1300]">
            <ChevronRight aria-hidden="true" className="size-5" />
            Revisar privacidade
          </span>
        </>
      )}
      {orientacao && (
        <span
          data-orientacao
          className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-rose-400/10 px-3 py-2 text-sm font-bold text-rose-300"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{orientacao}</span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
        </span>
      )}
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
    <section data-bloco={nome} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-zinc-50">{titulo}</h2>
          <p className="mt-0.5 text-xs text-zinc-400">{legenda}</p>
        </div>
        {nome === "precisa-de-voce" && (
          <span className="text-3xl font-bold leading-none text-zinc-50">
            {avisos.length}
          </span>
        )}
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
 * O montador decide o que vira aviso e o que conta no sino. A apresentação
 * põe privacidade primeiro, sem alterar a ordem dos demais nem o retrato do hook.
 */
export const AdminNotificationsView = memo(function AdminNotificationsView({
  onNavigate,
}: AdminNotificationsViewProps) {
  const { avisos, carregando, fontesComFalha, recarregar } =
    useAvisosDoLojista();
  const { novidades, naoLidas } = useNovidadesDoAparelho();
  const novidadesId = useId();

  // A fonte só entrega a contagem de privacidade: não informa data nem atraso.
  const pendencias = avisos.filter((aviso) => aviso.contaNoCracha);
  const precisaDeVoce = [
    ...pendencias.filter((aviso) => aviso.tipo === "privacidade"),
    ...pendencias.filter((aviso) => aviso.tipo !== "privacidade"),
  ];
  const deOlho = avisos.filter((aviso) => !aviso.contaNoCracha);

  return (
    <div className="pb-admin min-h-screen bg-[#08080A] text-zinc-50 duration-200 animate-in fade-in lg:pb-12">
      <div className="sticky top-0 z-20 bg-[#08080A]/95 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-admin-gold/30 bg-admin-gold/10 text-admin-gold">
              <Bell className="size-4" />
            </div>
            <div className="[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:normal-case [&_h1]:tracking-tight [&_h1_span]:not-italic">
              <AdminPageHeader
                titulo={NOMES_DO_PAINEL["admin-notifications"]}
              />
            </div>
          </div>

          <button
            type="button"
            data-acao="recarregar"
            onClick={recarregar}
            aria-label="Atualizar os avisos"
            title="Atualizar os avisos"
            className={`${SECUNDARIO} min-w-11 shrink-0`}
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-5 ${carregando ? "animate-spin text-sky-300" : "text-zinc-400"}`}
            />
          </button>
        </div>
        <p
          role="status"
          className={`mx-auto mt-2 max-w-3xl text-sm ${carregando ? "text-sky-300" : "text-zinc-400"}`}
        >
          {carregando
            ? "Atualizando os avisos..."
            : "O que está esperando por você"}
        </p>
      </div>

      <div className="mx-auto max-w-3xl space-y-7 px-5 pb-6 pt-2">
        {naoLidas > 0 && (
          <a
            href={`#${novidadesId}`}
            className={`flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-[#17171C] px-3 py-2 text-sm text-violet-300 ${FOCO}`}
          >
            <Sparkles aria-hidden="true" className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              {naoLidas}{" "}
              {naoLidas === 1 ? "novidade não lida" : "novidades não lidas"}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-zinc-400"
            />
          </a>
        )}

        {fontesComFalha.length > 0 && (
          <div
            role="alert"
            className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3.5"
          >
            <div className="flex items-center gap-2 text-amber-300">
              <TriangleAlert aria-hidden="true" className="size-6 shrink-0" />
              <h2 className="text-[15px] font-bold">
                {fontesComFalha.length}{" "}
                {fontesComFalha.length === 1
                  ? "fonte sem atualização"
                  : "fontes sem atualização"}
              </h2>
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-300">
              Não consegui conferir{" "}
              {fontesComFalha
                .map((fonte) => NOME_DA_FONTE.get(fonte) ?? fonte)
                .join(", ")}{" "}
              agora. O resto da lista está completo — toque em atualizar para
              tentar de novo.
            </p>
            <button
              type="button"
              onClick={recarregar}
              className={`${SECUNDARIO} w-full`}
            >
              <RefreshCw
                aria-hidden="true"
                className={`size-4 ${carregando ? "animate-spin" : ""}`}
              />
              Atualizar os avisos
            </button>
          </div>
        )}

        <Bloco
          nome="precisa-de-voce"
          titulo="Precisa de você"
          legenda={`${precisaDeVoce.length} ${
            precisaDeVoce.length === 1 ? "pendência" : "pendências"
          } no total`}
          avisos={precisaDeVoce}
          onNavigate={onNavigate}
        />

        <Bloco
          nome="de-olho"
          titulo="De olho"
          legenda={`${deOlho.length} ${deOlho.length === 1 ? "aviso" : "avisos"} · não conta no sino`}
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
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-gradient-to-b from-emerald-400/10 to-[#101013] px-6 py-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 aria-hidden="true" className="size-6" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-50">
              Tudo em dia
            </h2>
            <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
              Nenhum pedido, devolução, pergunta ou avaliação esperando por
              você, e nenhum produto acabando.
            </p>
          </div>
        )}

        <NovidadesDoApp
          novidades={novidades}
          naoLidas={naoLidas}
          tituloId={novidadesId}
        />
        {avisos.length > 0 && (
          <p className="py-2 text-center text-xs text-zinc-400">
            {avisos.length} {avisos.length === 1 ? "aviso" : "avisos"} ·{" "}
            {precisaDeVoce.length}{" "}
            {precisaDeVoce.length === 1 ? "pendência" : "pendências"} no sino
          </p>
        )}
      </div>
    </div>
  );
});

export default AdminNotificationsView;
