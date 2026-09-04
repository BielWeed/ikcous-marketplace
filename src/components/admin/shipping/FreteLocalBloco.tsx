import {
  CabecaDeSecao,
  Chave,
  Linha,
  PontoEstado,
} from "@/components/admin/shipping/primitivas-direcao-d";
import { memo } from "react";

/**
 * Seção "Entrega na sua cidade" da tela de Frete v2 — direção D aprovada
 * pelo dono (03/09): linhas finas, sem caixa/card. O que existe hoje nessa
 * área (`localDeliveryFee`, `localCepRange`, `shippingCoverage`) continua
 * funcionando IGUAL — aqui só muda a casca (mando do dono: casca nova,
 * regra intacta).
 *
 * A CHAVE desta seção é o ÚNICO interruptor de verdade da tela (com campo
 * gravável real por trás): "Só entregar na cidade" grava `shippingCoverage`:
 * - LIGADA    = "local"    → a edge function RECUSA CEP de fora (a loja
 *   só atende a cidade — comportamento real de calculate-shipping);
 * - DESLIGADA = "national" → a cidade segue sendo atendida pela entrega
 *   local E o resto do Brasil compra com a transportadora.
 *
 * Por que NÃO se chama "Entrega local" como no mockup: a entrega local não
 * tem "desligar" no sistema — CEP da cidade SEMPRE recebe a opção
 * "Entrega Local", nos dois estados da cobertura. Uma chave "Entrega
 * local" desligada seria chave que mente. O campo real que liga e desliga
 * algo aqui é a cobertura, e o nome diz exatamente o que ela faz.
 *
 * Semântica do valor (vem da edge, repetida sem inventar): CEP do cliente
 * dentro da faixa → opção "Entrega Local" custa `localDeliveryFee`
 * (R$ 0 = entrega de graça na cidade). Faixa vazia = a cidade inteira,
 * pelo CEP da loja como origem.
 */
export const FreteLocalBloco = memo(function FreteLocalBloco({
  valor,
  onValor,
  faixa,
  onFaixa,
  coverage,
  onCoverage,
  cidade,
  uf,
  semOrigem,
  desabilitado,
}: {
  readonly valor: number;
  readonly onValor: (valor: number) => void;
  readonly faixa: string;
  readonly onFaixa: (faixa: string) => void;
  readonly coverage: "local" | "national";
  readonly onCoverage: (coverage: "local" | "national") => void;
  readonly cidade?: string | null;
  readonly uf?: string | null;
  /** A loja ainda não definiu o CEP de origem — a entrega está parada. */
  readonly semOrigem?: boolean;
  readonly desabilitado?: boolean;
}) {
  const onde =
    cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";

  return (
    <section
      id="bloco-frete-local"
      aria-label="Entrega na sua cidade"
      className="scroll-mt-24"
    >
      <CabecaDeSecao
        titulo="Entrega na sua cidade"
        estado={
          semOrigem ? (
            <>
              <PontoEstado tom="atencao" />
              <span className="text-amber-300">
                parada — falta o CEP da loja
              </span>
            </>
          ) : (
            <>
              <PontoEstado tom="positivo" />
              <span>
                <b className="font-semibold text-zinc-200">ligada</b> · entrega
                própria
              </span>
            </>
          )
        }
      />

      <Linha
        nome="Só entregar na cidade"
        dica="Ligada: quem é de fora não consegue comprar. Desligada: o resto do Brasil compra com a transportadora."
      >
        <Chave
          rotulo="Só entregar na cidade"
          ligada={coverage === "local"}
          desabilitado={desabilitado}
          onToggle={() =>
            onCoverage(coverage === "local" ? "national" : "local")
          }
        />
      </Linha>

      <Linha nome="Valor por pedido" dica={`O que o cliente de ${onde} paga`}>
        {/* Mesma mecânica da tela anterior (o campo vazio lê 0 = grátis na
            cidade) — mudou a casca, não o comportamento. */}
        <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2">
          <span className="text-xs font-semibold text-zinc-500">R$</span>
          <input
            id="local-delivery-fee"
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            value={valor === 0 ? "" : valor}
            onChange={(e) =>
              onValor(e.target.value === "" ? 0 : Number(e.target.value))
            }
            placeholder="0"
            disabled={desabilitado}
            className="w-20 bg-transparent text-right text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </Linha>

      <Linha
        nome="Alcance por CEP"
        dica={`Quais CEPs contam como "cidade" (vazio = ${onde} inteira, pelo CEP da loja). CEP fora da faixa não recebe a entrega local — vê o frete nacional.`}
      >
        <input
          id="local-cep-range"
          type="text"
          value={faixa}
          onChange={(e) => onFaixa(e.target.value)}
          placeholder="Ex: 38500-000, 38500-999"
          disabled={desabilitado}
          className="h-10 w-full rounded-xl border border-white/10 bg-zinc-900/60 px-3.5 font-mono text-[13px] text-zinc-100 placeholder-zinc-600 transition-colors focus:border-admin-accent focus:outline-none disabled:opacity-50 md:w-56"
        />
      </Linha>
    </section>
  );
});
