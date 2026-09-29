// Onda 0 do plano app-cliente-desktop (F1.2, contrato C2): toda medida de
// layout de computador mora em `src/components/desktop/medidas.ts`, e cada
// constante é o literal do contrato, palavra por palavra -- mudar o VALOR
// aqui é mudar contrato, não ajuste solto desta tarefa. R1 (spec §4.1) exige
// que todo token comece por `lg:`, `xl:` ou `2xl:` (nunca `md:`/`sm:`/sem
// prefixo): só o computador pode mudar, o celular fica intacto.
import * as medidas from "@/components/desktop/medidas";
import { describe, expect, it } from "vitest";

const CONTRATO_C2: Record<string, string> = {
  CONTAINER_DO_COMPUTADOR:
    "lg:mx-auto lg:w-full lg:max-w-[1280px] lg:px-8 2xl:max-w-[1440px]",
  GRADE_DE_PRODUTOS_NO_COMPUTADOR: "lg:grid-cols-4 lg:gap-5 xl:grid-cols-5",
  COLUNA_FIXA_NO_COMPUTADOR:
    "lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-var(--header-height)-48px)] lg:overflow-y-auto",
  GAVETA_NO_COMPUTADOR:
    "lg:w-full lg:max-w-[440px] lg:gap-0 lg:rounded-l-3xl lg:p-0",
  TITULO_DE_PAGINA_NO_COMPUTADOR:
    "lg:text-4xl lg:leading-none lg:tracking-tighter",
  ROTULO_NO_COMPUTADOR: "lg:text-[11px] lg:text-zinc-500",
};

describe("medidas do computador — contrato C2", () => {
  it("exporta exatamente as seis constantes do contrato, com o valor literal", () => {
    for (const [nome, valorEsperado] of Object.entries(CONTRATO_C2)) {
      // Chave vem do literal CONTRATO_C2 acima, fixo neste arquivo -- nunca
      // de entrada externa; mesmo padrão de
      // guarda-de-cor-sai-junto-com-a-escrita.test.ts.
      // eslint-disable-next-line security/detect-object-injection
      const valorReal = (medidas as unknown as Record<string, string>)[nome];
      expect(valorReal, `esperava a constante ${nome} exportada`).toBe(
        valorEsperado,
      );
    }
    expect(Object.keys(medidas).sort()).toEqual(
      Object.keys(CONTRATO_C2).sort(),
    );
  });

  it("todo token de toda constante começa por lg:, xl: ou 2xl:", () => {
    for (const [nome, valor] of Object.entries(medidas)) {
      const tokens = (valor as string).split(" ").filter(Boolean);
      expect(tokens.length, `${nome} não pode ficar vazio`).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(
          /^(lg|xl|2xl):/.test(token),
          `${nome}: token "${token}" não começa por lg:/xl:/2xl:`,
        ).toBe(true);
      }
    }
  });
});
