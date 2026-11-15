// Onda 0 do plano app-cliente-desktop (F1.2, contrato C2): toda medida de
// layout de computador mora em `src/components/desktop/medidas.ts`, e cada
// constante é o literal do contrato, palavra por palavra -- mudar o VALOR
// aqui é mudar contrato, não ajuste solto desta tarefa. R1 (spec §4.1) exige
// que todo token comece por `lg:`, `xl:` ou `2xl:` (nunca `md:`/`sm:`/sem
// prefixo): só o computador pode mudar, o celular fica intacto.
import * as medidas from "@/components/desktop/medidas";
import { cn } from "@/lib/utils";
import { describe, expect, it } from "vitest";

const CONTRATO_C2: Record<string, string> = {
  CONTAINER_DO_COMPUTADOR:
    "lg:mx-auto lg:w-full lg:max-w-[1280px] lg:px-8 2xl:max-w-[1440px]",
  GRADE_DE_PRODUTOS_NO_COMPUTADOR: "lg:grid-cols-4 lg:gap-5 xl:grid-cols-5",
  // P41: o teto descontava `--header-height` (52px, variável do CELULAR), mas o
  // cabeçalho do computador tem 121px -- o cartão de compra passava 53px da
  // janela a 1024x768. O valor agora é a altura real (121) + 48 (24 de topo
  // grudado + 24 de folga embaixo).
  COLUNA_FIXA_NO_COMPUTADOR:
    "lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-121px-48px)] lg:overflow-y-auto",
  GAVETA_NO_COMPUTADOR:
    "lg:w-full lg:max-w-[440px] lg:gap-0 lg:rounded-l-3xl lg:p-0",
  TITULO_DE_PAGINA_NO_COMPUTADOR:
    "lg:text-4xl lg:leading-none lg:tracking-tighter",
  ROTULO_NO_COMPUTADOR: "lg:text-[11px] lg:text-zinc-500",
};

describe("medidas do computador — contrato C2", () => {
  it("preserva as seis classes do contrato e exporta a altura do cabeçalho", () => {
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
      [...Object.keys(CONTRATO_C2), "ALTURA_DO_CABECALHO_DO_COMPUTADOR"].sort(),
    );
  });

  it("todo token das constantes de classes começa por lg:, xl: ou 2xl:", () => {
    for (const [nome, valor] of Object.entries(medidas)) {
      if (nome === "ALTURA_DO_CABECALHO_DO_COMPUTADOR") {
        expect(valor).toBe(121);
        continue;
      }
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

  it("a coluna fixa desconta o cabeçalho REAL do computador, nunca a variável do celular", () => {
    const tokens = medidas.COLUNA_FIXA_NO_COMPUTADOR.split(" ");
    const teto = tokens.find((t) => t.startsWith("lg:max-h-"));
    // `--header-height` vale 52px (celular); o cabeçalho do computador tem 121px.
    expect(medidas.COLUNA_FIXA_NO_COMPUTADOR).not.toContain("--header-height");
    expect(teto).toBe(
      `lg:max-h-[calc(100dvh-${medidas.ALTURA_DO_CABECALHO_DO_COMPUTADOR}px-48px)]`,
    );
    // O topo grudado (top-6 = 24px) e a folga de baixo (24px) somam os 48px:
    // o cartão acaba 24px antes da borda da janela, nunca além dela.
    expect(tokens).toContain("lg:top-6");
  });

  it("o resumo do checkout mantém o próprio teto (241px) depois da mescla com a coluna fixa", () => {
    // O checkout acrescenta `lg:top-6 lg:max-h-[calc(100dvh-241px)]` à coluna
    // fixa; a mescla de classes tem de ficar só com o teto do checkout, para a
    // mudança do teto da coluna não mexer no resumo (Total e Finalizar).
    const mesclado = cn(
      "hidden lg:flex lg:flex-col lg:rounded-3xl lg:border lg:border-zinc-200 lg:bg-white",
      medidas.COLUNA_FIXA_NO_COMPUTADOR,
      "lg:top-6 lg:max-h-[calc(100dvh-241px)] lg:overflow-y-auto",
    ).split(" ");
    expect(mesclado.filter((t) => t.startsWith("lg:max-h-"))).toEqual([
      "lg:max-h-[calc(100dvh-241px)]",
    ]);
    expect(mesclado.filter((t) => t.startsWith("lg:top-"))).toEqual([
      "lg:top-6",
    ]);
  });
});
