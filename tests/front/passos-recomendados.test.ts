import { lerStatusDoEmail } from "@/components/admin/settings/email-da-loja-conteudo";
// Os passos "recomendados" do cartão "Sua loja está pronta para vender?" do
// Início (30/10/2026, vistoria da Savy): e-mail da loja, pagamento pelo app e
// transportadora. Função PURA — não bloqueia nada, não entra na conta "N de 6"
// e só fala o que SABE: leitura que falhou ou ainda não chegou some, nunca vira
// "pendente" por chute.
import {
  entradaDosSeisPassos,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import {
  type FatosDosRecomendados,
  type PassoRecomendado,
  fatoDoEmail,
  passosRecomendados,
  pendentesRecomendados,
} from "@/lib/passos-recomendados";
import { describe, expect, it } from "vitest";

/** Tudo resolvido; cada teste estraga só o que quer provar. */
function fatos(parcial: Partial<FatosDosRecomendados> = {}) {
  return {
    email: "configurado",
    pixOk: true,
    nomesLigados: ["Melhor Envio"],
    config: { shippingCoverage: "national", localDeliveryEnabled: true },
    configCarregando: false,
    ...parcial,
  } satisfies FatosDosRecomendados;
}

function passo(
  chave: PassoRecomendado["chave"],
  parcial: Partial<FatosDosRecomendados> = {},
): PassoRecomendado | undefined {
  return passosRecomendados(fatos(parcial)).find((p) => p.chave === chave);
}

describe("passos recomendados — e-mail da loja", () => {
  it("sem remetente nenhum: pendente, no ajuste do e-mail", () => {
    const p = passo("email", { email: "nao_configurado" });
    expect(p?.estado).toBe("pendente");
    expect(p?.destino).toBe("admin-settings");
    expect(p?.explicacaoPendente).toMatch(/não recebem e-mail do pedido/);
  });

  it("e-mail com problema no último envio: pendente, pedindo para corrigir", () => {
    const p = passo("email", { email: "com_problema" });
    expect(p?.estado).toBe("pendente");
    expect(p?.rotuloPendente).toMatch(/Corrigir/);
  });

  it("e-mail configurado (painel ou servidor): feito", () => {
    expect(passo("email", { email: "configurado" })?.estado).toBe("feito");
  });

  it("leitura falhou ou indisponível: o passo some, não chuta", () => {
    expect(passo("email", { email: "desconhecido" })).toBeUndefined();
  });

  it("leitura em curso: carregando", () => {
    expect(passo("email", { email: "carregando" })?.estado).toBe("carregando");
  });
});

describe("passos recomendados — pagamento pelo app", () => {
  it("PIX pronto: feito", () => {
    expect(passo("pagamentoApp", { pixOk: true })?.estado).toBe("feito");
  });

  it("PIX não pronto: pendente, em Ajustes", () => {
    const p = passo("pagamentoApp", { pixOk: false });
    expect(p?.estado).toBe("pendente");
    expect(p?.destino).toBe("admin-settings");
  });

  it("config ainda carregando: carregando (a flag vem da config)", () => {
    expect(
      passo("pagamentoApp", { pixOk: false, configCarregando: true })?.estado,
    ).toBe("carregando");
  });
});

describe("passos recomendados — transportadora", () => {
  it("nenhuma ligada: pendente, na tela de Frete", () => {
    const p = passo("transportadora", { nomesLigados: [] });
    expect(p?.estado).toBe("pendente");
    expect(p?.destino).toBe("admin-shipping");
    expect(p?.explicacaoPendente).toMatch(/quem é de fora não compra/);
  });

  it("uma ligada: feito", () => {
    expect(passo("transportadora")?.estado).toBe("feito");
  });

  it("leitura não chegou (null): o passo some", () => {
    expect(passo("transportadora", { nomesLigados: null })).toBeUndefined();
  });

  it("config ainda carregando: carregando (a cobertura da loja ainda não chegou)", () => {
    expect(
      passo("transportadora", { nomesLigados: [], configCarregando: true })
        ?.estado,
    ).toBe("carregando");
    expect(
      pendentesRecomendados(
        fatos({ nomesLigados: [], configCarregando: true }),
      ),
    ).toEqual([]);
  });

  it("loja que atende só a cidade: o passo não se aplica", () => {
    expect(
      passo("transportadora", {
        nomesLigados: [],
        config: { shippingCoverage: "local" },
      }),
    ).toBeUndefined();
  });

  it("loja só de retirada: o passo não se aplica", () => {
    expect(
      passo("transportadora", {
        nomesLigados: [],
        config: { localDeliveryEnabled: false },
      }),
    ).toBeUndefined();
  });

  it("cobertura ausente vale nacional (mesmo padrão da faixa do Frete)", () => {
    expect(
      passo("transportadora", { nomesLigados: [], config: {} })?.estado,
    ).toBe("pendente");
  });
});

describe("passos recomendados — o que NÃO mudam", () => {
  it("só os pendentes viram aviso, na ordem e-mail, pagamento, transportadora", () => {
    const todos = pendentesRecomendados(
      fatos({ email: "nao_configurado", pixOk: false, nomesLigados: [] }),
    );
    expect(todos.map((p) => p.chave)).toEqual([
      "email",
      "pagamentoApp",
      "transportadora",
    ]);
    expect(pendentesRecomendados(fatos())).toEqual([]);
  });

  it("os seis passos e a contagem continuam os mesmos, com ou sem recomendados", () => {
    const seis = seisPassosDaLojaPronta(
      entradaDosSeisPassos(
        { storeName: "x" },
        {
          pixOk: false,
          formasNaEntrega: ["cash"],
          produtos: [],
          configCarregando: false,
          produtosCarregando: false,
          entrega: "pendente",
        },
      ),
    );
    expect(seis).toHaveLength(6);
    // "Como você recebe" segue feito só com forma na entrega (regra escrita).
    expect(seis.find((p) => p.chave === "recebe")?.estado).toBe("feito");
  });
});

describe("fatoDoEmail — a leitura do e-mail com a régua do selo de Ajustes", () => {
  const lido = (corpo: Record<string, unknown>) => lerStatusDoEmail(corpo);

  it("nenhum remetente: não configurado", () => {
    expect(fatoDoEmail("pronto", lido({ origem: "nenhuma" }))).toBe(
      "nao_configurado",
    );
  });

  it("remetente do servidor ou do painel (mesmo sem teste): configurado", () => {
    expect(fatoDoEmail("pronto", lido({ origem: "ambiente" }))).toBe(
      "configurado",
    );
    expect(
      fatoDoEmail("pronto", lido({ origem: "painel", usuario: "a@gmail.com" })),
    ).toBe("configurado");
  });

  it("painel com o último teste falho: com problema", () => {
    expect(
      fatoDoEmail(
        "pronto",
        lido({
          origem: "painel",
          usuario: "a@gmail.com",
          ultimo_teste: { ok: false, em: "2026-10-01T10:00:00Z" },
        }),
      ),
    ).toBe("com_problema");
  });

  it("carregando, indisponível ou erro: nunca vira pendência", () => {
    expect(fatoDoEmail("carregando", null)).toBe("carregando");
    expect(fatoDoEmail("indisponivel", null)).toBe("desconhecido");
    expect(fatoDoEmail("erro", null)).toBe("desconhecido");
    expect(fatoDoEmail("pronto", null)).toBe("desconhecido");
  });
});
