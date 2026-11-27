/* eslint-disable security/detect-non-literal-fs-filename -- Só lê fontes locais fixas, sem entrada de usuário. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  classesDoCelular,
  classesDoCelularSemGradeDeTablet,
} from "./classes-do-celular";

const caminhos = {
  carrinho: "src/views/customer/CartView.tsx",
  checkout: "src/views/customer/CheckoutView.tsx",
  favoritos: "src/views/customer/FavoritesView.tsx",
  busca: "src/components/ui/custom/OrderSearch.tsx",
};
function literais(caminho: string) {
  const fonte = ts.createSourceFile(
    caminho,
    readFileSync(caminho, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const atributos: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(fonte) === "className") {
      const valores: string[] = [];
      function coletar(filho: ts.Node) {
        if (ts.isStringLiteral(filho)) valores.push(filho.text);
        else ts.forEachChild(filho, coletar);
      }
      if (no.initializer) coletar(no.initializer);
      atributos.push(valores.join(" "));
    } else ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  return atributos;
}
const encontrar = (caminho: string, prefixo: string) => {
  const classe = literais(caminho).find((c) => c.startsWith(prefixo));
  expect(classe, prefixo).toBeDefined();
  return classe!;
};

describe("P32: alinhamento e resumo alcançável no computador", () => {
  it("deixa o resumo do carrinho seguir a rolagem real, abaixo das abas", () => {
    // Sem overflow-visible, sticky se prende ao invólucro que NÃO rola.
    const invólucro = encontrar(
      caminhos.carrinho,
      "relative flex w-full flex-1 flex-col overflow-hidden",
    );
    expect(invólucro.split(/\s+/)).toContain("lg:overflow-visible");
    const resumo = encontrar(caminhos.carrinho, "sticky top-24 hidden");
    expect(resumo.split(/\s+/)).toContain("lg:top-[88px]");
    // 76px de abas + 12px de respiro; não repetir os 73px do cabeçalho externo (121px até a 1.5.194).
    expect(resumo).not.toMatch(/lg:top-(?:24|0)(?:\s|$)/);
  });

  it("centraliza o cartão sem conta, sem estreitar novamente a aba Pedidos", () => {
    const busca = encontrar(caminhos.busca, "space-y-4 xs:space-y-6");
    expect(busca.split(/\s+/)).toEqual(
      expect.arrayContaining(["lg:mx-auto", "lg:w-full", "lg:max-w-2xl"]),
    );
    const abas = encontrar(caminhos.carrinho, "sticky top-[-2px]");
    const pedidos = encontrar(
      caminhos.carrinho,
      "flex w-full flex-1 flex-col px-4 pb-6 pt-0",
    );
    expect(abas).toContain(
      "lg:has-[#tab-orders[aria-selected=true]]:max-w-[1216px]",
    );
    expect(pedidos).toContain("lg:max-w-[1216px]");
    expect(abas.split(/\s+/)).toContain("lg:px-8");
    expect(pedidos.split(/\s+/)).toContain("lg:px-8");
  });

  it("alinha checkout ao primeiro cartão e preserva a altura/rolagem do P6", () => {
    const resumo = encontrar(
      caminhos.checkout,
      "hidden lg:flex lg:flex-col lg:rounded-3xl",
    );
    expect(resumo.split(/\s+/)).toContain("lg:top-6");
    expect(resumo.split(/\s+/)).not.toContain("lg:top-24");
    expect(resumo).toContain("lg:max-h-[calc(100dvh-241px)]");
    expect(resumo.split(/\s+/)).toContain("lg:overflow-y-auto");
  });

  it("retira o segundo recuo de favoritos vazio e centraliza sua mensagem", () => {
    const cabecalhos = literais(caminhos.favoritos).filter((c) =>
      c.startsWith("px-4 pb-4 pt-5"),
    );
    // O segundo cabeçalho é o estado vazio; o primeiro é a leitura em andamento.
    expect(cabecalhos).toHaveLength(2);
    expect(cabecalhos[1].split(/\s+/)).toContain("lg:px-0");
    const vazio = encontrar(
      caminhos.favoritos,
      "flex flex-col items-center px-6 pb-6 pt-10 text-center",
    );
    expect(vazio.split(/\s+/)).toEqual(
      expect.arrayContaining(["lg:px-0", "lg:items-center", "lg:text-center"]),
    );
    expect(vazio.split(/\s+/)).not.toContain("lg:items-start");
    expect(vazio.split(/\s+/)).not.toContain("lg:text-left");
    expect(
      encontrar(caminhos.favoritos, "mx-4 mt-4 border-t").split(/\s+/),
    ).toContain("lg:mx-0");
  });

  it("congela os literais de celular tocados na base 8dccb46f7", () => {
    for (const [caminho, prefixo, esperado] of [
      [
        caminhos.carrinho,
        "relative flex w-full flex-1 flex-col overflow-hidden",
        "relative flex w-full flex-1 flex-col overflow-hidden",
      ],
      [
        caminhos.carrinho,
        "sticky top-24 hidden",
        "sticky top-24 hidden w-full shrink-0 space-y-5 rounded-[18px] border border-border bg-background p-6",
      ],
      [
        caminhos.checkout,
        "hidden lg:flex lg:flex-col lg:rounded-3xl",
        "hidden",
      ],
      [caminhos.busca, "space-y-4 xs:space-y-6", "space-y-4 xs:space-y-6"],
      [
        caminhos.favoritos,
        "flex flex-col items-center px-6 pb-6 pt-10 text-center",
        "flex flex-col items-center px-6 pb-6 pt-10 text-center [html[data-theme-mode=glass]_&]:bg-card",
      ],
      [
        caminhos.favoritos,
        "mx-4 mt-4 border-t",
        "mx-4 mt-4 border-t border-border pt-6",
      ],
    ]) {
      expect(classesDoCelular(encontrar(caminho, prefixo))).toBe(esperado);
    }
    for (const classe of literais(caminhos.favoritos).filter((c) =>
      c.startsWith("px-4 pb-4 pt-5"),
    )) {
      expect(classesDoCelular(classe)).toBe("px-4 pb-4 pt-5");
    }
  });

  it("preserva a assinatura completa do celular, não o hash do arquivo", () => {
    // Mesma coleta de desktop-favoritos-e-pedidos: literais não vazios na ordem AST.
    for (const [caminho, assinatura] of [
      [
        caminhos.carrinho,
        "1dc0eeae81190e2946f2b062e7036424fc24e369d31fb97fecb039bd2be421c2",
      ],
      [
        caminhos.checkout,
        // 1.5.214: troco e seus avisos, pedido cancelado e resumo do parcelamento.
        // Selo Pix de ao menos 24 px visíveis (manual do BCB): 388 → 389
        // literais. Só entra a caixa Pix de 25 px; os outros mantêm size-5.
        // Botão de login por Tab para pagar com Pix: 389 → 390.
        // Comparado com 9d8c38a69: só o literal do novo botão entrou.
        // 1.5.232: contraste de texto de informação (só a COR muda, nenhuma classe
        // de layout): "Número do pedido"/"Pedido" zinc-400 → zinc-600 e o aviso
        // "Seus dados estão seguros" zinc-300 → zinc-600 (dark:zinc-300).
        // 26/11/2026: campo de CEP da conta sem endereço (rótulo, campo, erro, ajuda): 390 → 394, nada saiu.
        // 27/11/2026: foco depois da recusa — `outline-none` no painel da recusa
        // e nos valores do pedido (recebem foco por programa, tabIndex -1); nenhuma
        // classe de layout mudou. E a região `sr-only` que fala o total ao leitor
        // de tela (fora do fluxo, sem altura): 1 literal entrou, nada saiu.
        // 27/11/2026 (pagamento fala com o leitor de tela): `outline-none` no
        // texto do erro vermelho e no do âmbar (recebem foco por programa,
        // tabIndex -1); a região `sr-only` da troca de forma de pagamento entrou;
        // o `outline-none` do TituloQueRecebeOFoco saiu com ele para
        // src/components/checkout/TituloQueRecebeOFoco.tsx. 409 → 409 literais,
        // nenhuma classe de layout mudou (conferido contra a base 34c1d6c08).
        "270f9b94241d3f3314b1276be1df2d1ae97a1acff2d956d772e2bb99700fbd21",
      ],
      [
        caminhos.favoritos,
        "01c4f2611dc3321eaab592ad1e8eb651f00621e95352f0393f1c3baa9bb7e38e",
      ],
      [
        caminhos.busca,
        // 1.5.218: código com menos de 6 dígitos mostra o aviso junto ao campo
        // ("text-sm text-destructive", elemento novo) e o campo ganha a borda de
        // erro só quando inválido ("aria-invalid:border-destructive"). Nenhuma
        // outra classe de celular mudou (conferido contra a base 8dccb46f7).
        // Bloco do número da loja no rastreio.
        "b54ccc1c64b801b86974f3632b7af77fc10885f4c935fa45069ed3744e22e5f0",
      ],
    ]) {
      // Extração independente dos atributos agrupados, para preservar condicionais.
      // O `md:grid-cols-3` do tablet (P35) é a única classe de celular acrescentada de propósito.
      const fonte = ts.createSourceFile(
        caminho,
        readFileSync(caminho, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const valores: string[] = [];
      function visitar(no: ts.Node) {
        if (ts.isJsxAttribute(no) && no.name.getText(fonte) === "className") {
          function coletar(filho: ts.Node) {
            if (ts.isStringLiteral(filho)) {
              const celular = classesDoCelularSemGradeDeTablet(filho.text);
              if (celular) valores.push(celular);
            } else ts.forEachChild(filho, coletar);
          }
          if (no.initializer) coletar(no.initializer);
        } else ts.forEachChild(no, visitar);
      }
      visitar(fonte);
      expect(
        createHash("sha256").update(JSON.stringify(valores)).digest("hex"),
        `Classes móveis mudaram em ${caminho}; base 8dccb46f7`,
      ).toBe(assinatura);
    }
  });
});
