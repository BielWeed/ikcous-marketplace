import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatarInteiro } from "@/lib/crm";
import { rotuloDoPapel } from "@/lib/papel-da-conta";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { Customer } from "@/utils/admin_cache";
import {
  Bell,
  Calendar,
  ChevronRight,
  ContactRound,
  Mail,
  MoreHorizontal,
  Phone,
  Zap,
} from "lucide-react";
import { memo, useState } from "react";
import { FOCO_CLIENTES, FolhaClientes } from "./FolhaClientes";

const CORES_DO_AVATAR = [
  "bg-fuchsia-900",
  "bg-indigo-900",
  "bg-violet-900",
  "bg-teal-900",
  "bg-cyan-900",
  "bg-orange-900",
];

function IdentidadeCliente({
  customer,
  detalhado = false,
}: {
  readonly customer: Customer;
  readonly detalhado?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="relative shrink-0">
        <Avatar className={detalhado ? "size-12" : "size-10"}>
          <AvatarImage
            src={customer.avatar_url}
            alt=""
            className="object-cover"
          />
          <AvatarFallback
            data-tema-fixo=""
            className={cn(
              "text-sm font-bold text-white",
              CORES_DO_AVATAR.at(
                customer.id.charCodeAt(0) % CORES_DO_AVATAR.length,
              ),
            )}
          >
            {customer.full_name?.substring(0, 2).toUpperCase() || "CX"}
          </AvatarFallback>
        </Avatar>
        {customer.is_push_subscribed && (
          <span
            role="img"
            aria-label="Avisos ativos"
            className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-admin-surface bg-teal-400 text-teal-950"
          >
            <Zap aria-hidden="true" className="size-3 fill-current" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h4
          className={cn(
            "break-words text-sm font-bold leading-tight text-white",
            detalhado && "text-base",
          )}
        >
          {customer.full_name || "Usuário"}
        </h4>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-400">
          <Badge
            className={cn(
              "rounded-full border-0 px-1.5 py-0 text-xs font-medium",
              customer.role === "admin"
                ? "bg-violet-300/10 text-violet-300"
                : customer.role === "gerente"
                  ? "bg-sky-300/10 text-sky-300"
                  : customer.role === "vendedor"
                    ? "bg-emerald-300/10 text-emerald-300"
                    : "bg-white/5 text-zinc-300",
            )}
          >
            {rotuloDoPapel(customer.role)}
          </Badge>
          <span className="break-all text-sm">
            #{customer.id.slice(0, 8).toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}

export const CartaoCliente = memo(function CartaoCliente({
  customer,
  detalhado = false,
  onNavigate,
  onPrefetch,
}: {
  readonly customer: Customer;
  readonly detalhado?: boolean;
  readonly onNavigate: (view: View, id?: string) => void;
  readonly onPrefetch: () => void;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const abrir = (view: View) => {
    setMenuAberto(false);
    onNavigate(view, customer.id);
  };

  return (
    <div
      className={cn(
        "group relative min-w-0 cursor-pointer rounded-2xl border border-admin-border bg-admin-surface px-3 py-2 text-zinc-400 hover:border-admin-border-strong",
        FOCO_CLIENTES,
        detalhado &&
          "rounded-[20px] py-4 md:grid md:grid-cols-12 md:items-center md:gap-4",
      )}
      onClick={() => onNavigate("admin-user-detail", customer.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          onNavigate("admin-user-detail", customer.id);
        }
      }}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
    >
      <div
        className={cn("min-w-0 pr-12", detalhado && "md:col-span-4 md:pr-0")}
      >
        <IdentidadeCliente customer={customer} detalhado={detalhado} />
      </div>
      <div
        className={cn(
          "mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs",
          detalhado && "flex-col md:col-span-3 md:mt-0",
        )}
      >
        <span
          className={cn(
            "flex min-w-0 items-start gap-1",
            detalhado ? "flex-none" : "flex-[1_1_180px]",
          )}
        >
          <Mail
            aria-hidden="true"
            className="mt-0.5 size-3 shrink-0 text-indigo-300"
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {customer.email || "N/A"}
          </span>
        </span>
        {customer.phone && (
          <span className="flex min-w-0 items-start gap-1">
            <Phone
              aria-hidden="true"
              className="mt-0.5 size-3 shrink-0 text-sky-300"
            />
            <span className="break-words [overflow-wrap:anywhere]">
              {customer.phone}
            </span>
          </span>
        )}
      </div>
      <div
        className={cn(
          "mt-1 flex min-w-0 flex-wrap items-end gap-x-5 gap-y-2",
          detalhado &&
            "mt-3 rounded-xl bg-admin-raised p-3 md:col-span-3 md:mt-0",
        )}
      >
        <div className="flex min-w-0 flex-[1_1_auto] flex-col">
          <span className="min-w-0 break-words text-xs tracking-wide text-zinc-300">
            Total já comprado
          </span>
          <span
            className={cn(
              "whitespace-nowrap text-lg font-bold leading-tight tabular-nums",
              classeDoTexto("positivo"),
              detalhado && "text-xl",
            )}
          >
            R${" "}
            {Number(customer.total_spent || 0).toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="flex min-w-0 flex-[1_1_60px] flex-col">
          <span className="text-xs text-zinc-300">Pedidos</span>
          <span
            className={cn(
              "text-lg font-bold leading-tight tabular-nums text-white",
              detalhado && "text-xl",
            )}
          >
            {formatarInteiro(customer.orders_count || 0)}
          </span>
        </div>
        {detalhado && (
          <div className="w-full border-t border-admin-border pt-2 text-[11px] md:hidden">
            <span className="flex items-center gap-1">
              <Calendar aria-hidden="true" className="size-3 text-violet-300" />
              Desde {new Date(customer.created_at).toLocaleDateString("pt-BR")}
            </span>
            {!customer.orders_count && (
              <p className="mt-1">Sem compras ainda</p>
            )}
          </div>
        )}
      </div>
      {detalhado && (
        <div
          className="hidden min-w-0 flex-wrap items-center gap-1 break-words text-[11px] md:col-span-1 md:flex"
          title="Última compra"
        >
          <Calendar
            aria-hidden="true"
            className="size-3 shrink-0 text-violet-300"
          />
          {customer.last_order_date
            ? new Date(customer.last_order_date).toLocaleDateString()
            : "--"}
        </div>
      )}
      <div
        className={cn(
          "absolute right-3 top-2",
          detalhado &&
            "top-4 md:relative md:right-auto md:top-auto md:col-span-1 md:justify-self-end",
        )}
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <FolhaClientes
          aberta={menuAberto}
          aoMudar={setMenuAberto}
          titulo="Gestão de Cliente"
          gatilho={
            <button
              type="button"
              aria-label={`Gestão de Cliente: ${customer.full_name || "Usuário"}`}
              className={`flex size-11 shrink-0 items-center justify-center rounded-full border border-admin-border bg-admin-raised text-zinc-300 hover:bg-admin-hover ${FOCO_CLIENTES}`}
            >
              <MoreHorizontal aria-hidden="true" className="size-5" />
            </button>
          }
        >
          <IdentidadeCliente customer={customer} />
          <p className="my-4 text-xs text-zinc-400">
            {customer.is_push_subscribed
              ? "Avisos ativos."
              : "Sem avisos ativos. Notificação Push continua disponível."}
          </p>
          <div className="space-y-2 border-t border-admin-border pt-4">
            <button
              type="button"
              onClick={() => abrir("admin-user-detail")}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl py-3 text-left ${FOCO_CLIENTES}`}
            >
              <ContactRound
                aria-hidden="true"
                className="size-11 shrink-0 rounded-xl border border-indigo-300/20 bg-indigo-300/10 p-2 text-indigo-300"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">
                  Ver ficha do cliente
                </span>
                <span className="block text-xs text-zinc-400">
                  Abre os dados e pedidos do cliente.
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => abrir("admin-push")}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl py-3 text-left ${FOCO_CLIENTES}`}
            >
              <Bell
                aria-hidden="true"
                className="size-11 shrink-0 rounded-xl border border-sky-300/20 bg-sky-300/10 p-2 text-sky-300"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">
                  Notificação Push
                </span>
                <span className="block text-xs text-zinc-400">
                  Abre Avisar clientes com {customer.full_name || "Usuário"} já
                  escolhido.
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
            </button>
          </div>
        </FolhaClientes>
      </div>
    </div>
  );
});
