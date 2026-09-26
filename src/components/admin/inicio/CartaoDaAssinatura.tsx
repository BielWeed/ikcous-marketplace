import {
  classesDoTom,
  formatarData,
  formatarMoeda,
  infoDoStatusDaAssinatura,
  rotuloDoCiclo,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { AssinaturaDaLoja, StatusDaAssinatura } from "@/types/painel";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  CloudOff,
  Crown,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";

/** Ícone do crachá de status — o texto ao lado é quem diz o estado. */
function IconeDoStatus({
  status,
}: Readonly<{ status: StatusDaAssinatura | null }>) {
  const props = { className: "size-3", "aria-hidden": true } as const;
  switch (status) {
    case "ativa":
      return <CheckCircle2 {...props} />;
    case "teste":
      return <Sparkles {...props} />;
    case "atrasada":
      return <AlertTriangle {...props} />;
    case "suspensa":
      return <Ban {...props} />;
    case "cancelada":
      return <XCircle {...props} />;
    default:
      return <Clock {...props} />;
  }
}

const MAXIMO_DE_RECURSOS = 6;

function Cabecalho() {
  return (
    <h2
      id="inicio-assinatura-titulo"
      className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
    >
      <Crown className="size-3.5 text-admin-gold" aria-hidden="true" />
      Sua assinatura
    </h2>
  );
}

/**
 * Card do plano da loja. A cobrança da mensalidade é de OUTRO sistema (o
 * app só mostra o que ele grava em `assinatura_da_loja`): sem linha, o card
 * diz a verdade — "ainda não sincronizado" — em vez de inventar um plano.
 */
export function CartaoDaAssinatura({
  assinatura,
  lida,
  carregando,
  erro,
  onTentarDeNovo,
}: Readonly<{
  assinatura: AssinaturaDaLoja | null;
  /** A leitura terminou sem erro (mesmo que o resultado seja `null`). */
  lida: boolean;
  carregando: boolean;
  erro: string | null;
  onTentarDeNovo: () => void;
}>) {
  const casca =
    "admin-glass h-full rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6";

  if (!assinatura && !lida) {
    if (erro && !carregando) {
      return (
        <section aria-labelledby="inicio-assinatura-titulo" className={casca}>
          <Cabecalho />
          <div className="mt-4 flex items-start gap-3 text-xs text-zinc-400">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-zinc-500"
              aria-hidden="true"
            />
            <p className="flex-1">{erro}</p>
          </div>
          <button
            type="button"
            onClick={onTentarDeNovo}
            className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-4 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:bg-white/5"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Tentar de novo
          </button>
        </section>
      );
    }
    return (
      <section
        aria-labelledby="inicio-assinatura-titulo"
        aria-busy="true"
        className={casca}
      >
        <Cabecalho />
        <div className="mt-4 space-y-3" aria-hidden="true">
          <div className="premium-shimmer h-6 w-1/2 rounded-lg" />
          <div className="premium-shimmer h-4 w-2/3 rounded-md" />
          <div className="premium-shimmer h-11 w-full rounded-xl" />
        </div>
      </section>
    );
  }

  if (!assinatura) {
    return (
      <section aria-labelledby="inicio-assinatura-titulo" className={casca}>
        <Cabecalho />
        <div className="mt-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900">
            <CloudOff className="size-4 text-zinc-400" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-bold text-white">
              Plano ainda não sincronizado com a sua conta
            </p>
            <p className="text-xs leading-relaxed text-zinc-400">
              A assinatura é administrada fora do app. Assim que o sistema de
              cobrança sincronizar o seu plano, ele aparece aqui — nada muda na
              sua loja enquanto isso.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const status = infoDoStatusDaAssinatura(assinatura.status);
  const classes = classesDoTom(status.tom);
  const suporte = linkWhatsappDoCliente(assinatura.suporteWhatsapp);
  const recursosVisiveis = assinatura.recursos.slice(0, MAXIMO_DE_RECURSOS);
  const recursosEscondidos =
    assinatura.recursos.length - recursosVisiveis.length;
  const precisaRegularizar =
    assinatura.status === "atrasada" ||
    assinatura.status === "suspensa" ||
    assinatura.status === "pendente";

  return (
    <section aria-labelledby="inicio-assinatura-titulo" className={casca}>
      <div className="flex items-start justify-between gap-3">
        <Cabecalho />
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
            classes.cracha,
          )}
        >
          <IconeDoStatus status={assinatura.status} />
          {status.rotulo}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-xl font-black tracking-tight text-white">
          {assinatura.plano ?? "Plano sem nome"}
        </p>
        {assinatura.valorMensal != null ? (
          <p className="text-sm font-bold tabular-nums text-zinc-300">
            {formatarMoeda(assinatura.valorMensal)}
            <span className="font-semibold text-zinc-500">
              {rotuloDoCiclo(assinatura.ciclo)}
            </span>
          </p>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
        {assinatura.proximaCobrancaEm ? (
          <div>
            <dt className="text-zinc-500">Próxima cobrança</dt>
            <dd className="font-bold tabular-nums text-white">
              {formatarData(assinatura.proximaCobrancaEm)}
            </dd>
          </div>
        ) : null}
        {assinatura.testeAte ? (
          <div>
            <dt className="text-zinc-500">Teste até</dt>
            <dd className="font-bold tabular-nums text-white">
              {formatarData(assinatura.testeAte)}
            </dd>
          </div>
        ) : null}
        {assinatura.inicioEm ? (
          <div>
            <dt className="text-zinc-500">Cliente desde</dt>
            <dd className="font-bold tabular-nums text-white">
              {formatarData(assinatura.inicioEm)}
            </dd>
          </div>
        ) : null}
      </dl>

      {precisaRegularizar ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200">
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          Regularize a assinatura para manter todos os recursos da loja.
        </p>
      ) : null}

      {recursosVisiveis.length > 0 ? (
        <ul
          className="mt-3 flex flex-wrap gap-1.5"
          aria-label="Recursos do plano"
        >
          {recursosVisiveis.map((recurso) => (
            <li
              key={recurso}
              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-300"
            >
              {recurso}
            </li>
          ))}
          {recursosEscondidos > 0 ? (
            <li className="rounded-full px-1 py-0.5 text-[10px] font-semibold text-zinc-500">
              +{recursosEscondidos}
            </li>
          ) : null}
        </ul>
      ) : null}

      {assinatura.gerenciarUrl || suporte ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {assinatura.gerenciarUrl ? (
            <a
              href={assinatura.gerenciarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-admin-gold px-4 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-admin-gold/90"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Gerenciar assinatura
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          ) : null}
          {suporte ? (
            <a
              href={suporte}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5"
            >
              <MessageCircle className="size-3.5" aria-hidden="true" />
              Suporte
              <span className="sr-only"> no WhatsApp (abre em nova aba)</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
