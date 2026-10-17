import { formatarInteiro } from "@/lib/crm";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import {
  AlertTriangle,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronRight,
  Package,
  RotateCcw,
  Wallet,
} from "lucide-react";
import {
  CARTAO_INICIO,
  LINHA_INICIO,
  SeloDoInicio,
  TituloDoInicio,
} from "./visualDoInicio";

/** Só pendências conhecidas e o estado do caixa; desconhecido continua como —. */
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
  const itens = [
    {
      chave: "preparar",
      icone: Package,
      tom: "azul",
      rotulo: "Pedidos para preparar",
      titulo: `${formatarInteiro(preparar)} ${preparar === 1 ? "pedido para preparar" : "pedidos para preparar"}`,
      descricao: "Abrir Pedidos",
      contagem: preparar,
      pendente: (preparar ?? 0) > 0,
      destino: "admin-orders",
    },
    {
      chave: "vencidas",
      icone: ArrowUpFromLine,
      tom: "laranja",
      rotulo: "Contas vencidas",
      titulo: `${formatarInteiro(vencidas)} ${vencidas === 1 ? "conta vencida" : "contas vencidas"}`,
      descricao: "Financeiro",
      contagem: vencidas,
      pendente: (vencidas ?? 0) > 0,
      destino: "admin-financeiro",
    },
    {
      chave: "devolucoes",
      icone: RotateCcw,
      tom: "rosa",
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
      tom: "teal",
      rotulo: "Caixa",
      titulo: !painel
        ? "Caixa —"
        : caixaAberto
          ? "Caixa aberto"
          : "Caixa fechado",
      descricao: caixaAberto
        ? "Feche no fim do dia · Financeiro"
        : "Abrir Financeiro",
      contagem: null,
      pendente: caixaAberto,
      destino: "admin-financeiro",
    },
    {
      chave: "estoque",
      icone: Package,
      tom: "azul",
      rotulo: "Produtos com estoque baixo",
      titulo: `${formatarInteiro(estoque)} ${estoque === 1 ? "produto com estoque baixo" : "produtos com estoque baixo"}`,
      descricao: "Repor estoque · Produtos",
      contagem: estoque,
      pendente: (estoque ?? 0) > 0,
      destino: "admin-products",
    },
  ] as const;
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
      <div className="flex items-start justify-between gap-3">
        <TituloDoInicio
          id="inicio-para-fazer-titulo"
          icone={AlertTriangle}
          tom="laranja"
        >
          Para fazer
        </TituloDoInicio>
        {painel && pendentes > 0 ? (
          <span className="pt-2 text-xs font-bold text-orange-300">
            AGORA
            <span className="sr-only">
              {" "}
              · {pendentes} {pendentes === 1 ? "pendência" : "pendências"}
            </span>
          </span>
        ) : null}
      </div>
      <div className={CARTAO_INICIO}>
        {painel && pendentes === 0 ? (
          <div className="mb-1 flex items-start gap-3 border-b border-white/10 pb-3">
            <SeloDoInicio icone={CheckCircle2} tom="verde" />
            <div>
              <p className="text-base font-bold text-white">Tudo em dia</p>
              <p className="mt-1 text-sm text-zinc-400">
                Nenhuma pendência para resolver.
              </p>
            </div>
          </div>
        ) : null}
        {esqueleto ? (
          <div className="space-y-3" aria-hidden="true">
            <div className="premium-shimmer h-5 w-3/4 rounded-lg" />
            <div className="premium-shimmer h-5 w-2/3 rounded-lg" />
            <p className="text-sm text-zinc-400">
              Aguardando os dados. Zero só após confirmar.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/10">
            {visiveis.map((item) => (
              <li key={item.chave}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.destino)}
                  aria-label={`${item.rotulo}: ${item.titulo}. ${item.descricao}`}
                  className={LINHA_INICIO}
                >
                  <SeloDoInicio icone={item.icone} tom={item.tom} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold leading-snug text-white">
                      {item.titulo}
                    </span>
                    <span className="mt-1 block text-sm text-zinc-400">
                      {item.descricao}
                    </span>
                  </span>
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
