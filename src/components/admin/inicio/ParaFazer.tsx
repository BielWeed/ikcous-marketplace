import { formatarInteiro } from "@/lib/crm";
import {
  type TomDeEstado,
  classeDoIcone,
  classeDoTexto,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
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
}: Readonly<{
  painel: PainelInicio | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
  preparoEmDestaque?: boolean;
}>) {
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
        : "Abra para vender no balcão · Financeiro",
      contagem: null,
      pendente: caixaAberto,
      destino: "admin-financeiro",
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
    },
  ];
  const pendentes = itens.filter((item) => item.pendente).length;
  const esqueleto = carregando && !painel;
  const visiveis = itens.filter(
    (item) =>
      !(item.chave === "preparar" && preparoEmDestaque && item.pendente) &&
      (item.pendente || item.chave === "caixa" || item.contagem == null),
  );

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
            {painel && pendentes === 0 ? (
              <li className="flex items-center gap-3 py-3">
                <TileDoInicio icone={CheckCircle2} tom="positivo" />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-base font-semibold",
                      classeDoTexto("positivo"),
                    )}
                  >
                    Tudo em dia
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    Nenhuma pendência para resolver.
                  </p>
                </div>
              </li>
            ) : null}
            {visiveis.map((item) => (
              <li key={item.chave}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.destino)}
                  aria-label={`${item.rotulo}: ${item.titulo}. ${item.descricao}`}
                  className={LINHA_INICIO}
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
          </ul>
        )}
      </div>
    </section>
  );
}
