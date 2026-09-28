import { COLUNA_FIXA_NO_COMPUTADOR } from "@/components/desktop/medidas";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { Package, Settings, Shield, Store, User } from "lucide-react";

interface MenuDaContaProps {
  atual: View;
  onNavigate: (v: View, id?: string) => void;
}

const destinos = [
  { view: "profile", texto: "Minha conta", Icone: User },
  { view: "orders", texto: "Meus pedidos", Icone: Package },
  { view: "account-settings", texto: "Configurações", Icone: Shield },
  { view: "about-store", texto: "Sobre a loja", Icone: Store },
] as const;

export function MenuDaConta({ atual, onNavigate }: MenuDaContaProps) {
  const { user, profile, isAdmin } = useAuth();
  const nome =
    profile?.full_name || user?.user_metadata?.full_name || "Minha conta";
  const itens = isAdmin
    ? [
        ...destinos,
        { view: "admin" as const, texto: "Painel da loja", Icone: Settings },
      ]
    : destinos;

  return (
    <aside
      aria-label="Minha conta"
      className={cn(
        COLUNA_FIXA_NO_COMPUTADOR,
        "lg:row-span-2 lg:rounded-3xl lg:border lg:border-zinc-100 lg:bg-white lg:p-5 lg:shadow-sm",
      )}
    >
      <div className="flex flex-col items-center border-b border-zinc-100 pb-5 text-center">
        <div className="mb-3 flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-zinc-100">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={nome}
              className="size-full object-cover"
            />
          ) : (
            <User className="size-8 text-zinc-500" aria-hidden="true" />
          )}
        </div>
        <p className="w-full break-words text-lg font-black tracking-tight text-zinc-900">
          {nome}
        </p>
        {user?.email && (
          <p className="mt-1 w-full break-words text-sm text-zinc-500">
            {user.email}
          </p>
        )}
      </div>
      <nav aria-label="Navegação da conta" className="mt-4 space-y-1">
        {itens.map(({ view, texto, Icone }) => (
          <a
            key={view}
            href={`/${view}`}
            aria-current={atual === view ? "page" : undefined}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onNavigate(view);
            }}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              atual === view
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
            )}
          >
            <Icone className="size-5 shrink-0" aria-hidden="true" />
            {texto}
          </a>
        ))}
      </nav>
    </aside>
  );
}
