// Três funções pequenas do painel com lacunas que os testes das telas deixavam:
//  - `serieCobreMaisDeUmAno` com série de UM dia só (a primeira comparação lê o
//    segundo elemento? não pode);
//  - `tipoDaVitrine` / `tituloExibido` (o cartão da vitrine na tela de Vitrines);
//  - `textoDoServicoQueNaoCotou` / `registrarServicosQueNaoCotaram` (o que a
//    lojista lê quando um serviço de frete não cota, e o que vai só ao console).
import { Flame, Layers, Sparkles, Zap } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serieCobreMaisDeUmAno } from "@/components/admin/dashboard/rotulo-do-dia";
import {
  FRASE_SERVICO_NAO_COTOU,
  registrarServicosQueNaoCotaram,
  textoDoServicoQueNaoCotou,
} from "@/components/admin/settings/transportadoras-conteudo";
import {
  type SecaoDaHome,
  tipoDaVitrine,
  tituloExibido,
} from "@/components/admin/vitrines/tipos";

describe("serieCobreMaisDeUmAno — séries curtas", () => {
  it("um dia só, ou nenhum, não cobre mais de um ano (e não quebra)", () => {
    expect(serieCobreMaisDeUmAno([])).toBe(false);
    expect(serieCobreMaisDeUmAno([{ date: "2026-01-02" }])).toBe(false);
  });

  it("três dias: basta UM de outro ano, em qualquer posição", () => {
    expect(
      serieCobreMaisDeUmAno([
        { date: "2026-01-01" },
        { date: "2026-06-01" },
        { date: "2027-01-01" },
      ]),
    ).toBe(true);
    expect(
      serieCobreMaisDeUmAno([
        { date: "2026-01-01" },
        { date: "2026-06-01" },
        { date: "2026-12-31" },
      ]),
    ).toBe(false);
  });
});

function secao(campos: Partial<SecaoDaHome>): SecaoDaHome {
  return { id: "x", title: "Título", active: true, ...campos };
}

describe("tipoDaVitrine — o tipo sai do id", () => {
  it("as três de fábrica têm rótulo e ícone próprios", () => {
    expect(tipoDaVitrine(secao({ id: "new_arrivals" }))).toEqual({
      rotulo: "Lançamentos",
      Icone: Sparkles,
    });
    expect(tipoDaVitrine(secao({ id: "offers" }))).toEqual({
      rotulo: "Ofertas",
      Icone: Flame,
    });
    expect(tipoDaVitrine(secao({ id: "bestsellers" }))).toEqual({
      rotulo: "Destaques",
      Icone: Zap,
    });
  });

  it("qualquer outro id é personalizada, mesmo com `type` de fábrica gravado", () => {
    expect(tipoDaVitrine(secao({ id: "minha-colecao" }))).toEqual({
      rotulo: "Personalizada",
      Icone: Layers,
    });
    expect(tipoDaVitrine(secao({ id: "custom-1", type: "offers" }))).toEqual({
      rotulo: "Personalizada",
      Icone: Layers,
    });
    expect(tipoDaVitrine(secao({ id: "" }))).toEqual({
      rotulo: "Personalizada",
      Icone: Layers,
    });
  });
});

describe("tituloExibido — vitrine sem título não some do leitor de tela", () => {
  it("título normal sai aparado", () => {
    expect(tituloExibido(secao({ title: "  Verão  " }))).toBe("Verão");
  });

  it("vazio, só espaço ou ausente viram 'Sem nome'", () => {
    expect(tituloExibido(secao({ title: "" }))).toBe("Sem nome");
    expect(tituloExibido(secao({ title: "   \t " }))).toBe("Sem nome");
    expect(
      tituloExibido({ id: "x", active: true } as unknown as SecaoDaHome),
    ).toBe("Sem nome");
  });
});

describe("textoDoServicoQueNaoCotou — só frase curta em português chega à lojista", () => {
  it("sem detalhe nenhum: 'erro do serviço'", () => {
    expect(textoDoServicoQueNaoCotou(undefined)).toBe(
      "não cotou (erro do serviço)",
    );
  });

  it("frase em português passa, com o motivo entre parênteses", () => {
    expect(textoDoServicoQueNaoCotou("fora da área de entrega")).toBe(
      "não cotou (fora da área de entrega)",
    );
    expect(textoDoServicoQueNaoCotou("Indisponível")).toBe(
      "não cotou (Indisponível)",
    );
  });

  it("código HTTP de três dígitos é técnico, mesmo dentro de frase em português", () => {
    expect(textoDoServicoQueNaoCotou("serviço fora do ar (503)")).toBe(
      FRASE_SERVICO_NAO_COTOU,
    );
    expect(textoDoServicoQueNaoCotou("erro 404 no serviço")).toBe(
      FRASE_SERVICO_NAO_COTOU,
    );
  });

  it("número de outro tamanho não é código HTTP", () => {
    expect(textoDoServicoQueNaoCotou("fora do limite de 12 volumes")).toBe(
      "não cotou (fora do limite de 12 volumes)",
    );
  });

  it("inglês técnico, JSON, URL e vocabulário de erro caem na frase fixa", () => {
    for (const cru of [
      "Service unavailable",
      '{"error":"x"}',
      "https://api.exemplo.com/cotar",
      "Internal Server Error",
      "timeout não esperado",
      "<html>erro</html>",
      "failed",
    ]) {
      expect(textoDoServicoQueNaoCotou(cru)).toBe(FRASE_SERVICO_NAO_COTOU);
    }
  });

  it("texto que não parece português nem técnico também cai na frase fixa", () => {
    expect(textoDoServicoQueNaoCotou("xyz")).toBe(FRASE_SERVICO_NAO_COTOU);
    expect(textoDoServicoQueNaoCotou("")).toBe(FRASE_SERVICO_NAO_COTOU);
  });
});

describe("registrarServicosQueNaoCotaram — o texto cru vai só ao console", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serviço que falhou COM detalhe: um aviso com provedor, código e o detalhe cru", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarServicosQueNaoCotaram("Frenet", [
      { codigo: "sedex", ok: false, detalhe: "Service unavailable" },
    ]);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[TransportadorasCard] Frenet: serviço sedex não cotou:",
      "Service unavailable",
    );
  });

  it("não avisa: serviço que cotou (mesmo com detalhe), falha sem detalhe ou com detalhe vazio", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarServicosQueNaoCotaram("Frenet", [
      { codigo: "pac", ok: true, detalhe: "ok mas com observação" },
      { codigo: "sedex", ok: false },
      { codigo: "mini", ok: false, detalhe: "" },
    ]);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("lista ausente não quebra nem avisa", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarServicosQueNaoCotaram("Frenet", undefined);
    registrarServicosQueNaoCotaram("Frenet", []);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("vários serviços: um aviso por serviço que falhou com detalhe", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarServicosQueNaoCotaram("SuperFrete", [
      { codigo: "a", ok: false, detalhe: "x" },
      { codigo: "b", ok: true },
      { codigo: "c", ok: false, detalhe: "y" },
    ]);
    expect(aviso).toHaveBeenCalledTimes(2);
  });
});
