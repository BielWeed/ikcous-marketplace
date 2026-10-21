/** Reserva síncrona de 306 px, inclusive enquanto o módulo Compacto é baixado. */
export function OfertasCompactasEsqueleto() {
  return (
    <div
      data-testid="esqueleto-ofertas"
      className="h-[306px] overflow-hidden py-4"
    >
      <div className="mb-3 flex h-5 items-center gap-1.5 px-5">
        <span className="size-2 rounded-full bg-zinc-200" />
        <span className="h-5 w-40 animate-pulse rounded bg-[#ECECEF]" />
      </div>
      <div className="flex h-[228px] gap-2.5 py-1 pl-5">
        {[0, 1, 2].map((id) => (
          <div
            key={id}
            data-cartao-esqueleto
            className="h-[220px] w-[156px] shrink-0 animate-pulse rounded-[20px] border border-zinc-200 bg-white p-[5px]"
          >
            <div className="h-[120px] w-36 rounded-[14px] bg-[#ECECEF]" />
            <div className="mx-1 mt-2 space-y-1">
              <div className="h-3 w-[116px] rounded bg-[#ECECEF]" />
              <div className="h-3 w-[86px] rounded bg-[#ECECEF]" />
              <div className="h-2.5 w-16 rounded bg-[#ECECEF]" />
              <div className="h-4 w-[92px] rounded bg-[#ECECEF]" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex h-1.5 justify-center gap-1.5">
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
