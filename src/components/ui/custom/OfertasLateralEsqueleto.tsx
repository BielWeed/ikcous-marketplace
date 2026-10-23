/** Mesma moldura e mesma altura reservada do Lateral: a página não pula quando as ofertas chegam. */
export function OfertasLateralEsqueleto() {
  return (
    <div
      data-testid="esqueleto-ofertas"
      className="min-h-[286px] overflow-hidden py-4"
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
            className="flex min-h-[184px] shrink-0 basis-[88%] animate-pulse overflow-hidden rounded-[26px] border border-solid border-zinc-200 bg-white"
          >
            <div className="w-[44%] shrink-0 self-stretch bg-[#ECECEF]" />
            <div className="flex min-w-0 flex-1 flex-col px-4 pb-3 pt-4">
              <div className="mb-1 min-h-5 space-y-1.5 pt-1">
                <div className="h-3 w-full rounded bg-[#ECECEF]" />
              </div>
              <div className="min-h-4" />
              <div className="h-8 w-24 rounded bg-[#ECECEF]" />
              <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                <span className="h-3 w-16 rounded bg-[#ECECEF]" />
                <span className="size-12 shrink-0 rounded-full bg-[#ECECEF]" />
              </div>
            </div>
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
