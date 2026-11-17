// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  ROL_FECHADO_POR_CONSULTA,
  veredictoDaConsulta,
} = require("../../scripts/publicacao/conferir-banco.cjs");
const antes = "151b-antes-o-banner-tem-imagem-propria-no-computador-ausente";
const depois =
  "151a-conferir-o-banner-tem-imagem-propria-no-computador-aplicado";

describe("publicação das imagens independentes do banner", () => {
  it.each([antes, depois])(
    "%s exige todas as três linhas da prova",
    (consulta) => {
      const rol = new Map<string, string[]>(
        Object.entries(ROL_FECHADO_POR_CONSULTA),
      ).get(consulta)!;
      expect(rol).toHaveLength(3);
      const linhas = rol.map((item: string) => ({
        item,
        esperado: "sim",
        vivo: "sim",
        ok: true,
      }));
      const veredicto = (valor: unknown[]) =>
        veredictoDaConsulta({
          consulta,
          ref: "fixture",
          sha: "fixture",
          linhas: valor,
        });
      expect(veredicto(linhas)).toContain("rol=ok");
      expect(veredicto(linhas.slice(1))).toContain("rol=invalido");
      expect(veredicto([...linhas, linhas[0]])).toContain("rol=invalido");
      expect(
        veredicto(linhas.map((l: object) => ({ ...l, ok: "true" }))),
      ).toContain("rol=invalido");
    },
  );

  it("liga a migration às provas antes e depois e ao workflow", () => {
    const canais = JSON.parse(
      readFileSync("scripts/frota/canais-de-backend.json", "utf8"),
    );
    const lote = canais.provasDeObjetos.find((p: { versoes: string[] }) =>
      p.versoes.includes("20261399999000"),
    );
    expect(lote).toMatchObject({
      consulta: depois,
      ausenciaConfirmadaPor: antes,
    });
    const workflow = readFileSync(
      ".github/workflows/conferir-banco-da-loja.yml",
      "utf8",
    );
    expect(workflow).toContain(`- ${antes}`);
    expect(workflow).toContain(`- ${depois}`);
  });
});
