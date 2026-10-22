/** Mesma moldura e mesma altura reservada do Lateral: a página não pula quando as ofertas chegam. */
export function OfertasLateralEsqueleto() {
  return (
    <div
      data-testid="esqueleto-ofertas"
      className="min-h-[280px] overflow-hidden py-4"
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
            className="flex min-h-[176px] shrink-0 basis-[88%] animate-pulse gap-3 rounded-[20px] border border-zinc-200 bg-white p-3"
          >
            <div className="w-2/5 shrink-0 self-stretch rounded-[14px] bg-[#ECECEF]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="mb-1 min-h-10 space-y-1.5 pt-1">
                <div className="h-3 w-full rounded bg-[#ECECEF]" />
                <div className="h-3 w-2/3 rounded bg-[#ECECEF]" />
              </div>
              <div className="min-h-4" />
              <div className="h-7 w-24 rounded bg-[#ECECEF]" />
              <div className="mt-auto flex items-center gap-2 pt-2">
                <span className="size-11 shrink-0 rounded-full bg-[#ECECEF]" />
                <span className="size-11 shrink-0 rounded-full bg-[#ECECEF]" />
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
