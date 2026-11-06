import { Suspense, useState } from "react";

import { LimiteDePedaco } from "@/components/ui/custom/LimiteDePedaco";
import type { TipoDePolitica } from "@/lib/nomes-das-politicas";
import { lazyRetentavel } from "@/utils/lazyRetentavel";

// A folha (Radix Sheet + o texto + a leitura da política de trocas no banco)
// só vem do servidor quando a cliente toca num link de política. Quem a
// usa — o checkout, o produto, o cadastro — não paga esse peso na abertura
// da tela, e o checkout não ganha nenhuma dependência nova no caminho crítico.
const PoliticaEmFolha = lazyRetentavel(() =>
  import("@/components/politicas/PoliticaEmFolha").then((m) => ({
    default: m.PoliticaEmFolha,
  })),
);

/**
 * `PoliticaEmFolha` carregada sob demanda. Depois da primeira abertura a
 * folha fica montada (fechada), para a animação de saída acontecer inteira.
 *
 * Se o arquivo da folha não baixa (sinal fraco, versão nova no ar), a falha
 * fica AQUI: um aviso curto com "Tentar de novo" e "Fechar". O cadastro, o
 * checkout ou a escolha de tamanho que estão por baixo continuam montados,
 * com tudo o que a cliente digitou — antes o erro subia até a tela de erro do
 * app inteiro e apagava tudo.
 */
export function PoliticaEmFolhaSobDemanda({
  tipo,
  onFechar,
}: {
  readonly tipo: TipoDePolitica | null;
  readonly onFechar: () => void;
}) {
  const [jaAbriu, setJaAbriu] = useState(false);
  if (tipo !== null && !jaAbriu) setJaAbriu(true);
  if (!jaAbriu) return null;
  return (
    <LimiteDePedaco
      pedacos={[PoliticaEmFolha]}
      // Um novo toque num link (ou o "Fechar" do aviso) pede o arquivo outra vez.
      resetKey={tipo}
      fallback={({ tentarDeNovo }) =>
        tipo === null ? null : (
          <div
            role="alert"
            className="mt-2 flex flex-col items-center gap-2 rounded-xl bg-zinc-100 p-3 text-center text-xs text-zinc-800"
          >
            <p>
              Não foi possível abrir agora. Verifique a conexão e tente de novo.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={tentarDeNovo}
                className="min-h-11 rounded-full border border-zinc-400 px-4 font-semibold text-zinc-900"
              >
                Tentar de novo
              </button>
              <button
                type="button"
                onClick={onFechar}
                className="min-h-11 rounded-full px-4 font-semibold text-zinc-700 underline underline-offset-2"
              >
                Fechar
              </button>
            </div>
          </div>
        )
      }
    >
      <Suspense fallback={null}>
        <PoliticaEmFolha tipo={tipo} onFechar={onFechar} />
      </Suspense>
    </LimiteDePedaco>
  );
}
