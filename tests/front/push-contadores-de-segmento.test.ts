// Auditoria de 20/08/2026, achados 6, 7 e 12 — a tela de Push (AdminPushView)
// misturava três coisas: número medido, número inventado e palavra errada.
//
// Achado 6: dos quatro botões de público, só o segmento SELECIONADO era
// medido de verdade (via `get_segmented_push_targets`). Os outros três eram
// `subCount * 0.3`, `* 0.25` e `* 0.45` — percentuais escritos no componente.
// Com o total em 8 aparelhos, a tela mostrava 3, 2 e 3; o banco tinha 2, 0
// e 0. Dois segmentos vazios anunciados como tendo gente.
//
// Achado 12: "Receberão: N clientes" e o botão de enviar contam linhas de
// `push_subscriptions`, que são inscrições de APARELHO — não cliente. Dos 8
// aparelhos medidos no dia da auditoria, 6 não tinham dono e os outros 2
// eram do mesmo cliente. Cliente distinto: 1.
//
// Estas duas funções puras isolam a parte que dá para testar sem montar a
// tela: como formatar uma contagem que pode não ter chegado ainda (nunca um
// palpite, ver `rotuloDaContagem`) e como escrever "aparelho(s)" no singular
// e no plural certos (`textoDeAlcanceEmAparelhos`). O componheiro
// `admin-push-view-contadores.test.tsx` prova que a TELA usa estas funções —
// sozinho, este arquivo não pega o defeito de esquecer de ligar a função no
// JSX.
import { describe, expect, it } from "vitest";

import {
  rotuloDaContagem,
  textoDeAlcanceEmAparelhos,
} from "@/utils/contadores-de-push";

describe("rotuloDaContagem — nunca inventa número", () => {
  it("número medido aparece como está", () => {
    expect(rotuloDaContagem(2)).toBe("2");
    expect(rotuloDaContagem(0)).toBe("0");
  });

  it("medição que ainda não chegou (null) vira traço, não zero", () => {
    // Zero é uma afirmação forte ("não há ninguém aqui"). Enquanto a RPC não
    // respondeu, a tela não sabe disso — e não pode fingir que sabe.
    expect(rotuloDaContagem(null)).toBe("—");
  });

  it("medição que falhou também vira traço, nunca uma estimativa", () => {
    expect(rotuloDaContagem(null)).not.toBe("0");
    expect(rotuloDaContagem(null)).not.toMatch(/^\d+$/);
  });
});

describe("textoDeAlcanceEmAparelhos — a palavra certa, no número certo", () => {
  it("plural para 0 e para mais de 1", () => {
    expect(textoDeAlcanceEmAparelhos(0)).toBe("0 aparelhos");
    expect(textoDeAlcanceEmAparelhos(8)).toBe("8 aparelhos");
  });

  it("singular exato para 1", () => {
    expect(textoDeAlcanceEmAparelhos(1)).toBe("1 aparelho");
    expect(textoDeAlcanceEmAparelhos(1)).not.toBe("1 aparelhos");
  });

  it("nunca chama aparelho de cliente", () => {
    expect(textoDeAlcanceEmAparelhos(8)).not.toMatch(/cliente/i);
  });
});
