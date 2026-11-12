import { formatarInteiro } from "@/lib/crm";
import {
  type TomDeEstado,
  classeDoIcone,
  classeDoTexto,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import { variacoesEsgotadas } from "@/lib/variacoes-esgotadas";
import type { Product, View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import { VISAO_ESTOQUE_BAIXO } from "@/utils/produtos-sem-custo";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Package,
  RotateCcw,
  Wallet,
} from "lucide-react";
import {
  CARTAO_LISTA_INICIO,
  LINHA_INICIO,
  TileDoInicio,
  TituloDoInicio,
} from "./visualDoInicio";

/**
 * "Loja que ainda não vendeu". Mês e hoje zerados não bastam: no dia 1 o mês
 * volta a zero para loja antiga. Conta como já vendeu quem tem receita no mês
 * anterior ou em algum dos últimos 14 dias (no dia 1 a série cobre o fim do
 * mês passado).
 */
export function lojaSemVendasAinda(painel: PainelInicio | null): boolean {
  return (
    painel?.mes?.pedidos === 0 &&
    painel.hoje?.pedidos === 0 &&
    !((painel.mes.receitaMesAnterior ?? 0) > 0) &&
    !painel.serie14d?.some((ponto) => ponto.receita > 0)
  );
}

/**
 * Só pendências conhecidas e o estado do caixa; desconhecido continua como —.
 * Cada linha: tile neutro com o glifo na cor do significado, título,
 * subtítulo e, à direita, a contagem na cor (vermelho = atraso, âmbar =
 * atenção, cinza = sem pendência).
 */
export function ParaFazer({
  painel,
  carregando,
  onNavigate,
  preparoEmDestaque = false,
  produtos,
}: Readonly<{
  painel: PainelInicio | null;
  carregando: boolean;
  onNavigate: (view: View, id?: string) => void;
  preparoEmDestaque?: boolean;
  produtos?: readonly Product[];
}>) {
  const esgotadas = variacoesEsgotadas(produtos);
  const pend = painel?.pendencias;
  const preparar = pend?.pedidosParaPreparar ?? null;
  const devolucoes = pend?.devolucoesAbertas ?? null;
  const vencidas = painel?.contasVencidas ?? null;
  const estoque = pend?.estoqueBaixo ?? null;
  const caixaAberto = pend?.caixaAberto ?? false;
  const itens: readonly {
    chave: string;
    icone: typeof Package;
    tomDoIcone: TomDeEstado;
    tomDoValor: TomDeEstado;
    tomDaDescricao: TomDeEstado;
    rotulo: string;
    titulo: string;
    descricao: string;
    contagem: number | null;
    pendente: boolean;
    destino: View;
    /** Aba/ficha com que a tela de destino abre (o `id` de `onNavigate`). */
    alvo?: string;
  }[] = [
    {
      chave: "preparar",
      icone: Package,
      tomDoIcone: "atencao",
      tomDoValor: "atencao",
      tomDaDescricao: "neutro",
      rotulo: "Pedidos para preparar",
      titulo: `${formatarInteiro(preparar)} ${preparar === 1 ? "pedido para preparar" : "pedidos para preparar"}`,
      descricao: "Abrir Pedidos",
      contagem: preparar,
      pendente: (preparar ?? 0) > 0,
      destino: "admin-orders",
    },
    {
      chave: "vencidas",
      icone: AlertTriangle,
      tomDoIcone: "negativo",
      tomDoValor: "negativo",
      tomDaDescricao: "negativo",
      rotulo: "Contas vencidas",
      titulo: `${formatarInteiro(vencidas)} ${vencidas === 1 ? "conta vencida" : "contas vencidas"}`,
      descricao: "Pagar em Financeiro",
      contagem: vencidas,
      pendente: (vencidas ?? 0) > 0,
      destino: "admin-financeiro",
      alvo: "previstos",
    },
    {
      chave: "devolucoes",
      icone: RotateCcw,
      tomDoIcone: "atencao",
      tomDoValor: "atencao",
      tomDaDescricao: "neutro",
      rotulo: "Devoluções abertas",
      titulo: `${formatarInteiro(devolucoes)} ${devolucoes === 1 ? "devolução aberta" : "devoluções abertas"}`,
      descricao: "Ver devoluções",
      contagem: devolucoes,
      pendente: (devolucoes ?? 0) > 0,
      destino: "admin-devolucoes",
    },
    {
      chave: "caixa",
      icone: Wallet,
      tomDoIcone: caixaAberto ? "atencao" : "neutro",
      tomDoValor: "neutro",
      tomDaDescricao: "neutro",
      rotulo: "Caixa",
      titulo: !painel
        ? "Caixa —"
        : caixaAberto
          ? "Caixa aberto"
          : "Caixa fechado",
      descricao: caixaAberto
        ? "Feche no fim do dia · Financeiro"
        : "Abra para conferir o dinheiro da gaveta · Financeiro",
      contagem: null,
      pendente: caixaAberto,
      destino: "admin-financeiro",
      alvo: "caixa",
    },
    {
      chave: "estoque",
      icone: Package,
      tomDoIcone: "atencao",
      tomDoValor: "atencao",
      tomDaDescricao: "neutro",
      rotulo: "Produtos com estoque baixo",
      titulo: `${formatarInteiro(estoque)} ${estoque === 1 ? "produto com estoque baixo" : "produtos com estoque baixo"}`,
      descricao: "Repor em Produtos",
      contagem: estoque,
      pendente: (estoque ?? 0) > 0,
      destino: "admin-products",
      alvo: VISAO_ESTOQUE_BAIXO,
    },
  ];
  // Loja que ainda não vendeu: o Início mostra "Sua loja começa por aqui"
  // acima, então dizer "Tudo em dia" aqui contradiz a tela.
  const semPedidosAinda = lojaSemVendasAinda(painel);
  const esqueleto = carregando && !painel;
  // Com o cartão "Preparar pedidos" já acima, a linha "preparar" sai da lista
  // (`preparoEmDestaque`): ela também sai da contagem do cabeçalho e do "Tudo
  // em dia", que têm de falar só do que a lista mostra.
  const preparoSoNoCartaoDeCima = preparoEmDestaque && (preparar ?? 0) > 0;
  const visiveis = itens.filter(
    (item) =>
      !(item.chave === "preparar" && preparoSoNoCartaoDeCima) &&
      (item.pendente || item.chave === "caixa" || item.contagem == null),
  );
  const pendentes = visiveis.filter((item) => item.pendente).length;

  return (
    <section
      aria-labelledby="inicio-para-fazer-titulo"
      aria-busy={esqueleto}
      className="min-w-0"
    >
      <TituloDoInicio
        id="inicio-para-fazer-titulo"
        lateral={
          painel && pendentes > 0 ? (
            <span className="text-xs font-semibold text-zinc-400">
              {pendentes} {pendentes === 1 ? "pendência" : "pendências"}
            </span>
          ) : null
        }
      >
        Para fazer
      </TituloDoInicio>
      <div className={cn(CARTAO_LISTA_INICIO, esqueleto && "py-4")}>
        {esqueleto ? (
          <div className="space-y-3" aria-hidden="true">
            <div className="premium-shimmer h-5 w-3/4 rounded-lg" />
            <div className="premium-shimmer h-5 w-2/3 rounded-lg" />
            <p className="text-sm text-zinc-400">
              Aguardando os dados. Zero só após confirmar.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-admin-border">
            {painel && pendentes === 0 && esgotadas.length === 0 ? (
              <li className="flex items-center gap-3 py-3">
                <TileDoInicio icone={CheckCircle2} tom="positivo" />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-base font-semibold",
                      classeDoTexto("positivo"),
                    )}
                  >
                    {preparoSoNoCartaoDeCima
                      ? "Nada mais para resolver"
                      : semPedidosAinda
                        ? "Sem pedidos por enquanto"
                        : "Tudo em dia"}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    {preparoSoNoCartaoDeCima
                      ? "Falta só preparar os pedidos, no cartão acima."
                      : semPedidosAinda
                        ? "Quando chegar o primeiro pedido, ele aparece aqui."
                        : "Nenhuma pendência para resolver."}
                  </p>
                </div>
              </li>
            ) : null}
            {visiveis.map((item) => (
              <li key={item.chave}>
                <button
                  type="button"
                  onClick={() =>
                    item.alvo
                      ? onNavigate(item.destino, item.alvo)
                      : onNavigate(item.destino)
                  }
                  aria-label={`${item.rotulo}: ${item.titulo}. ${item.descricao}`}
                  className={cn(LINHA_INICIO, "hover:bg-white/[0.02]")}
                >
                  <TileDoInicio icone={item.icone} tom={item.tomDoIcone} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold leading-snug text-white">
                      {item.titulo}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-sm",
                        classeDoTexto(item.tomDaDescricao),
                      )}
                    >
                      {item.descricao}
                    </span>
                  </span>
                  {item.chave !== "caixa" ? (
                    <span
                      className={cn(
                        "shrink-0 text-base font-bold tabular-nums",
                        classeDoIcone(
                          item.pendente ? item.tomDoValor : "neutro",
                        ),
                      )}
                    >
                      {formatarInteiro(item.contagem)}
                    </span>
                  ) : null}
                  <ChevronRight
                    className="size-5 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
            {esgotadas.slice(0, 3).map((aviso) => (
              <li key={aviso.id}>
                <button
                  type="button"
                  className={`${LINHA_INICIO} text-sm text-zinc-400`}
                  onClick={() => onNavigate("admin-products", aviso.produtoId)}
                >
                  {aviso.texto} ({aviso.detalhe})
                </button>
              </li>
            ))}
            {esgotadas.length > 3 ? (
              <li className="py-3 text-sm text-zinc-400">
                e mais {esgotadas.length - 3}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}
