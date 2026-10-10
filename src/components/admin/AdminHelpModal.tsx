import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import type { LucideIcon } from "lucide-react";
import type React from "react";

interface AdminHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: LucideIcon;
}

/**
 * Ajuda das telas do painel. Mesmas props de sempre; por dentro agora é a
 * `FolhaDoPainel` (Radix Dialog): `role="dialog"` nomeado pelo título, Esc,
 * foco preso e botão "Fechar" — as 14 telas ganham tudo de uma vez.
 * "Entendi" continua fechando; a classe `admin-modal-open` no body fica a
 * cargo da folha.
 */
export function AdminHelpModal({
  isOpen,
  onClose,
  title,
  children,
  icon,
}: AdminHelpModalProps) {
  return (
    <FolhaDoPainel
      aberta={isOpen}
      onFechar={onClose}
      titulo={title}
      icone={icon}
      rodape={
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-xl bg-admin-gold px-5 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-admin-gold/90"
        >
          Entendi
        </button>
      }
    >
      {children}
    </FolhaDoPainel>
  );
}
