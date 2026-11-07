// No iPhone com o painel instalado o app desenha por baixo da barra de status
// (faixa preta de `safe-area-inset-top`, sempre por cima de tudo) e a barra de
// início encosta no rodapé. As janelas de tela cheia no celular (Simulador do
// aplicativo, Nova variação, Completar grade) começavam em y=0: o título e os
// botões do topo ficavam sob a faixa, e Cancelar/Salvar encostavam na barra de
// baixo. As folgas somam a área segura (`--safe-area-top`/`--safe-area-bottom`,
// que valem 0 fora do iPhone instalado) ao respiro que a janela já tinha.
//
// Estático: o jsdom não aplica CSS, então a prova é a classe que a tela usa no
// cabeçalho e no rodapé de cada janela (mesmo molde de formulario-produto-letra-e-toque-l).
/* eslint-disable security/detect-non-literal-fs-filename --
   a prova lê o próprio arquivo-fonte (caminho fixo no repositório) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fonte = (caminho: string) =>
  readFileSync(join(__dirname, "..", "..", caminho), "utf8");

/** As classes do elemento cujo `className` literal contém `trecho`. */
function classesDoElementoCom(codigo: string, trecho: string): string {
  const achados = [...codigo.matchAll(/className="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((classes) => classes.includes(trecho));
  expect(achados, `elemento com className contendo: ${trecho}`).toHaveLength(1);
  return achados[0];
}

const TOPO_DA_JANELA = "pt-[calc(1.25rem+var(--safe-area-top,0px))]";
const RODAPE_DA_JANELA = "pb-[calc(1.25rem+var(--safe-area-bottom,0px))]";

describe("janelas de tela cheia reservam a área segura do iPhone", () => {
  it("Completar grade: o cabeçalho desce abaixo da barra de status e o rodapé sobe acima da barra de início", () => {
    const codigo = fonte(
      "src/components/admin/products/ModalVarianteGrade.tsx",
    );
    const cabecalho = classesDoElementoCom(
      codigo,
      "border-b border-admin-border bg-admin-bg p-5",
    );
    expect(cabecalho).toContain(TOPO_DA_JANELA);
    const rodape = classesDoElementoCom(
      codigo,
      "border-t border-admin-border bg-admin-surface p-5",
    );
    expect(rodape).toContain(RODAPE_DA_JANELA);
  });

  it("Nova variação (variação única): o cabeçalho desce abaixo da barra de status e o rodapé sobe acima da barra de início", () => {
    const codigo = fonte("src/views/admin/AdminProductFormView.tsx");
    const cabecalho = classesDoElementoCom(
      codigo,
      "border-b border-admin-border bg-admin-bg p-5",
    );
    expect(cabecalho).toContain(TOPO_DA_JANELA);
    const rodape = classesDoElementoCom(
      codigo,
      "border-t border-admin-border bg-admin-surface p-5",
    );
    expect(rodape).toContain(RODAPE_DA_JANELA);
  });

  it("Simulador do aplicativo: título e abas começam abaixo da barra de status", () => {
    const codigo = fonte("src/components/admin/PhoneSimulator.tsx");
    const barra = classesDoElementoCom(
      codigo,
      "border-b border-solid border-border bg-card/90",
    );
    expect(barra).toContain("pt-[calc(0.75rem+var(--safe-area-top,0px))]");
    expect(barra).toContain("pb-3");
    expect(barra).not.toContain("py-3");
  });
});
