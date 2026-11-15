import { useTelaDeComputador } from "@/hooks/useTelaDeComputador";
import type { View } from "@/types";
import { type ReactNode, Suspense, lazy } from "react";

export interface CabecalhoClienteProps {
  currentView: View;
  onNavigate: (view: View, id?: string) => void;
  searchQuery: string;
  onSearch: (query: string) => void;
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
  onCategoryChange: (category: string) => void;
  onOpenNotifications: () => void;
  hideSearch?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
  children?: ReactNode;
}

const CabecalhoDoComputador = lazy(() =>
  import("./CabecalhoDoComputador").then((m) => ({
    default: m.CabecalhoDoComputador,
  })),
);

/** O celular não monta (nem pede o módulo de) navegação de computador. */
export function CabecalhoCliente({
  children,
  ...props
}: CabecalhoClienteProps) {
  const computador = useTelaDeComputador();
  if (!computador) return children;
  return (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          className="hidden lg:block lg:h-[121px] lg:shrink-0 lg:bg-white"
        />
      }
    >
      <CabecalhoDoComputador {...props} />
    </Suspense>
  );
}
