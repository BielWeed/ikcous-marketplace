import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import type { View } from "@/types";
import { ChevronDown, User } from "lucide-react";

interface MenuDaContaDoTopoProps {
  currentView?: View;
  onNavigate: (view: View) => void;
}

export function MenuDaContaDoTopo({
  currentView,
  onNavigate,
}: Readonly<MenuDaContaDoTopoProps>) {
  const { user, profile, isAdmin, logout } = useAuth();
  const nome = (
    profile?.full_name ||
    user?.user_metadata?.name ||
    "Minha conta"
  )
    .trim()
    .split(/\s+/)[0];
  const destinos: { nome: string; view: View }[] = [
    { nome: "Minha conta", view: "profile" },
    { nome: "Meus pedidos", view: "orders" },
    { nome: "Configurações da conta", view: "account-settings" },
    { nome: "Sobre a loja", view: "about-store" },
  ];

  if (!user)
    return (
      <button
        type="button"
        onClick={() => onNavigate("auth")}
        className="flex h-10 items-center gap-1 rounded-xl px-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-primary lg:size-7 lg:justify-center lg:p-0 xl:h-10 xl:w-auto xl:justify-start xl:px-2"
      >
        <User aria-hidden="true" className="size-5" />
        <span className="lg:hidden xl:inline">Entrar</span>
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 min-w-0 items-center gap-1 rounded-xl px-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-primary lg:size-7 lg:justify-center lg:p-0 xl:h-10 xl:w-auto xl:justify-start xl:px-2"
        >
          <User aria-hidden="true" className="size-5 shrink-0" />
          <span className="max-w-20 truncate lg:hidden xl:inline">{nome}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-3 shrink-0 lg:hidden xl:block"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className="z-[150] min-w-56 rounded-2xl border-zinc-100 bg-white p-2 text-zinc-900 shadow-xl"
      >
        {destinos.map(({ nome: rotulo, view }) => (
          <DropdownMenuItem
            key={view}
            aria-current={currentView === view ? "page" : undefined}
            onSelect={() => onNavigate(view)}
          >
            {rotulo}
          </DropdownMenuItem>
        ))}
        {isAdmin && (
          <DropdownMenuItem onSelect={() => onNavigate("admin-dashboard")}>
            Painel da loja
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void logout();
          }}
        >
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
