import {
  CabecaDeSecao,
  Chave,
  Linha,
  PontoEstado,
} from "@/components/admin/shipping/primitivas-direcao-d";
import { memo, useState } from "react";

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
 *
 * RETIRADA NA LOJA (release 1.5.3): a segunda chave de verdade da seção —
 * "Permitir retirada na loja" grava a chave `store-pickup` em
 * `enabledShippingMethods` (o pai calcula a lista a partir do config
 * ATUAL, preservando os serviços de transportadora). A cliente da MESMA
 * área da entrega local vê "Retirar na loja", grátis, com o endereço da
 * página Sobre a Loja. Sem esse endereço a chave NÃO liga: a mensagem
 * manda cadastrar em Admin → Sobre a Loja (a edge também não oferece a
 * retirada sem endereço — a chave ligada ali seria chave que mente).
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
  retirada = false,
  onRetirada,
  enderecoDaLoja,
  mostrarCabecalho = true,
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
  /** Retirada na loja ligada no formulário (chave `store-pickup`). */
  readonly retirada?: boolean;
  /** Ausente = a tela não oferece a chave (nada é exibido). */
  readonly onRetirada?: (ligada: boolean) => void;
  /** `store_address` salvo — sem ele a retirada não liga. */
  readonly enderecoDaLoja?: string | null;
  /** `false` quando um `PainelRecolhivel` externo já mostra o título e o
   * estado (tela de Frete unificada, 23/09/2026) — evita cabeçalho em
   * dobro. Default `true` preserva o uso isolado (e os testes). */
  readonly mostrarCabecalho?: boolean;
}) {
  const [semEnderecoAoLigar, setSemEnderecoAoLigar] = useState(false);
  const temEndereco = (enderecoDaLoja ?? "").trim() !== "";
  const onde =
    cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";

  return (
    <section
      id="bloco-frete-local"
      aria-label="Entrega na sua cidade"
      className="scroll-mt-24"
    >
      {mostrarCabecalho && (
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
                  <b className="font-semibold text-zinc-200">ligada</b> ·
                  entrega própria
                </span>
              </>
            )
          }
        />
      )}

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

      {onRetirada && (
        <>
          <Linha
            nome="Permitir retirada na loja"
            dica={
              temEndereco
                ? `Quem é da mesma área da entrega local pode buscar o pedido de graça em: ${(enderecoDaLoja ?? "").trim()}`
                : "Quem é da mesma área da entrega local pode buscar o pedido de graça no endereço da loja."
            }
          >
            <Chave
              rotulo="Permitir retirada na loja"
              ligada={retirada}
              desabilitado={desabilitado}
              onToggle={() => {
                if (!retirada && !temEndereco) {
                  setSemEnderecoAoLigar(true);
                  return;
                }
                setSemEnderecoAoLigar(false);
                onRetirada(!retirada);
              }}
            />
          </Linha>
          {semEnderecoAoLigar && !retirada && !temEndereco && (
            <p
              role="alert"
              className="mt-2 text-[12.5px] leading-snug text-amber-300"
            >
              Para ligar a retirada, cadastre o endereço da loja em Admin →
              Sobre a Loja. A cliente precisa saber onde buscar.
            </p>
          )}
          {retirada && !temEndereco && (
            <p
              role="alert"
              className="mt-2 text-[12.5px] leading-snug text-amber-300"
            >
              A retirada está ligada, mas a loja está sem endereço: a opção não
              aparece para a cliente até você cadastrar o endereço em Admin →
              Sobre a Loja.
            </p>
          )}
        </>
      )}
    </section>
  );
});
