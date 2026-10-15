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

import { TIPOS_DE_POLITICA } from "@/lib/nomes-das-politicas";
import { montarPolitica, textoCorrido } from "@/lib/textos-das-politicas";
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do proprio repositorio
    const fonte = readFileSync(
      new URL("../../src/lib/textos-das-politicas.ts", import.meta.url),
      "utf8",
    );
    const marcas = fonte.match(/\/\/ TEXTO-BASE: a lojista deve revisar/g);
    expect(marcas?.length).toBe(3);
    // Fiel ao fato: hoje NÃO existe tela para a lojista editar Termos nem
    // Privacidade (só as regras de troca, em Ajustes). O comentário não pode
    // prometer o contrário.
    expect(fonte).not.toMatch(/PODE e DEVE revisar/i);
    expect(fonte).toMatch(/não existe tela/i);
    for (const tipo of TIPOS_DE_POLITICA) {
      expect(textoCorrido(montarPolitica(tipo, LOJA, POLITICA))).not.toMatch(
        /TEXTO-BASE|deve revisar/,
      );
    }
  });
});

describe("linguagem neutra: fala com 'você', sem flexão de gênero", () => {
  const FLEXAO =
    /\ba cliente\b|\bda cliente\b|\bpela cliente\b|\bmesma\b|\bmesmo\b|\bobrigad[ao]\b|\bsozinha\b|\bsozinho\b|\bpronta\b|\bpronto\b/i;

  it.each(TIPOS_DE_POLITICA)("%s: nenhuma frase flexiona gênero", (tipo) => {
    for (const politica of [POLITICA, null]) {
      expect(textoCorrido(montarPolitica(tipo, LOJA, politica))).not.toMatch(
        FLEXAO,
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

  it("notificações só com o consentimento de quem usa", () => {
    expect(texto).toMatch(/notifica/i);
    expect(texto).toMatch(/se você (permitir|aceitar|autorizar)/i);
  });

  describe("com quem os dados vão (conferido no código das funções)", () => {
    const secao = montarPolitica("privacidade", LOJA, POLITICA).secoes.find(
      (s) => s.id === "com-quem",
    );
    const comQuem = (secao?.paragrafos ?? []).join("\n");

    it("a transportadora recebe também o e-mail (etiqueta: to.email e new_sender_mail)", () => {
      expect(comQuem).toMatch(/transportadoras?/i);
      expect(comQuem).toMatch(
        /nome, endereço, WhatsApp, e-mail e, quando exigido, o CPF/,
      );
    });

    it("o serviço de e-mail da loja (comprovante do pedido e código de verificação)", () => {
      expect(comQuem).toMatch(/serviço de e-mail/i);
      expect(comQuem).toMatch(/comprovante/i);
      expect(comQuem).toMatch(/código de verificação/i);
    });

    it("o serviço de notificações do navegador, só para quem permitiu", () => {
      expect(comQuem).toMatch(/serviço de notificações do seu navegador/i);
      expect(comQuem).toMatch(/se você permitir/i);
    });

    it("a plataforma de hospedagem tem acesso técnico e pode ficar fora do Brasil", () => {
      expect(comQuem).toMatch(/fora do Brasil/);
      expect(comQuem).toMatch(/acesso técnico/);
      expect(comQuem).toMatch(/manter o (serviço|app)/i);
    });

    it("nenhuma frase afirma que SÓ a loja vê os dados (a empresa que mantém o app também tem acesso)", () => {
      const doc = montarPolitica("privacidade", LOJA, POLITICA);
      const todo = textoCorrido(doc);
      expect(todo).not.toMatch(
        /só a equipe|somente a equipe|apenas a equipe|só (a loja|quem)|exclusiv/i,
      );
      const seguranca = doc.secoes
        .find((s) => s.id === "seguranca")
        ?.paragrafos.join(" ");
      expect(seguranca).toMatch(
        /a loja e a empresa que fornece e mantém este app, só para fazê-lo funcionar/,
      );
      // Sem citar a marca da plataforma.
      expect(todo).not.toMatch(/ikcous/i);
    });

    it("segue dizendo que a loja não vende dados", () => {
      expect(comQuem).toMatch(/não vende/);
    });
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

    const voce = textoCorrido(
      montarPolitica("trocas", LOJA, {
        ...POLITICA,
        frete_troca_pago_por: "cliente",
        reembolso_momento: "ao_receber",
      }),
    );
    expect(voce).toMatch(/frete da troca é pago por você/i);
    expect(voce).toMatch(/assim que a loja recebe/i);
  });

  it("não inventa condição que nenhuma regra configurada prevê", () => {
    for (const politica of [POLITICA, null]) {
      expect(
        textoCorrido(montarPolitica("trocas", LOJA, politica)),
      ).not.toMatch(/boas condições|sem uso|na embalagem|com etiqueta/i);
    }
  });

  it("no arrependimento e no defeito o frete de volta é da loja (a favor de quem compra)", () => {
    for (const politica of [POLITICA, null]) {
      const doc = montarPolitica("trocas", LOJA, politica);
      const secao = doc.secoes.find((s) => s.id === "frete-de-volta");
      expect(secao, "seção do frete de volta").toBeDefined();
      expect((secao?.paragrafos ?? []).join(" ")).toMatch(
        /arrependimento e no defeito.*frete de volta é pago pela loja/i,
      );
    }
  });

  it("vale: aparece quando a loja o aceita, mesmo sem troca por preferência", () => {
    const semTrocaComVale = textoCorrido(
      montarPolitica("trocas", LOJA, {
        ...POLITICA,
        aceita_troca: false,
        aceita_vale: true,
      }),
    );
    expect(semTrocaComVale).toMatch(/não faz troca por preferência/);
    expect(semTrocaComVale).toMatch(/\bvale\b/i);

    const semNenhum = textoCorrido(
      montarPolitica("trocas", LOJA, {
        ...POLITICA,
        aceita_troca: false,
        aceita_vale: false,
      }),
    );
    expect(semNenhum).not.toMatch(/\bvale\b/i);
  });

  it("defeito: prazo da tabela contado do recebimento, e a lei pode dar mais tempo", () => {
    const texto = textoCorrido(montarPolitica("trocas", LOJA, POLITICA));
    expect(texto).toMatch(/até 90 dias, contados a partir do recebimento/);
    expect(texto).toMatch(/por mais tempo/);
    expect(texto).toMatch(/Código de Defesa do Consumidor/);
    // Não promete além do que o app faz: remete à loja.
    expect(texto).toMatch(/fale com a loja/i);
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
