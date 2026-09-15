import { expect, test } from "@playwright/test";

// CASO-SÍMBOLO do E2E (despacho expansao-ci, critério 4): o atravessamento
// de clique da folha de opções — o defeito que o dono VIU ao vivo: clicar
// fora da folha fechava ela E navegava para o card de fundo (pushState para
// product-detail 1 ms depois do click; espionado com listeners de captura).
//
// DESLIGADO DE PROPÓSITO (test.fixme): o conserto mora no PR #576
// (fix/folha-opcoes-botao-e-fecho, ABERTO em 14/09 — contra a develop de
// hoje este spec falharia POR DEFEITO, não por teste ruim). Job informacional
// não pode nascer vermelho; nasce desligado.
//
// PLANO DE ATIVAÇÃO (quando a #576 mergear, coordenado pela central):
//   1. Tirar o `.fixme` (trocar por `test`). O fluxo abaixo já é o contrato:
//      folha abre pelo card → clique fora → folha fecha E a URL não muda.
//   2. PRÉ-REQUISITO compartilhado com o spec de boot: a página do build
//      fixture não boota sem a ficha do porteiro — diagnóstico completo e
//      as duas receitas de caminho de boot estão em
//      e2e/app-boota-sem-tela-branca.spec.ts. A peça de ativação resolve
//      os DOIS de uma vez.
//   3. Dados: para abrir a folha é preciso ao menos UM produto no catálogo
//      da home — na ativação, interceptar a listagem de produtos com
//      `page.route` e responder um fixture mínimo, ou apontar a conexão da
//      ficha para uma loja de teste; decidir lá, com a #576 na develop.
//   4. Seletores: confirmar contra o DOM real da home. Os papéis/labels
//      verdadeiros estão nos testes jsdom do conserto
//      (tests/front/product-card-escolhe-opcoes-na-folha.test.tsx) — lá é a
//      fonte, aqui é rascunho declarado.
test.fixme(
  "clique fora da folha de opções só fecha — não atravessa para o fundo",
  async ({ page }) => {
    await page.goto("/");

    // Abre a folha de opções de um produto do catálogo (seletores a
    // confirmar na ativação — ver passo 3 do plano acima).
    const primeiroCard = page
      .getByTestId("product-card")
      .or(page.locator("article").filter({ hasText: /\S/ }))
      .first();
    await primeiroCard.getByRole("button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Clique fora da folha (folha de fundo/vaul ocupa a faixa de baixo;
    // o ponto fica no topo da tela, fora dela).
    const tela = await page.viewportSize();
    await page.mouse.click(Math.floor((tela?.width ?? 1280) / 2), 80);

    // A folha fecha E nenhuma navegação aconteceu para o fundo.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(page.url()).not.toContain("product");
  },
);
