// Duas bordas do cartão "Sua loja está pronta para vender?" que o teste
// vizinho não segura: (1) a leitura do e-mail que FALHOU depois de já ter
// funcionado não pode reaproveitar o status velho como se fosse atual;
// (2) enquanto a configuração da loja ainda carrega, o passo do pagamento não
// pode afirmar o aviso grave da transportadora (a flag lida é só "ainda não
// sei"). Valores fictícios.
import { lerStatusDoEmail } from "@/components/admin/settings/email-da-loja-conteudo";
import {
  type FatosDosRecomendados,
  fatoDoEmail,
  passosRecomendados,
} from "@/lib/passos-recomendados";
import { describe, expect, it } from "vitest";

const SEM_E_MAIL_NENHUM = lerStatusDoEmail({ origem: "nenhuma" });
const FUNCIONANDO = lerStatusDoEmail({
  origem: "painel",
  usuario: "loja@example.com",
  ultimo_teste: { ok: true, em: "2026-10-01T10:00:00Z" },
});

describe("fatoDoEmail: leitura que não está pronta não reaproveita status velho", () => {
  it.each(["erro", "indisponivel"] as const)(
    "carga '%s' com um status antigo na mão: desconhecido, não pendência nem 'configurado'",
    (carga) => {
      expect(SEM_E_MAIL_NENHUM).not.toBeNull();
      expect(FUNCIONANDO).not.toBeNull();
      expect(fatoDoEmail(carga, SEM_E_MAIL_NENHUM)).toBe("desconhecido");
      expect(fatoDoEmail(carga, FUNCIONANDO)).toBe("desconhecido");
    },
  );

  it("carregando com status antigo na mão continua 'carregando'", () => {
    expect(fatoDoEmail("carregando", SEM_E_MAIL_NENHUM)).toBe("carregando");
    expect(fatoDoEmail("carregando", FUNCIONANDO)).toBe("carregando");
  });

  it("controle: com a leitura pronta, o mesmo status vale", () => {
    expect(fatoDoEmail("pronto", SEM_E_MAIL_NENHUM)).toBe("nao_configurado");
    expect(fatoDoEmail("pronto", FUNCIONANDO)).toBe("configurado");
  });
});

describe("passo do pagamento pelo app: a explicação grave só vale com a config já lida", () => {
  const base: FatosDosRecomendados = {
    email: "configurado",
    pixOk: false,
    pagamentoPeloAppLigado: false,
    nomesLigados: ["Melhor Envio"],
    config: { shippingCoverage: "national", localDeliveryEnabled: true },
    configCarregando: false,
  };

  const passoDoPagamento = (fatos: FatosDosRecomendados) =>
    passosRecomendados(fatos).find((p) => p.chave === "pagamentoApp");

  it("config lida, transportadora vendendo e PIX desligado: o aviso de que o cliente de fora não finaliza", () => {
    const passo = passoDoPagamento(base);
    expect(passo?.estado).toBe("pendente");
    expect(passo?.explicacaoPendente).toBe(
      "Quem precisa de envio por transportadora não consegue finalizar a compra. Ligue o pagamento pelo app.",
    );
  });

  it("config AINDA carregando: o passo fica 'carregando' e a explicação é a neutra", () => {
    const passo = passoDoPagamento({ ...base, configCarregando: true });
    expect(passo?.estado).toBe("carregando");
    expect(passo?.explicacaoPendente).toBe(
      "Sem ele, seus clientes só podem pagar na entrega",
    );
  });

  it("sem transportadora vendendo, a explicação é a neutra mesmo com a config lida", () => {
    const passo = passoDoPagamento({ ...base, nomesLigados: [] });
    expect(passo?.estado).toBe("pendente");
    expect(passo?.explicacaoPendente).toBe(
      "Sem ele, seus clientes só podem pagar na entrega",
    );
  });
});
