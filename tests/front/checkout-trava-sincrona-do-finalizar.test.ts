// CHECKOUT-030 (#27), metade do front: a trava do botão de finalizar precisa
// fechar no PRIMEIRO instante do clique.
//
// O DEFEITO: `handleSubmitEvent` abre com `await form.trigger()` e só chama
// `setIsSubmitting(true)` depois — ou seja, fora do tique síncrono do clique.
// Entre o toque e o botão ficar desabilitado existe uma janela de pelo menos um
// `await` mais um render do React. Dois toques rápidos (ou o duplo toque que o
// celular emite sozinho quando a tela demora a responder) entram os dois nessa
// janela e criam DOIS pedidos: estoque debitado duas vezes e cupom de uso único
// consumido duas vezes.
//
// `disabled={isSubmitting}` não fecha essa janela — `isSubmitting` é estado do
// React, e estado só chega na tela no render seguinte.
//
// POR QUE UM `ref` E NÃO ESTADO: `ref.current` muda no mesmo instante da
// atribuição, dentro do mesmo tique do JavaScript. É a única coisa que o
// segundo clique enxerga antes de qualquer `await`.
//
// O QUE ESTE TESTE **NÃO** COBRE, e está no critério de aceite da issue: se a
// RPC gravar o pedido e a resposta estourar por tempo, o `catch` reabilita o
// botão e o cliente toca de novo — criando um segundo pedido legítimo do ponto
// de vista do front. Isso não se resolve no navegador: exige chave de
// idempotência gravada no banco, que é a outra metade da #27 e mexe em
// migration da tabela de pedidos.
import { describe, expect, it, vi } from "vitest";

import { criarTravaDeEnvio } from "@/lib/travaDeEnvio";

describe("criarTravaDeEnvio — trava síncrona do finalizar (#27)", () => {
  it("o segundo clique no mesmo instante não passa", () => {
    const trava = criarTravaDeEnvio();

    expect(trava.tentarEntrar()).toBe(true);
    // Sem nenhum await no meio: é exatamente o duplo toque.
    expect(trava.tentarEntrar()).toBe(false);
    expect(trava.tentarEntrar()).toBe(false);
  });

  it("depois de liberar, um envio novo é permitido", () => {
    // Dois pedidos legítimos seguidos do mesmo cliente continuam funcionando —
    // critério de aceite da issue.
    const trava = criarTravaDeEnvio();

    expect(trava.tentarEntrar()).toBe(true);
    trava.liberar();
    expect(trava.tentarEntrar()).toBe(true);
  });

  it("liberar sem ter entrado não quebra nem abre a trava por engano", () => {
    const trava = criarTravaDeEnvio();

    trava.liberar();
    expect(trava.tentarEntrar()).toBe(true);
    expect(trava.tentarEntrar()).toBe(false);
  });

  it("a prova que importa: só UM de dez cliques simultâneos entra", async () => {
    // Reproduz a janela real — vários cliques disparados antes de qualquer um
    // deles terminar o primeiro `await`.
    const trava = criarTravaDeEnvio();
    const pedidosCriados = vi.fn();

    async function aoClicar() {
      if (!trava.tentarEntrar()) return;
      try {
        // O `await form.trigger()` do checkout, que é onde a janela existia.
        await Promise.resolve();
        pedidosCriados();
      } finally {
        trava.liberar();
      }
    }

    await Promise.all(Array.from({ length: 10 }, () => aoClicar()));

    expect(pedidosCriados).toHaveBeenCalledTimes(1);
  });
});
