import { useAuth } from "@/hooks/useAuth";
import { useDonoDaLoja } from "@/hooks/useDonoDaLoja";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { Customer } from "@/utils/admin_cache";
import { ChevronRight, ShieldCheck, ShieldOff } from "lucide-react";
import { FOCO_CLIENTES } from "./FolhaClientes";

export type AcaoDeCargo = "promover" | "remover";

/**
 * Qual ação de cargo cabe neste cartão para quem está olhando, ou `null`.
 * Só o dono da loja age; nunca no cartão dele nem no da própria pessoa logada;
 * e só para quem é cliente (promover) ou administrador (remover): gerente e
 * vendedor não têm ação, o banco só conhece admin/customer.
 */
export function acaoDeCargoPara(
  customer: Customer,
  eu: { souODono: boolean; donoId: string | null; meuId: string | null },
): AcaoDeCargo | null {
  if (!eu.souODono || !eu.meuId) return null;
  if (customer.id === eu.meuId || customer.id === eu.donoId) return null;
  if (customer.role === "customer") return "promover";
  if (customer.role === "admin") return "remover";
  return null;
}

/**
 * A linha de ação de cargo dentro da folha "Gestão de Cliente". Mesmo desenho
 * das linhas vizinhas (ficha, push). A leitura de quem é o dono só acontece
 * quando a folha abre (este componente só existe com ela aberta).
 */
export function PromoverAdminAcoes({
  customer,
  aoEscolher,
}: {
  readonly customer: Customer;
  readonly aoEscolher: (acao: AcaoDeCargo) => void;
}) {
  const meuId = useAuth()?.user?.id ?? null;
  const { souODono, donoId } = useDonoDaLoja();
  const offline = useOnlineStatus();
  const acao = acaoDeCargoPara(customer, { souODono, donoId, meuId });
  if (!acao) return null;

  const promover = acao === "promover";
  const Icone = promover ? ShieldCheck : ShieldOff;

  return (
    <button
      type="button"
      disabled={offline}
      onClick={() => aoEscolher(acao)}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl py-3 text-left disabled:opacity-50 ${FOCO_CLIENTES}`}
    >
      <Icone
        aria-hidden="true"
        className={
          promover
            ? "size-11 shrink-0 rounded-xl border border-amber-300/20 bg-amber-300/10 p-2 text-amber-300"
            : "size-11 shrink-0 rounded-xl border border-red-300/20 bg-red-300/10 p-2 text-red-300"
        }
      />
      <span className="min-w-0 flex-1">
        <span
          className={
            promover
              ? "block text-sm font-bold text-white"
              : "block text-sm font-bold text-red-300"
          }
        >
          {promover
            ? "Tornar administrador"
            : "Remover acesso de administrador"}
        </span>
        <span className="block text-xs text-zinc-400">
          {promover
            ? "Dá acesso ao painel da loja. Só o dono da loja pode fazer isso."
            : "Volta a ser cliente e perde o acesso ao painel."}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
    </button>
  );
}
