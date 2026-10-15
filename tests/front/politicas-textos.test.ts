// Textos-base das três páginas que a cliente precisa achar ANTES de comprar:
// Termos de uso, Política de Privacidade e Trocas e devoluções.
//
// O que se prova aqui é a PROMESSA de cada texto, não a redação:
// - descreve o que o app REALMENTE faz (dados que coleta, Mercado Pago);
// - a troca usa os prazos que a lojista configurou (tabela politica_devolucao),
//   e sem a política carregada cai no mínimo que a lei garante (7 dias);
// - nenhum texto promete o que a loja não decidiu (sem "undefined", sem prazo
//   inventado, sem "troca grátis").
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TIPOS_DE_POLITICA,
  montarPolitica,
  textoCorrido,
} from "@/lib/textos-das-politicas";
import type { PoliticaDevolucao } from "@/types/devolucao";

const LOJA = { nome: "Loja da Ana" };

const POLITICA: PoliticaDevolucao = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: null,
};

describe("textos das políticas — todas as três", () => {
  it("existem exatamente três tipos", () => {
    expect([...TIPOS_DE_POLITICA]).toEqual(["termos", "privacidade", "trocas"]);
  });

  it.each(TIPOS_DE_POLITICA)("%s: título, seções e nome da loja", (tipo) => {
    const doc = montarPolitica(tipo, LOJA, POLITICA);
    expect(doc.titulo.length).toBeGreaterThan(5);
    expect(doc.secoes.length).toBeGreaterThanOrEqual(3);
    expect(textoCorrido(doc)).toContain("Loja da Ana");
    for (const s of doc.secoes) {
      expect(s.titulo.trim()).not.toBe("");
      expect(s.paragrafos.length).toBeGreaterThan(0);
    }
  });

  it.each(TIPOS_DE_POLITICA)(
    "%s: nada de undefined/null/NaN na tela",
    (tipo) => {
      const doc = montarPolitica(tipo, LOJA, POLITICA);
      expect(textoCorrido(doc)).not.toMatch(/undefined|null|NaN|\[object/);
      const semPolitica = montarPolitica(tipo, LOJA, null);
      expect(textoCorrido(semPolitica)).not.toMatch(
        /undefined|null|NaN|\[object/,
      );
    },
  );

  it("cada texto-base carrega o aviso de revisão da lojista, no código", () => {
    // O aviso é comentário de código (a lojista revisa antes de publicar),
    // nunca texto que a cliente vê na tela.
    const fonte = readFileSync(
      new URL("../../src/lib/textos-das-politicas.ts", import.meta.url),
      "utf8",
    );
    const marcas = fonte.match(/\/\/ TEXTO-BASE: a lojista deve revisar/g);
    expect(marcas?.length).toBe(3);
    for (const tipo of TIPOS_DE_POLITICA) {
      expect(textoCorrido(montarPolitica(tipo, LOJA, POLITICA))).not.toMatch(
        /TEXTO-BASE|deve revisar/,
      );
    }
  });
});

describe("Termos de uso", () => {
  const texto = textoCorrido(montarPolitica("termos", LOJA, POLITICA));

  it("diz o que o app faz: pedido, pagamento pelo Mercado Pago, frete por CEP", () => {
    expect(texto).toMatch(/Mercado Pago/);
    expect(texto).toMatch(/CEP/);
    expect(texto).toMatch(/pedido/i);
  });

  it("remete as trocas à página própria, sem repetir prazo", () => {
    expect(texto).toMatch(/Trocas e devoluções/);
    expect(texto).not.toMatch(/\b\d+ dias\b/);
  });
});

describe("Política de Privacidade", () => {
  const texto = textoCorrido(montarPolitica("privacidade", LOJA, POLITICA));

  it("lista os dados que o app realmente pede", () => {
    for (const dado of ["nome", "WhatsApp", "e-mail", "endereço", "CPF"]) {
      expect(texto, dado).toContain(dado);
    }
  });

  it("diz para quê, com quem divide e como exercer os direitos (LGPD)", () => {
    expect(texto).toMatch(/entregar|entrega/i);
    expect(texto).toMatch(/Mercado Pago/);
    expect(texto).toMatch(/LGPD|Lei Geral de Proteção de Dados/);
    expect(texto).toMatch(/exclu/i);
    expect(texto).toMatch(/corrig/i);
  });

  it("não vende dado e não promete o que o app não faz", () => {
    expect(texto).toMatch(/não vend/i);
    expect(texto).not.toMatch(/anúncios|publicidade|rastre/i);
  });

  it("notificações só com o consentimento da cliente", () => {
    expect(texto).toMatch(/notifica/i);
    expect(texto).toMatch(/se você (permitir|aceitar|autorizar)/i);
  });
});

describe("Trocas e devoluções — usa o que a lojista configurou", () => {
  it("prazos da loja aparecem como configurados", () => {
    const texto = textoCorrido(
      montarPolitica("trocas", LOJA, {
        ...POLITICA,
        prazo_arrependimento_dias: 10,
        prazo_troca_dias: 45,
        prazo_vicio_dias: 120,
      }),
    );
    expect(texto).toMatch(/10 dias/);
    expect(texto).toMatch(/45 dias/);
    expect(texto).toMatch(/120 dias/);
    expect(texto).toMatch(/art\. 49/);
  });

  it("loja que NÃO aceita troca não promete troca", () => {
    const texto = textoCorrido(
      montarPolitica("trocas", LOJA, { ...POLITICA, aceita_troca: false }),
    );
    expect(texto).toMatch(/não faz troca|não aceita troca/i);
    expect(texto).not.toMatch(/45 dias|30 dias/);
  });

  it("quem paga o frete da troca e quando o reembolso sai", () => {
    const loja = textoCorrido(
      montarPolitica("trocas", LOJA, {
        ...POLITICA,
        frete_troca_pago_por: "loja",
        reembolso_momento: "apos_inspecao",
      }),
    );
    expect(loja).toMatch(/frete da troca é pago pela loja/i);
    expect(loja).toMatch(/depois que a loja confere/i);

    const cliente = textoCorrido(
      montarPolitica("trocas", LOJA, {
        ...POLITICA,
        frete_troca_pago_por: "cliente",
        reembolso_momento: "ao_receber",
      }),
    );
    expect(cliente).toMatch(/frete da troca é pago por você/i);
    expect(cliente).toMatch(/assim que a loja recebe/i);
  });

  it("categorias sem troca e endereço de devolução entram quando existem", () => {
    const doc = montarPolitica("trocas", LOJA, {
      ...POLITICA,
      categorias_sem_troca: ["Calcinhas", "Brincos"],
      endereco_devolucao: "Rua das Flores, 10, Centro",
    });
    const texto = textoCorrido(doc);
    expect(texto).toContain("Calcinhas");
    expect(texto).toContain("Brincos");
    expect(texto).toContain("Rua das Flores, 10, Centro");
    const sem = textoCorrido(montarPolitica("trocas", LOJA, POLITICA));
    expect(sem).not.toContain("Calcinhas");
    expect(sem).not.toContain("Rua das Flores");
  });

  it("o texto que a lojista escreveu vem inteiro, em seção própria", () => {
    const doc = montarPolitica("trocas", LOJA, {
      ...POLITICA,
      texto_politica: "Troca só com etiqueta.\nSem troca de peça lavada.",
    });
    const secao = doc.secoes.find((s) => s.id === "regras-da-loja");
    expect(secao).toBeDefined();
    expect(secao?.paragrafos).toEqual([
      "Troca só com etiqueta.",
      "Sem troca de peça lavada.",
    ]);
  });

  it("sem política carregada: só o mínimo da lei, sem inventar prazo da loja", () => {
    const doc = montarPolitica("trocas", LOJA, null);
    const texto = textoCorrido(doc);
    expect(texto).toMatch(/7 dias/);
    expect(texto).toMatch(/art\. 49/);
    // Nenhum prazo além dos 7 dias do CDC: troca, defeito e frete ficam
    // por conta da conversa com a loja.
    expect(texto).not.toMatch(/\b(30|90|120|45) dias\b/);
    expect(texto).toMatch(/fale com a loja/i);
  });

  it("explica como pedir: pelo pedido, na conta", () => {
    const texto = textoCorrido(montarPolitica("trocas", LOJA, POLITICA));
    expect(texto).toMatch(/Solicitar devolução ou troca/);
    expect(texto).toMatch(/Meus pedidos/);
  });
});
