import { describe, expect, it } from "vitest";

import { explicacaoResolucao } from "@/lib/devolucao";

const fontes = import.meta.glob<string>(
  [
    "/src/components/admin/settings/MercadoPagoSection.tsx",
    "/src/components/admin/settings/PoliticaDeDevolucaoSection.tsx",
    "/src/components/devolucao/SolicitarDevolucaoSheet.tsx",
    "/src/views/admin/AdminPushView.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

const fonte = (caminho: string) => fontes[caminho];

describe("textos sem garantia de atualização, meio de reembolso ou entrega de push", () => {
  it("MercadoPagoSection explica que telas já abertas precisam ser recarregadas", () => {
    const codigo = fonte(
      "/src/components/admin/settings/MercadoPagoSection.tsx",
    );
    expect(
      /vale para novas compras em até 1 minuto;\s+telas\s+já\s+abertas\s+só\s+mudam ao recarregar\./.test(
        codigo,
      ),
    ).toBe(true);
    expect(
      codigo.includes("Pronto. A vitrine passa a refletir em até 1 minuto."),
    ).toBe(false);
  });

  it("PoliticaDeDevolucaoSection não promete reembolso automático ao concluir", () => {
    const codigo = fonte(
      "/src/components/admin/settings/PoliticaDeDevolucaoSection.tsx",
    );
    expect(
      /O reembolso é feito após conferir o produto e concluir a devolução,\s+conforme o meio de pagamento\. Passado o prazo do meio de pagamento,\s+a\s+loja\s+combina\s+outra\s+forma\s+com\s+o\s+cliente\./.test(
        codigo,
      ),
    ).toBe(true);
    expect(/O reembolso sai quando/.test(codigo)).toBe(false);
  });

  it("a explicação compartilhada com SolicitarDevolucaoSheet não garante o mesmo meio", () => {
    expect(explicacaoResolucao("reembolso")).toBe(
      "A loja devolve o valor a você; a forma depende do pagamento e pode ser combinada com a loja.",
    );
    const codigo = fonte(
      "/src/components/devolucao/SolicitarDevolucaoSheet.tsx",
    );
    expect(/explicacao=\{explicacaoResolucao\(r\)\}/.test(codigo)).toBe(true);
  });

  it("AdminPushView descreve todos os aparelhos inscritos, inclusive sem conta", () => {
    const codigo = fonte("/src/views/admin/AdminPushView.tsx");
    expect(
      /vai agora para todos os aparelhos inscritos nos avisos, inclusive de visitantes sem conta\./.test(
        codigo,
      ),
    ).toBe(true);
    expect(
      codigo.includes(
        "vai agora para todos os clientes que ativaram os avisos.",
      ),
    ).toBe(false);
  });

  it("o histórico vazio de AdminPushView fala em aceite para envio, não recebimento", () => {
    const codigo = fonte("/src/views/admin/AdminPushView.tsx");
    expect(/com quantos\s+avisos foram aceitos para envio\./.test(codigo)).toBe(
      true,
    );
    expect(/aparelhos receberam de verdade/.test(codigo)).toBe(false);
  });

  it("o selo positivo de AdminPushView diz que os avisos foram aceitos para envio", () => {
    const codigo = fonte("/src/views/admin/AdminPushView.tsx");
    expect(
      /item\.recipient_count > 0\s*\?\s*\(\s*<span[^>]*>\s*Aceitos para envio\s*<\/span>/.test(
        codigo,
      ),
    ).toBe(true);
  });
});
