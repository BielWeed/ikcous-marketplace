// A programação do banner termina NO instante do fim, inclusive: até esse
// milissegundo o banner está no ar e a lojista ainda não é avisada de "já
// terminou"; no milissegundo seguinte, passou. As três regras de data precisam
// concordar na borda, senão o painel diz "Já terminou" de um banner que a
// cliente ainda está vendo (ou o contrário).
//
// Relógio fixo: `agora` é passado e nunca lido do sistema.
import {
  estaNoAr,
  fimDoBannerEmTexto,
  problemaDasDatas,
} from "@/lib/datas-do-banner";
import { describe, expect, it } from "vitest";

const FIM = new Date(2026, 10, 24, 12, 0, 0, 0); // 24/11/2026 12:00:00.000, relógio local
const FIM_ISO = FIM.toISOString();
const NO_INSTANTE_DO_FIM = new Date(FIM.getTime());
const UM_MS_DEPOIS = new Date(FIM.getTime() + 1);

describe("o fim da programação do banner, no milissegundo", () => {
  it("no instante exato do fim o banner ainda está no ar; 1 ms depois, não", () => {
    const banner = { active: true, endDate: FIM_ISO };
    expect(estaNoAr(banner, NO_INSTANTE_DO_FIM)).toBe(true);
    expect(estaNoAr(banner, UM_MS_DEPOIS)).toBe(false);
  });

  it("no instante exato do fim o painel ainda NÃO diz que o fim já passou", () => {
    expect(problemaDasDatas(null, FIM_ISO, NO_INSTANTE_DO_FIM)).toBeNull();
    expect(problemaDasDatas(null, FIM_ISO, UM_MS_DEPOIS)).toBe("fim-ja-passou");
  });

  it("no instante exato do fim o texto ainda diz 'Termina hoje'; 1 ms depois, 'Já terminou'", () => {
    expect(fimDoBannerEmTexto(FIM_ISO, NO_INSTANTE_DO_FIM)).toBe(
      "Termina hoje às 12:00.",
    );
    expect(fimDoBannerEmTexto(FIM_ISO, UM_MS_DEPOIS)).toBe(
      "Já terminou em 24/11 às 12:00.",
    );
  });
});
