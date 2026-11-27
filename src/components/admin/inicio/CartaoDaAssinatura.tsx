import { EstadoComPonto } from "@/components/admin/primitivos/EstadoComPonto";
import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { useAgoraDoPainel } from "@/hooks/useAgoraDoPainel";
import {
  avisoDaMensalidadeEmAberto,
  avisoDasVendasPausadas,
  avisoDoTesteEncerrado,
  contagemDoTeste,
  formatarData,
  formatarDiaEMes,
  formatarMoeda,
  infoDoStatusDaAssinatura,
  linhasDeDatasDaAssinatura,
} from "@/lib/crm";
import { avisoDaSuspensa } from "@/lib/situacao-das-vendas";
import type { TomDeEstado } from "@/lib/tons-de-estado";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type {
  AssinaturaDaLoja,
  SituacaoDasVendas,
  StatusDaAssinatura,
} from "@/types/painel";
import { Check, Crown, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import {
  BOTAO_INICIO,
  FalhaDoInicio,
  ROTULO_INICIO,
  TileDoInicio,
  VALOR_INICIO,
} from "./visualDoInicio";

const MAXIMO_DE_RECURSOS = 6;

/** Por que existe o aviso: o teste que acabou ou a mensalidade da pagante. */
function fraseDoVencimento(
  doTeste: boolean,
  valorMensal: number,
  venceuEm: string,
): string {
  return doTeste
    ? `Seu teste grátis acabou. A primeira mensalidade, de ${formatarMoeda(valorMensal)}, venceu em ${formatarDiaEMes(venceuEm)}.`
    : `A mensalidade de ${formatarMoeda(valorMensal)} venceu em ${formatarDiaEMes(venceuEm)}.`;
}

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
  situacaoDasVendas,
  lida,
  carregando,
  erro,
  onTentarDeNovo,
}: Readonly<{
  assinatura: AssinaturaDaLoja | null;
  /**
   * A resposta de `situacao_das_vendas_da_loja()`: só com ela o cartão diz
   * "pausadas". Ausente ou `null` ("não sei"): nunca afirma pausa.
   */
  situacaoDasVendas?: SituacaoDasVendas | null;
  lida: boolean;
  carregando: boolean;
  erro: string | null;
  onTentarDeNovo: () => void;
}>) {
  // O mesmo pulso dos outros cartões: a contagem do teste vira à meia-noite.
  const agora = useAgoraDoPainel();
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
          Seu plano vai aparecer aqui
        </p>
        {/* Sem "nada muda na sua loja": o teste pode acabar sem pagamento e a
            loja pausar os pedidos antes de o cartão chegar (26/11/2026). */}
        <p className="text-sm leading-relaxed text-zinc-400">
          Estamos ligando a sua assinatura a este painel.
        </p>
      </section>
    );
  }

  // Suspensa: quem diz se os pedidos pela loja PARARAM é o banco (27/11/2026).
  // Ele diz que sim → "pausadas", desde o dia dele, e como voltar (texto 3 da
  // decisão da pausa). Ele aceita pedido apesar da suspensa → a mensalidade em
  // aberto, sem afirmar pausa. Sem a resposta dele, manutenção ou sinal
  // incompleto (Savy, IKCOUS) → o cartão de hoje.
  const suspensa = avisoDaSuspensa(
    assinatura,
    situacaoDasVendas,
    avisoDasVendasPausadas(assinatura, new Date(agora)),
  );
  const pausadas = suspensa?.tipo === "pausadas" ? suspensa : null;
  const emAberto = suspensa?.tipo === "em-aberto" ? suspensa.vencimento : null;
  // Teste que acabou sem pagamento NÃO é dívida: com o sinal completo da
  // gestão o cartão diz "Teste encerrado" e o prazo; sinal torto → cartão de
  // hoje (`avisoDoTesteEncerrado` devolve null). Com a pausa valendo, nenhum
  // prazo: "pague até" já passou.
  const aviso = pausadas
    ? null
    : avisoDoTesteEncerrado(assinatura, new Date(agora));
  // A pagante atrasada com o dia da pausa da gestão: "Mensalidade em aberto" e
  // o prazo. O aviso do teste tem prioridade; sem `pausa_em` (Savy, IKCOUS) o
  // cartão continua o de hoje.
  const avisoPagante =
    pausadas || aviso
      ? null
      : avisoDaMensalidadeEmAberto(assinatura, new Date(agora));
  const prazo =
    aviso ??
    avisoPagante ??
    (emAberto ? { ...emAberto, pagueAte: null, pausaEm: null } : null);
  const prazoDoTeste = aviso !== null || emAberto?.doTeste === true;
  const estado: { tom: TomDeEstado; texto: string } = pausadas
    ? {
        tom: "negativo",
        texto: pausadas.pausadasDesde
          ? `Vendas pela loja pausadas desde ${formatarDiaEMes(pausadas.pausadasDesde)}`
          : "Vendas pela loja pausadas",
      }
    : prazo
      ? {
          tom: "atencao",
          texto: prazoDoTeste ? "Teste encerrado" : "Mensalidade em aberto",
        }
      : estadoDoPlano(assinatura.status);
  const suporte = linkWhatsappDoCliente(assinatura.suporteWhatsapp);
  const recursosVisiveis = assinatura.recursos.slice(0, MAXIMO_DE_RECURSOS);
  const recursosEscondidos =
    assinatura.recursos.length - recursosVisiveis.length;
  const precisaRegularizar =
    !prazo &&
    !pausadas &&
    (assinatura.status === "atrasada" ||
      assinatura.status === "suspensa" ||
      assinatura.status === "pendente");
  // Em teste o preço não é destaque: vira a linha pequena "Depois, ...".
  const emTeste = assinatura.status === "teste";
  const contagem = emTeste
    ? contagemDoTeste(assinatura.testeAte, new Date(agora))
    : null;
  // No teste encerrado, na mensalidade em aberto e nas vendas pausadas somem
  // "Em aberto desde", "Próxima cobrança" e "Teste até": fica só "Cliente
  // desde", montada direto de `inicioEm`.
  const todasAsDatas =
    prazo || pausadas
      ? assinatura.inicioEm
        ? [{ rotulo: "Cliente desde", data: assinatura.inicioEm }]
        : []
      : linhasDeDatasDaAssinatura(assinatura);
  // `valorMensal` é o valor da PRÓXIMA cobrança (27/11/2026): o 1º mês
  // negociado, o restante de um pagamento parcial ou o preço de depois do
  // contrato — com "/mês" a lojista lia R$ 175,00/mês, o que é falso. Com conta
  // vencida (prazo, pausa, regularizar) o mesmo valor é o que está em aberto,
  // nunca "próxima". Sem conta vencida, a data da próxima cobrança sai da
  // lista e vai para junto do valor: o rótulo aparece uma vez só.
  // Cancelada não tem próxima cobrança: o valor some (revisão 27/11/2026).
  const mostraValor =
    assinatura.valorMensal != null &&
    !emTeste &&
    assinatura.status !== "cancelada";
  const temContaVencida = Boolean(prazo || pausadas || precisaRegularizar);
  const dataDaCobranca =
    mostraValor && !temContaVencida
      ? (todasAsDatas.find((l) => l.rotulo === "Próxima cobrança")?.data ??
        null)
      : null;
  // Com conta vencida a linha "Próxima cobrança" também sai: em pendente e
  // suspensa a gestão não diz que essa data é o vencimento do valor em aberto,
  // e "Valor em aberto" com "Próxima cobrança" embaixo diz duas coisas. A
  // atrasada segue com "Em aberto desde", que fala do mesmo valor.
  const linhasDeDatas =
    dataDaCobranca || temContaVencida
      ? todasAsDatas.filter((l) => l.rotulo !== "Próxima cobrança")
      : todasAsDatas;

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
      {mostraValor && assinatura.valorMensal != null ? (
        <dl>
          <dt className={ROTULO_INICIO}>
            {temContaVencida ? "Valor em aberto" : "Próxima cobrança"}
          </dt>
          <dd className={`mt-1 text-2xl ${VALOR_INICIO}`}>
            {formatarMoeda(assinatura.valorMensal)}
          </dd>
          {dataDaCobranca ? (
            <dd className="mt-1 text-sm tabular-nums text-zinc-400">
              em {formatarData(dataDaCobranca)}
            </dd>
          ) : null}
        </dl>
      ) : null}
      <dl className="space-y-3 text-sm">
        {linhasDeDatas.map(({ rotulo, data }) => (
          <div
            key={rotulo}
            className="flex flex-wrap justify-between gap-x-3 gap-y-1"
          >
            <dt className="text-zinc-400">{rotulo}</dt>
            <dd className="font-medium tabular-nums text-white">
              {formatarData(data)}
            </dd>
          </div>
        ))}
      </dl>
      {contagem ? (
        <p className="text-sm font-medium text-white">{contagem}</p>
      ) : null}
      {/* Cortesia (valor 0) não tem "depois" a cobrar. Só a PRIMEIRA
          mensalidade: o valor é o da próxima cobrança, não o de todo mês. */}
      {emTeste &&
      assinatura.valorMensal != null &&
      assinatura.valorMensal > 0 ? (
        <p className="text-sm leading-relaxed text-zinc-400">
          Depois, a primeira mensalidade é de{" "}
          {formatarMoeda(assinatura.valorMensal)}.
        </p>
      ) : null}
      {prazo ? (
        <>
          <p className="text-sm font-medium leading-relaxed text-white">
            {fraseDoVencimento(prazoDoTeste, prazo.valorMensal, prazo.venceuEm)}
          </p>
          <p
            className={cn("text-sm leading-relaxed", classeDoTexto("atencao"))}
          >
            {prazo.pagueAte && prazo.pausaEm
              ? `Para continuar vendendo, pague até ${formatarDiaEMes(prazo.pagueAte)}. Sem o pagamento, os pedidos pela loja ficam pausados a partir de ${formatarDiaEMes(prazo.pausaEm)}.`
              : "Para continuar vendendo, pague a mensalidade."}
          </p>
          <p className="text-sm leading-relaxed text-zinc-400">
            Já pagou? Assim que confirmarmos o pagamento, este aviso some
            sozinho.
          </p>
        </>
      ) : null}
      {pausadas ? (
        <>
          {pausadas.vencimento ? (
            <p className="text-sm font-medium leading-relaxed text-white">
              {fraseDoVencimento(
                pausadas.vencimento.doTeste,
                pausadas.vencimento.valorMensal,
                pausadas.vencimento.venceuEm,
              )}
            </p>
          ) : null}
          <p
            className={cn("text-sm leading-relaxed", classeDoTexto("negativo"))}
          >
            Seus clientes não conseguem fazer pedidos novos pela loja. Pedidos
            já feitos, entregas, devoluções, estornos e vendas no balcão
            continuam funcionando. Assim que confirmarmos o pagamento da
            mensalidade, as vendas voltam sozinhas.
          </p>
        </>
      ) : null}
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
