import { IconePix as SimboloPix } from "@/components/icons/IconesDePagamento";

// Reutiliza o glifo oficial do checkout, sem duplicar o path no painel.
export function IconePix({ className }: { readonly className?: string }) {
  return <SimboloPix className={`icone-pix ${className ?? ""}`} />;
}
