import {
  type SalvamentoDasTransportadoras,
  TransportadorasSection as Secao,
} from "@/components/admin/settings/TransportadorasCard";
import { type ComponentProps, useState } from "react";
import { vi } from "vitest";

// Os testes unitários de credenciais exercitam os formulários, não o Radix.
// A folha real (abrir/fechar, foco e persistência) é coberta em transportadoras-expansivel.
vi.mock("@/components/admin/primitivos/FolhaDoPainel", () => ({
  FolhaDoPainel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

/** Hospedeiro de teste para a ação que agora pertence ao Salvar da view. */
export function TransportadorasSection(props: ComponentProps<typeof Secao>) {
  const [acao, setAcao] = useState<SalvamentoDasTransportadoras | null>(null);
  return (
    <>
      <Secao {...props} onSalvarMudou={setAcao} />
      <button
        type="button"
        disabled={!acao?.mudou}
        onClick={() => acao?.salvar()}
      >
        Salvar provedores
      </button>
    </>
  );
}
