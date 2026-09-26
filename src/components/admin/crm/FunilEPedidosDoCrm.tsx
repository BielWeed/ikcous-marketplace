import {
  formatarInteiro,
  formatarPercentual,
  idadeCurta,
  rotuloDoStatusDoPedido,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { EtapaDoPipeline, FunilDoCrm, VisaoDoCrm } from "@/types/crm";
import { ChevronRight, Clock } from "lucide-react";
import { useEffect, useState } from "react";

const PASSOS_DO_FUNIL: readonly {
  readonly chave: keyof FunilDoCrm;
  readonly rotulo: string;
}[] = [
  { chave: "visitas", rotulo: "Visitas" },
  { chave: "produtosVistos", rotulo: "Produtos vistos" },
  { chave: "carrinhos", rotulo: "Carrinhos" },
  { chave: "pedidosCriados", rotulo: "Pedidos criados" },
  { chave: "pedidosPagos", rotulo: "Pedidos pagos" },
];

function valorDoPasso(
  funil: FunilDoCrm,
  chave: keyof FunilDoCrm,
): number | null {
  switch (chave) {
    case "visitas":
      return funil.visitas;
    case "produtosVistos":
      return funil.produtosVistos;
    case "carrinhos":
      return funil.carrinhos;
    case "pedidosCriados":
      return funil.pedidosCriados;
    case "pedidosPagos":
      return funil.pedidosPagos;
  }
}

/** Ordem de trabalho do lojista; status desconhecido vai para o fim. */
const ORDEM_DO_PIPELINE = [
  "new",
  "pending",
  "processing",
  "shipping",
  "delivered",
  "cancelled",
];

function ordenarPipeline(
  etapas: readonly EtapaDoPipeline[],
): EtapaDoPipeline[] {
  const posicao = (status: string) => {
    const indice = ORDEM_DO_PIPELINE.indexOf(status);
    return indice === -1 ? ORDEM_DO_PIPELINE.length : indice;
  };
  return [...etapas].sort((a, b) => posicao(a.status) - posicao(b.status));
}

/** Status que ainda esperam o lojista agir — onde a idade importa. */
const ESPERAM_O_LOJISTA = new Set(["new", "pending", "processing"]);
const DOIS_DIAS_MS = 2 * 86_400_000;

function Funil({ funil }: Readonly<{ funil: FunilDoCrm }>) {
  const valores = PASSOS_DO_FUNIL.map((passo) =>
    valorDoPasso(funil, passo.chave),
  );
  const topo = valores.reduce<number>(
    (maior, valor) => (valor != null && valor > maior ? valor : maior),
    0,
  );
  const primeiro = valores.at(0) ?? null;
  const ultimo = valores.at(-1) ?? null;
  const conversaoTotal =
    primeiro != null && primeiro > 0 && ultimo != null
      ? (ultimo / primeiro) * 100
      : null;

  return (
    <section
      aria-labelledby="crm-funil-titulo"
      className="admin-glass space-y-4 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="crm-funil-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Funil do app
        </h2>
        {conversaoTotal != null ? (
          <p className="text-[11px] text-zinc-400">
            Conversão total{" "}
            <strong className="font-bold tabular-nums text-white">
              {formatarPercentual(conversaoTotal, 2)}
            </strong>
          </p>
        ) : null}
      </div>

      <ol className="space-y-3">
        {PASSOS_DO_FUNIL.map((passo, indice) => {
          const valor = valores.at(indice) ?? null;
          const anterior = indice > 0 ? (valores.at(indice - 1) ?? null) : null;
          const conversao =
            valor != null && anterior != null && anterior > 0
              ? (valor / anterior) * 100
              : null;
          const largura = valor != null && topo > 0 ? (valor / topo) * 100 : 0;
          return (
            <li key={passo.chave} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="font-bold text-zinc-200">{passo.rotulo}</span>
                <span className="tabular-nums text-zinc-400">
                  <strong className="font-bold text-white">
                    {formatarInteiro(valor)}
                  </strong>
                  {indice > 0 ? (
                    <span className="ml-2">
                      {conversao == null
                        ? "—"
                        : `${formatarPercentual(conversao)} do passo anterior`}
                    </span>
                  ) : null}
                </span>
              </div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800/80"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-emerald-400/80"
                  style={{ width: `${Math.max(largura, valor ? 1 : 0)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Visitas, produtos vistos e carrinhos vêm do app; vendas do balcão não
        passam por essas etapas.
      </p>
    </section>
  );
}

function Pipeline({
  etapas,
  onNavigate,
}: Readonly<{
  etapas: readonly EtapaDoPipeline[];
  onNavigate: (view: View) => void;
}>) {
  const ordenadas = ordenarPipeline(etapas);
  // "Agora" é fotografado junto com os dados: cada leitura nova do pipeline
  // recalcula as idades (render continua puro).
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    setAgora(Date.now());
  }, [etapas]);
  return (
    <section
      aria-labelledby="crm-pipeline-titulo"
      className="admin-glass space-y-4 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <h2
        id="crm-pipeline-titulo"
        className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
      >
        Pedidos por status
      </h2>
      {ordenadas.length === 0 ? (
        <p className="text-xs text-zinc-500">Nenhum pedido no período.</p>
      ) : (
        <ul className="space-y-1.5">
          {ordenadas.map((etapa) => {
            const idade = idadeCurta(etapa.maisAntigoEm, agora);
            const instante = etapa.maisAntigoEm
              ? Date.parse(etapa.maisAntigoEm)
              : Number.NaN;
            const parado =
              ESPERAM_O_LOJISTA.has(etapa.status) &&
              etapa.quantidade > 0 &&
              !Number.isNaN(instante) &&
              agora - instante > DOIS_DIAS_MS;
            return (
              <li key={etapa.status}>
                <button
                  type="button"
                  onClick={() => onNavigate("admin-orders")}
                  className="group flex min-h-12 w-full items-center gap-3 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2 text-left transition-colors hover:border-white/10 hover:bg-zinc-900/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-white">
                      {rotuloDoStatusDoPedido(etapa.status)}
                    </span>
                    {idade && ESPERAM_O_LOJISTA.has(etapa.status) ? (
                      <span
                        className={cn(
                          "mt-0.5 flex items-center gap-1 text-[11px]",
                          parado ? "text-amber-300" : "text-zinc-500",
                        )}
                      >
                        <Clock className="size-3" aria-hidden="true" />
                        Mais antigo há {idade}
                        {parado ? " — parado" : ""}
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-8 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-center text-[11px] font-black tabular-nums text-zinc-200">
                    {formatarInteiro(etapa.quantidade)}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Aba "Funil e pedidos": do olhar à compra paga, e onde os pedidos param. */
export function FunilEPedidosDoCrm({
  visao,
  carregando,
  onNavigate,
}: Readonly<{
  visao: VisaoDoCrm | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
}>) {
  if (carregando && !visao) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
        <div className="premium-shimmer h-72 rounded-2xl" />
        <div className="premium-shimmer h-72 rounded-2xl" />
      </div>
    );
  }
  if (!visao) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <Funil funil={visao.funil} />
      <Pipeline etapas={visao.pipeline} onNavigate={onNavigate} />
    </div>
  );
}
