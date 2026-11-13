// No modelo Foto, "Toque para tentar de novo" abria o destino do banner em vez
// de pedir a foto de novo.
//
// O DEFEITO: a foto é `absolute inset-0` e a camada de conteúdo
// (`.banner-pronto-conteudo`, `position: relative`, depois dela no DOM) cobre a
// banner inteiro -- o toque caía na camada de conteúdo, nunca chegava ao botão
// de dentro da foto, e subia ao slide, que navega.
//
// A CORREÇÃO: no modelo Foto o conteúdo é só texto (nada clicável), então a
// camada deixa o toque passar para a foto. Medido no Chromium real com o CSS
// verdadeiro: antes o elemento sob o toque era `banner-pronto-conteudo`; depois
// é o botão, e o slide não recebe o clique. jsdom não faz teste de toque (não
// tem layout nem empilhamento), por isso este teste lê o CSS e trava a regra.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório.
const css = readFileSync(
  resolve(__dirname, "../../src/components/ui/custom/banner-pronto.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function regra(seletor: string): string {
  const achada = css
    .split("}")
    .map((bloco) => bloco.split("{"))
    .find(([s]) => s?.trim() === seletor);
  return achada?.[1] ?? "";
}

it("no modelo Foto a camada de conteúdo deixa o toque passar para a foto", () => {
  expect(regra('[data-modelo="foto"] .banner-pronto-conteudo')).toMatch(
    /pointer-events:\s*none/,
  );
});

it("nos outros modelos a foto mora DENTRO do conteúdo, que segue recebendo toque", () => {
  expect(regra(".banner-pronto-conteudo")).not.toMatch(/pointer-events/);
});
