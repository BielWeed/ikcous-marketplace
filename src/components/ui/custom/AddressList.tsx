import type { Address } from "@/types";
import { CheckCircle2, Edit, MapPin, Trash2 } from "lucide-react";
import { memo } from "react";

interface AddressListProps {
  addresses: Address[];
  onEdit?: (address: Address) => void;
  onDelete?: (id: string) => void;
  onSelect?: (address: Address) => void;
  selectedId?: string;
  selectable?: boolean;
  compact?: boolean;
}

export const AddressList = memo(function AddressList({
  addresses,
  onEdit,
  onDelete,
  onSelect,
  selectedId,
  selectable = false,
  compact = false,
}: AddressListProps) {
  if (addresses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
        <MapPin className="mx-auto mb-3 size-10 text-gray-300" />
        <p className="text-sm text-gray-500">Nenhum endereço cadastrado</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2">
        {addresses.map((address) => (
          <div
            key={address.id}
            role={selectable ? "button" : undefined}
            tabIndex={selectable ? 0 : undefined}
            className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 transition-all duration-300 ${
              selectable && selectedId === address.id
                ? "border-zinc-900 bg-zinc-900/5 shadow-sm"
                : "border-transparent bg-zinc-50/50 hover:bg-zinc-100/50"
            } ${selectable ? "cursor-pointer active:scale-[0.99]" : ""}`}
            onClick={() => selectable && onSelect?.(address)}
            onKeyDown={(e) => {
              if (selectable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSelect?.(address);
              }
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg shadow-sm ${
                  selectable && selectedId === address.id
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-100 bg-white text-zinc-400"
                }`}
              >
                <MapPin className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="max-w-[150px] truncate text-[11px] font-bold text-zinc-900">
                    {address.name}
                  </span>
                  {address.is_default && (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-emerald-700">
                      Principal
                    </span>
                  )}
                  {selectable && selectedId === address.id && (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-zinc-900">
                      Selecionado
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[9px] font-medium text-zinc-400">
                  {address.street}, {address.number} • {address.city}
                </p>
              </div>
            </div>

            {/* Actions or Selected Indicator */}
            <div className="ml-2 flex shrink-0 items-center gap-1">
              {selectable && selectedId === address.id ? (
                <CheckCircle2 className="size-3.5 text-zinc-900" />
              ) : null}

              {!selectable && (onEdit || onDelete) && (
                <div className="flex items-center gap-0.5">
                  {onEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit?.(address);
                      }}
                      className="animate-all relative flex size-6 items-center justify-center rounded-md border border-zinc-100 bg-white text-zinc-400 shadow-sm transition-all duration-200 after:absolute after:-inset-y-2.5 after:-left-2.5 after:right-0 after:content-[''] hover:bg-zinc-900 hover:text-white"
                      aria-label="Editar"
                    >
                      <Edit className="size-2.5" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(address.id);
                      }}
                      className="animate-all relative flex size-6 items-center justify-center rounded-md border border-zinc-100 bg-white text-red-400 shadow-sm transition-all duration-200 after:absolute after:-inset-y-2.5 after:-right-2.5 after:left-0 after:content-[''] hover:bg-red-50 hover:text-red-500"
                      aria-label="Excluir"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {addresses.map((address) => (
        <div
          key={address.id}
          role={selectable ? "button" : undefined}
          tabIndex={selectable ? 0 : undefined}
          className={`relative rounded-2xl border-2 bg-zinc-50/50 p-4 transition-all duration-500 sm:p-5 ${
            selectable && selectedId === address.id
              ? "z-10 border-zinc-900 bg-white shadow-2xl shadow-zinc-100"
              : "border-transparent hover:border-zinc-200 hover:bg-white"
          } ${selectable ? "cursor-pointer active:scale-[0.98]" : ""}`}
          onClick={() => selectable && onSelect?.(address)}
          onKeyDown={(e) => {
            if (selectable && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onSelect?.(address);
            }
          }}
        >
          {/* Header */}
          <div className="mb-2 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex size-8 items-center justify-center rounded-xl shadow-sm ${selectable && selectedId === address.id ? "bg-zinc-900 text-white" : "bg-white text-zinc-400"} shrink-0`}
              >
                <MapPin className="size-4" />
              </div>
              <div>
                <span className="block text-sm font-bold leading-tight text-zinc-900">
                  {address.name}
                </span>
                {address.is_default && (
                  <span className="mt-1 block text-[8px] font-bold uppercase tracking-widest text-emerald-500">
                    Endereço Principal
                  </span>
                )}
              </div>
            </div>
            {selectable && selectedId === address.id && (
              <CheckCircle2 className="size-5 text-zinc-900 duration-300 animate-in zoom-in-50" />
            )}
            {(onEdit || onDelete) && (
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit?.(address);
                  }}
                  className="relative flex size-8 items-center justify-center rounded-lg bg-white text-zinc-400 shadow-sm transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-zinc-900 hover:text-white"
                  aria-label="Editar"
                >
                  <Edit className="size-3.5" />
                </button>
                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(address.id);
                    }}
                    className="relative flex size-8 items-center justify-center rounded-lg bg-white text-red-400 shadow-sm transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-red-50 hover:text-red-500"
                    aria-label="Excluir"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-1 pl-11 text-[11px] font-medium text-zinc-500">
            <p className="mb-1 text-xs font-bold uppercase tracking-tighter text-zinc-900">
              {address.recipient_name}
            </p>
            <p className="leading-relaxed">
              {address.street}, {address.number}
              {address.complement ? ` - ${address.complement}` : ""}
            </p>
            <p className="leading-relaxed">
              {address.neighborhood}, {address.city} - {address.state}
            </p>
            <p className="mt-1 text-[9px] font-bold text-zinc-400">
              CEP: {address.cep}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
});
