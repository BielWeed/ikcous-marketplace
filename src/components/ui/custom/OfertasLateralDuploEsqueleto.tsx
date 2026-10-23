import { cn } from "@/lib/utils";
import {
  ALTURA_CARTAO_DUPLO,
  type FileirasDoDuplo,
  alturaDaSecaoDuplo,
} from "./ofertas-lateral-duplo-altura";

/**
 * Mesma moldura e mesma altura reservada do Lateral em duas fileiras: a página não pula quando as ofertas
 * chegam. Com 1 oferta só a faixa tem UMA fileira (`fileiras={1}`, decidido pela memória da última visita
 * ou pela quantidade que a Home já tem na mão); com 2 ou mais, duas.
 */
export function OfertasLateralDuploEsqueleto({
  fileiras = 2,
}: { fileiras?: FileirasDoDuplo }) {
  const umaSo = fileiras === 1;
  // Uma oferta: uma coluna na largura toda. Várias: duas colunas, a segunda aparecendo só a ponta.
  const colunas = umaSo ? [0] : [0, 1];
  return (
    <div
      data-testid="esqueleto-ofertas"
      style={{ minHeight: alturaDaSecaoDuplo(fileiras) }}
      className="overflow-hidden py-4"
    >
      <div className="mb-5 flex min-h-6 items-center justify-between gap-3 px-5">
        <span className="h-6 w-40 animate-pulse rounded bg-[#ECECEF]" />
        <span className="size-1.5 rounded-full bg-zinc-200" />
      </div>
      <div
        className={cn(
          "ml-3 flex gap-2.5 py-1 min-[360px]:ml-5",
          umaSo && "mr-3 min-[360px]:mr-5",
        )}
      >
        {colunas.map((coluna) => (
          <div
            key={coluna}
            data-coluna-esqueleto
            className={cn(
              "flex min-w-0 flex-col gap-2",
              umaSo ? "w-full" : "shrink-0 basis-[88%]",
            )}
          >
            {Array.from({ length: umaSo ? 1 : 2 }, (_, linha) => (
              <div
                key={linha}
                data-cartao-esqueleto
                style={{ height: ALTURA_CARTAO_DUPLO }}
                className="relative flex animate-pulse overflow-hidden rounded-[20px] border border-solid border-zinc-200 bg-white"
              >
                <div className="w-[104px] shrink-0 self-stretch bg-[#ECECEF] max-[339px]:w-[88px]" />
                <div className="flex min-w-0 flex-1 flex-col pb-1 pl-3 pr-2.5 pt-2">
                  <div className="h-8 pt-1">
                    <div className="h-3.5 w-full rounded bg-[#ECECEF]" />
                  </div>
                  <div className="mt-0.5 h-6">
                    <div className="h-5 w-24 rounded bg-[#ECECEF]" />
                  </div>
                  <div className="h-4" />
                  <div className="flex h-4 items-center">
                    <span className="h-3 w-16 rounded bg-[#ECECEF]" />
                  </div>
                </div>
                <span className="absolute bottom-2 right-2.5 size-11 rounded-full bg-[#ECECEF]" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-1.5 justify-center gap-1.5">
        {!umaSo &&
          [0, 1].map((id) => (
            <span
              key={id}
              className={cn(
                "h-1.5 rounded-full bg-zinc-200",
                id === 0 ? "w-6" : "w-1.5",
              )}
            />
          ))}
      </div>
    </div>
  );
}
