import {
  ALTURA_CARTAO_LATERAL,
  ALTURA_SECAO_LATERAL,
} from "./ofertas-lateral-altura";

/** Mesma moldura e mesma altura reservada do Lateral: a página não pula quando as ofertas chegam. */
export function OfertasLateralEsqueleto() {
  return (
    <div
      data-testid="esqueleto-ofertas"
      style={{ minHeight: ALTURA_SECAO_LATERAL }}
      className="overflow-hidden py-4"
    >
      <div className="mb-5 flex min-h-6 items-center justify-between gap-3 px-5">
        <span className="h-6 w-40 animate-pulse rounded bg-[#ECECEF]" />
        <span className="size-1.5 rounded-full bg-zinc-200" />
      </div>
      <div className="ml-3 flex gap-2.5 py-1 min-[360px]:ml-5">
        {[0, 1].map((id) => (
          <div
            key={id}
            data-cartao-esqueleto
            style={{ height: ALTURA_CARTAO_LATERAL }}
            className="relative flex shrink-0 basis-[88%] animate-pulse overflow-hidden rounded-[20px] border border-solid border-zinc-200 bg-white"
          >
            <div className="w-[104px] shrink-0 self-stretch bg-[#ECECEF]" />
            <div className="flex min-w-0 flex-1 flex-col py-2.5 pl-3 pr-2.5">
              <div className="h-9 pt-1">
                <div className="h-3.5 w-full rounded bg-[#ECECEF]" />
              </div>
              <div className="mt-0.5 h-7">
                <div className="h-5 w-24 rounded bg-[#ECECEF]" />
              </div>
              <div className="h-4" />
              <div className="mt-auto flex h-4 items-center">
                <span className="h-3 w-16 rounded bg-[#ECECEF]" />
              </div>
            </div>
            <span className="absolute bottom-1.5 right-2.5 size-11 rounded-full bg-[#ECECEF]" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-1.5 justify-center gap-1.5">
        {[0, 1].map((id) => (
          <span
            key={id}
            className={`h-1.5 rounded-full bg-zinc-200 ${id === 0 ? "w-6" : "w-1.5"}`}
          />
        ))}
      </div>
    </div>
  );
}
