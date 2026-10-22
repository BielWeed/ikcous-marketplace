/** Mesma reserva mínima e fluxo do Compacto; nomes longos podem crescer. */
export function OfertasCompactasEsqueleto() {
  return (
    <div
      data-testid="esqueleto-ofertas"
      className="min-h-[392px] overflow-hidden py-4"
    >
      <div className="mb-5 flex min-h-6 items-center justify-between gap-3 px-5">
        <span className="h-6 w-40 animate-pulse rounded bg-[#ECECEF]" />
        <span className="size-1.5 rounded-full bg-zinc-200" />
      </div>
      <div className="ml-3 flex gap-2.5 py-1 min-[360px]:ml-5">
        {[0, 1, 2].map((id) => (
          <div
            key={id}
            data-cartao-esqueleto
            className="flex min-h-[290px] w-[165px] shrink-0 animate-pulse flex-col rounded-[20px] border border-zinc-200 bg-white max-[359px]:w-[145px]"
          >
            <div className="h-[136px] w-full shrink-0 rounded-t-[19px] bg-[#ECECEF]" />
            <div className="flex flex-1 flex-col p-2.5">
              <div className="mb-1.5 min-h-8 space-y-1">
                <div className="h-3 w-full rounded bg-[#ECECEF]" />
                <div className="h-3 w-2/3 rounded bg-[#ECECEF]" />
              </div>
              <div className="h-3.5 w-16 rounded bg-[#ECECEF]" />
              <div className="h-7 w-24 rounded bg-[#ECECEF]" />
              <div className="mt-2 min-h-11 w-full rounded-xl bg-[#ECECEF]" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-1.5 justify-center gap-1.5">
        {[0, 1, 2].map((id) => (
          <span
            key={id}
            className={`h-1.5 rounded-full bg-zinc-200 ${id === 0 ? "w-6" : "w-1.5"}`}
          />
        ))}
      </div>
    </div>
  );
}
