import { EstadoComPonto } from "@/components/admin/primitivos/EstadoComPonto";
import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import {
  formatarData,
  formatarMoeda,
  infoDoStatusDaAssinatura,
  rotuloDoCiclo,
} from "@/lib/crm";
import type { TomDeEstado } from "@/lib/tons-de-estado";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { AssinaturaDaLoja, StatusDaAssinatura } from "@/types/painel";
import { Check, Crown, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import {
  BOTAO_INICIO,
  FalhaDoInicio,
  TileDoInicio,
  VALOR_INICIO,
} from "./visualDoInicio";

const MAXIMO_DE_RECURSOS = 6;

/** O status do contrato na cor do significado: pontinho + texto. */
function estadoDoPlano(status: StatusDaAssinatura | null): {
  tom: TomDeEstado;
  texto: string;
} {
  const info = infoDoStatusDaAssinatura(status);
  const tom: TomDeEstado =
    info.tom === "otimo"
      ? "positivo"
      : info.tom === "crescendo"
        ? "info"
        : info.tom === "atencao"
          ? "atencao"
          : info.tom === "risco"
            ? "negativo"
            : "neutro";
  return { tom, texto: status === "ativa" ? "Plano ativo" : info.rotulo };
}

function Cabecalho({ estado }: Readonly<{ estado?: ReactNode }>) {
  return (
    <div className="flex items-center gap-3">
      <TileDoInicio icone={Crown} />
      <div className="min-w-0 flex-1">
        <h3
          id="inicio-assinatura-titulo"
          className="text-base font-semibold leading-snug text-white"
        >
          Sua assinatura
        </h3>
        {estado ? <p className="mt-0.5 text-sm">{estado}</p> : null}
      </div>
    </div>
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
        className="min-w-0 space-y-3 py-3"
      >
        <Cabecalho />
        {erro && !carregando ? (
          <FalhaDoInicio onTentarDeNovo={onTentarDeNovo}>{erro}</FalhaDoInicio>
        ) : (
          <div className="space-y-3" aria-hidden="true">
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
      <section
        aria-labelledby="inicio-assinatura-titulo"
        className="min-w-0 space-y-3 py-3"
      >
        <Cabecalho />
        <p className="text-base font-bold text-white">
          Plano ainda não sincronizado com a sua conta
        </p>
        <p className="text-sm leading-relaxed text-zinc-400">
          A assinatura é administrada fora do app. Assim que o sistema de
          cobrança sincronizar o seu plano, ele aparece aqui — nada muda na sua
          loja enquanto isso.
        </p>
      </section>
    );
  }

  const estado = estadoDoPlano(assinatura.status);
  const suporte = linkWhatsappDoCliente(assinatura.suporteWhatsapp);
  const recursosVisiveis = assinatura.recursos.slice(0, MAXIMO_DE_RECURSOS);
  const recursosEscondidos =
    assinatura.recursos.length - recursosVisiveis.length;
  const precisaRegularizar =
    assinatura.status === "atrasada" ||
    assinatura.status === "suspensa" ||
    assinatura.status === "pendente";

  return (
    <section
      aria-labelledby="inicio-assinatura-titulo"
      className="min-w-0 space-y-3 py-3"
    >
      <Cabecalho
        estado={<EstadoComPonto tom={estado.tom} texto={estado.texto} />}
      />
      <p className="min-w-0 break-words text-xl font-bold text-white [overflow-wrap:anywhere]">
        {assinatura.plano ?? "Plano sem nome"}
      </p>
      {assinatura.valorMensal != null ? (
        <p className={`text-2xl ${VALOR_INICIO}`}>
          {formatarMoeda(assinatura.valorMensal)}
          <span className="font-medium">{rotuloDoCiclo(assinatura.ciclo)}</span>
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
        <p
          className={cn(
            "text-sm leading-relaxed",
            classeDoTexto(estado.tom === "negativo" ? "negativo" : "atencao"),
          )}
        >
          Regularize a assinatura para manter todos os recursos da loja.
        </p>
      ) : null}
      {recursosVisiveis.length > 0 ? (
        <ul
          className="grid grid-cols-2 gap-3 border-t border-admin-border pt-4"
          aria-label="Recursos do plano"
        >
          {recursosVisiveis.map((recurso) => (
            <li
              key={recurso}
              className="flex min-w-0 items-start gap-1.5 text-sm text-zinc-400"
            >
              <Check
                className="mt-0.5 size-4 shrink-0 text-zinc-400"
                aria-hidden="true"
              />
              <span className="break-words [overflow-wrap:anywhere]">
                {recurso}
              </span>
            </li>
          ))}
          {recursosEscondidos > 0 ? (
            <li className="col-span-2 text-sm text-zinc-400">
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
          <IconeWhatsapp className="size-5 shrink-0" aria-hidden="true" />
          Suporte pelo WhatsApp
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      ) : null}
    </section>
  );
}
