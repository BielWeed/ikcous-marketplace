import { cn } from "@/lib/utils";

// Balao compacto do grafico "Historico da loja" (vendas e lucro/estoque).
// So apresentacao: os numeros chegam prontos do grafico, nada e recalculado.
// As cores de fundo/borda/texto sao as classes de tema que o painel ja remapeia.

// Faixa reservada acima da area de plotagem para o balao fixo no topo.
// Alturas medidas pelo revisor a 360px: vendas (data + valor, UMA linha) 62px,
// lucro/estoque (data + 2 linhas) 82px; folga de 4px em cada.
export const MARGEM_TOPO_VENDAS = 66;
export const MARGEM_TOPO_LUCRO = 86;
// Altura util original do grafico (margem 10 + area de plotagem + eixo X = 150).
// Vendas: barras 110px; lucro: area 120px. Container = margem + eixo + plotagem.
export const ALTURA_VENDAS = MARGEM_TOPO_VENDAS + 30 + 110;
export const ALTURA_LUCRO = MARGEM_TOPO_LUCRO + 30 + 120;

type PropsVendas = {
  tipo: "vendas";
  data: string;
  receita: number;
  pedidos: number;
};

type PropsLucro = {
  tipo: "lucro";
  data: string;
  lucroAcumulado: number;
  estoqueInvestido: number;
};

const CAIXA =
  "bg-zinc-950/98 pointer-events-none z-30 flex w-max select-none flex-col gap-1 rounded-xl border border-admin-border px-3 py-2 text-white shadow-lg";

const reais = (valor: number) =>
  `R$ ${valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

const reaisComCentavos = (valor: number) =>
  `R$ ${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function LinhaDeValor({
  rotulo,
  valor,
  cor,
}: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-admin-text-soft flex items-center gap-1.5 whitespace-nowrap text-xs">
        <span className={cn("size-2 shrink-0 rounded-full", cor)} />
        {rotulo}
      </span>
      <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
        {valor}
      </span>
    </div>
  );
}

export function BalaoDoGrafico(props: PropsVendas | PropsLucro) {
  if (props.tipo === "vendas") {
    const { data, receita, pedidos } = props;
    return (
      <div className={cn(CAIXA, "max-w-[220px]")}>
        <span className="whitespace-nowrap text-xs font-medium">{data}</span>
        <div className="flex flex-nowrap items-baseline gap-x-1.5 whitespace-nowrap">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-base font-bold tabular-nums">
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
            {reais(receita)}
          </span>
          <span className="text-admin-text-soft whitespace-nowrap text-xs">
            · {pedidos} {pedidos === 1 ? "pedido" : "pedidos"}
          </span>
        </div>
      </div>
    );
  }

  const { data, lucroAcumulado, estoqueInvestido } = props;
  return (
    <div className={cn(CAIXA, "max-w-[230px]")}>
      <span className="whitespace-nowrap text-xs font-medium">{data}</span>
      <LinhaDeValor
        rotulo="Lucro acumulado"
        valor={reaisComCentavos(lucroAcumulado)}
        cor="bg-emerald-500"
      />
      <LinhaDeValor
        rotulo="Estoque investido"
        valor={reaisComCentavos(estoqueInvestido)}
        cor="bg-amber-500"
      />
    </div>
  );
}
