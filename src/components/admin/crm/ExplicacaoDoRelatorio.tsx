import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";

export const EXPLICACAO_HISTORICA =
  "Este número olha todos os clientes desde o início da loja — não muda quando você troca o período.";

export function ExplicacaoDoRelatorio({
  titulo,
  children,
}: Readonly<{ titulo: string; children: ReactNode }>) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Entender ${titulo}`}
        aria-haspopup="dialog"
        onClick={() => setAberta(true)}
        className="text-admin-text-soft inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold"
      >
        <Info className="size-4" aria-hidden="true" />
      </button>
      <AdminHelpModal
        isOpen={aberta}
        onClose={() => setAberta(false)}
        title={titulo}
      >
        <div className="text-admin-text-2 text-xs leading-relaxed">
          {children}
        </div>
      </AdminHelpModal>
    </>
  );
}
