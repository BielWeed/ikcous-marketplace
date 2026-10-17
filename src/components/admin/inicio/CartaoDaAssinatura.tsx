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
  Check,
  CheckCircle2,
  Clock,
  Crown,
  ExternalLink,
  MessageCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  BOTAO_INICIO,
  CARTAO_INICIO,
  FalhaDoInicio,
  TituloDoInicio,
  VALOR_INICIO,
} from "./visualDoInicio";

function IconeDoStatus({
  status,
}: Readonly<{ status: StatusDaAssinatura | null }>) {
  const props = { className: "size-3.5", "aria-hidden": true } as const;
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
    <TituloDoInicio id="inicio-assinatura-titulo" icone={Crown} tom="roxo">
      Sua assinatura
    </TituloDoInicio>
  );
}

/** Exibição do contrato atual; administração e suporte continuam externos. */
export function CartaoDaAssinatura({
  assinatura,
  lida,
  carregando,
  erro,
  onTentarDeNovo,
}: Readonly<{
  assinatura: AssinaturaDaLoja | null;
  lida: boolean;
  carregando: boolean;
  erro: string | null;
  onTentarDeNovo: () => void;
}>) {
  if (!assinatura && !lida) {
    return (
      <section
        aria-labelledby="inicio-assinatura-titulo"
        aria-busy={!erro || carregando}
        className="min-w-0"
      >
        <Cabecalho />
        {erro && !carregando ? (
          <FalhaDoInicio onTentarDeNovo={onTentarDeNovo}>{erro}</FalhaDoInicio>
        ) : (
          <div className={`${CARTAO_INICIO} space-y-3`} aria-hidden="true">
            <div className="premium-shimmer h-6 w-1/2 rounded-lg" />
            <div className="premium-shimmer h-4 w-2/3 rounded-md" />
            <div className="premium-shimmer h-11 rounded-xl" />
          </div>
        )}
      </section>
    );
  }
  if (!assinatura) {
    return (
      <section aria-labelledby="inicio-assinatura-titulo" className="min-w-0">
        <Cabecalho />
        <div className={`${CARTAO_INICIO} space-y-3`}>
          <p className="text-base font-bold text-white">
            Plano ainda não sincronizado com a sua conta
          </p>
          <p className="text-sm leading-relaxed text-zinc-400">
            A assinatura é administrada fora do app. Assim que o sistema de
            cobrança sincronizar o seu plano, ele aparece aqui — nada muda na
            sua loja enquanto isso.
          </p>
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
    <section aria-labelledby="inicio-assinatura-titulo" className="min-w-0">
      <Cabecalho />
      <div className={`${CARTAO_INICIO} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 flex-1 break-words text-xl font-bold text-white [overflow-wrap:anywhere]">
            {assinatura.plano ?? "Plano sem nome"}
          </p>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold",
              classes.cracha,
            )}
          >
            <IconeDoStatus status={assinatura.status} />
            {status.rotulo}
          </span>
        </div>
        {assinatura.valorMensal != null ? (
          <p className={`text-2xl ${VALOR_INICIO}`}>
            {formatarMoeda(assinatura.valorMensal)}
            <span className="font-medium">
              {rotuloDoCiclo(assinatura.ciclo)}
            </span>
          </p>
        ) : null}
        <dl className="space-y-3 text-sm">
          {[
            ["Próxima cobrança", assinatura.proximaCobrancaEm],
            ["Teste até", assinatura.testeAte],
            ["Cliente desde", assinatura.inicioEm],
          ].map(([rotulo, data]) =>
            data ? (
              <div
                key={rotulo}
                className="flex flex-wrap justify-between gap-x-3 gap-y-1"
              >
                <dt className="text-zinc-400">{rotulo}</dt>
                <dd className="font-medium tabular-nums text-white">
                  {formatarData(data)}
                </dd>
              </div>
            ) : null,
          )}
        </dl>
        {precisaRegularizar ? (
          <p className="text-sm leading-relaxed text-orange-300">
            Regularize a assinatura para manter todos os recursos da loja.
          </p>
        ) : null}
        {recursosVisiveis.length > 0 ? (
          <ul
            className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4"
            aria-label="Recursos do plano"
          >
            {recursosVisiveis.map((recurso) => (
              <li
                key={recurso}
                className="flex min-w-0 items-start gap-1.5 text-sm text-zinc-400"
              >
                <Check
                  className="mt-0.5 size-4 shrink-0 text-violet-300"
                  aria-hidden="true"
                />
                <span className="break-words [overflow-wrap:anywhere]">
                  {recurso}
                </span>
              </li>
            ))}
            {recursosEscondidos > 0 ? (
              <li className="col-span-2 text-sm text-violet-300">
                +{recursosEscondidos} recursos incluídos
              </li>
            ) : null}
          </ul>
        ) : null}
        {assinatura.gerenciarUrl ? (
          <>
            <a
              href={assinatura.gerenciarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={BOTAO_INICIO}
            >
              <ExternalLink className="size-5 shrink-0" aria-hidden="true" />
              Gerenciar assinatura
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
            <p className="text-sm leading-relaxed text-zinc-400">
              Abre a administração da assinatura fora do app.
            </p>
          </>
        ) : null}
        {suporte ? (
          <a
            href={suporte}
            target="_blank"
            rel="noopener noreferrer"
            className={BOTAO_INICIO}
          >
            <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
            Suporte pelo WhatsApp
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
