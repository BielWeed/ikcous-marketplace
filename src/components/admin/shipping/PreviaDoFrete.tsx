import { atingiuOMinimo } from "@/lib/atingiu-o-minimo";
import {
  precoFinalDaOpcao,
  promessasDeFrete,
} from "@/lib/estrategias-de-frete";
import { modoDaEntregaNaCidade } from "@/lib/guarda-de-frete";
import { cepCompleto, resumoDoAlcance } from "@/lib/loja-pronta";
import { reais } from "@/lib/status-da-entrega";
import type { StoreConfig } from "@/types";
import { House, type LucideIcon, Store, Truck } from "lucide-react";
import { useState } from "react";

function LinhaDaPrevia({
  icone: Icone,
  nome,
  detalhe,
  valor,
  nota,
}: {
  readonly icone: LucideIcon;
  readonly nome: string;
  readonly detalhe: string;
  readonly valor: string;
  readonly nota: string;
}) {
  return (
    <div className="flex gap-3 border-t border-admin-border py-3 first:border-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-admin-raised text-admin-gold">
        <Icone aria-hidden="true" className="size-5" />
      </span>
      <div className="grid min-w-0 flex-1 gap-1 min-[380px]:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
        <div className="min-w-0 break-words">
          <p className="text-sm font-bold text-zinc-100">{nome}</p>
          <p className="text-xs text-zinc-500">{detalhe}</p>
        </div>
        <div className="min-w-0 break-words min-[380px]:text-right">
          <p className="text-[15px] font-extrabold text-zinc-100">{valor}</p>
          <p className="text-xs text-zinc-500">{nota}</p>
        </div>
      </div>
    </div>
  );
}

/** Exemplos, não cotação: os preços locais usam a mesma função do carrinho. */
export function PreviaDoFrete({
  config,
  nomesLigados,
  pendente,
}: {
  readonly config: StoreConfig;
  readonly nomesLigados: readonly string[] | null;
  readonly pendente: boolean;
}) {
  const [subtotal, setSubtotal] = useState(100);
  const modo = modoDaEntregaNaCidade(config);
  const promessas = promessasDeFrete(config);
  const local = precoFinalDaOpcao(
    { id: "local-delivery", price: config.localDeliveryFee ?? 10 },
    { config, subtotal, temItemMarcado: false },
  );
  const fora = config.shippingCoverage !== "local";
  const nacional = promessas.nacional;
  const gratisNacional =
    nacional.estrategia === "sempre" ||
    (nacional.estrategia === "acima_de_valor" &&
      atingiuOMinimo(subtotal, nacional.minimo));
  return (
    <section
      aria-label="Como fica para o cliente"
      className="rounded-[20px] border border-admin-border bg-admin-surface p-4"
    >
      {!cepCompleto(config.originCep) ? (
        <p className="text-[12.5px] text-zinc-400">
          A prévia aparece quando o CEP de onde você envia estiver cadastrado.
        </p>
      ) : (
        <>
          <p className="text-sm font-bold text-zinc-100">
            Quanto o cliente paga num pedido de
          </p>
          <div
            className="my-3 flex rounded-full bg-admin-bg p-1"
            aria-label="Valor do pedido"
            role="group"
          >
            {[100, 150, 250].map((valor) => (
              <button
                type="button"
                key={valor}
                aria-pressed={valor === subtotal}
                onClick={() => setSubtotal(valor)}
                className={`min-h-11 min-w-0 flex-1 rounded-full text-[13px] font-bold ${valor === subtotal ? "bg-[hsl(var(--admin-gold-fill))] text-black" : "text-zinc-300"}`}
              >
                R$ {valor}
              </button>
            ))}
          </div>
          {modo !== "so_retiro" && (
            <LinhaDaPrevia
              icone={House}
              nome="Entrega na sua região"
              detalhe={resumoDoAlcance(config.originCep, config.localCepRange)}
              valor={local === 0 ? "Grátis" : `R$ ${reais(local)}`}
              nota={
                promessas.local.estrategia === "por_produto"
                  ? "grátis se tiver produto marcado"
                  : local === 0
                    ? "entrega grátis"
                    : `chega em ${config.localDeliveryDays ?? 1} dia(s)`
              }
            />
          )}
          {modo !== "entrego" && (
            <LinhaDaPrevia
              icone={Store}
              nome="Retirar na loja"
              detalhe={config.storeAddress || "Falta o endereço da loja"}
              valor="Grátis"
              nota="busca quando quiser"
            />
          )}
          <LinhaDaPrevia
            icone={Truck}
            nome="Fora da sua região"
            detalhe={
              !fora
                ? "a loja não vende"
                : nomesLigados === null
                  ? "transportadoras sem confirmar"
                  : nomesLigados.length
                    ? nomesLigados.join(" ou ")
                    : "nenhuma transportadora ligada"
            }
            valor={
              !fora
                ? "Não vende"
                : nomesLigados === null
                  ? "A confirmar"
                  : !nomesLigados.length
                    ? "Não compra"
                    : gratisNacional
                      ? "Grátis"
                      : "Na hora"
            }
            nota={
              !fora || !nomesLigados?.length
                ? ""
                : gratisNacional
                  ? config.nationalBenefitScope === "todas"
                    ? "qualquer entrega"
                    : "na opção mais barata"
                  : nacional.estrategia === "por_produto"
                    ? "grátis se tiver produto marcado"
                    : nacional.estrategia === "desconto_na_mais_barata"
                      ? "desconto na opção mais barata"
                      : "preço da transportadora"
            }
          />
        </>
      )}
      {pendente && (
        <p className="mt-2 text-xs text-zinc-500">
          Prévia do que está na tela. Toque em Salvar para valer na loja.
        </p>
      )}
    </section>
  );
}
