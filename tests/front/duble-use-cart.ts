import { useState } from "react";

/**
 * Fábrica de dublê do `useCart` para testes que precisam do CONTRATO
 * compartilhado do endereço escolhido. Recebe a função ORIGINAL do dublê do
 * arquivo e a chama A CADA render — estado mutável do teste (mockUser,
 * vi.hoisted) continua sendo lido fresco. O id do endereço escolhido mora
 * num `useState` real: o auto-select do checkout grava e a tela reage, como
 * no CartContext de verdade. Função NOMEADA para a regra de hooks.
 */
export function criarUseCartDeTeste(obterDados: () => Record<string, unknown>) {
  function useCartDeTeste() {
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    return {
      ...obterDados(),
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
    };
  }
  return useCartDeTeste;
}
