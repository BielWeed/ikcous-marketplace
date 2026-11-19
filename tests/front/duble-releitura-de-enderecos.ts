import { vi } from "vitest";

// Para testes de checkout que não exercitam o banco: a consulta confirma
// a mesma lista da tela. Os testes de falha usam o hook real e controlam o banco.
export function comReleituraDeEnderecos<T extends { addresses: unknown[] }>(
  estado: T,
) {
  return {
    ...estado,
    fetchAddresses: vi.fn(
      async (opcoes?: { aoLer?: (enderecos: T["addresses"]) => void }) => {
        opcoes?.aoLer?.(estado.addresses);
      },
    ),
  };
}
