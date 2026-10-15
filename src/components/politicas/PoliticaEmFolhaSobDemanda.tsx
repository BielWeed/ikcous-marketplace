import { Suspense, lazy, useState } from "react";

import type { TipoDePolitica } from "@/lib/textos-das-politicas";

// A folha (Radix Sheet + o texto + a leitura da política de trocas no banco)
// só vem do servidor quando a cliente toca num link de política. Quem a
// usa — o checkout, o produto, o cadastro — não paga esse peso na abertura
// da tela, e o checkout não ganha nenhuma dependência nova no caminho crítico.
const PoliticaEmFolha = lazy(() =>
  import("@/components/politicas/PoliticaEmFolha").then((m) => ({
    default: m.PoliticaEmFolha,
  })),
);

/**
 * `PoliticaEmFolha` carregada sob demanda. Depois da primeira abertura a
 * folha fica montada (fechada), para a animação de saída acontecer inteira.
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
    <Suspense fallback={null}>
      <PoliticaEmFolha tipo={tipo} onFechar={onFechar} />
    </Suspense>
  );
}
