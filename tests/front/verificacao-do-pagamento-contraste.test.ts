import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const verificacao = readFileSync(
  "src/components/checkout/VerificacaoDoPagamento.tsx",
  "utf8",
);

it.each(["desafio", "desafio-sem-pagina", "desafio-concluido"])(
  "o aviso de cartão (%s) tem um par opaco de fundo e texto",
  (estado) => {
    const aviso = Array.from(
      verificacao.matchAll(
        /situacao\.tipo === "([^"]+)" && \(\s*<p className="([^"]+)"/g,
      ),
    ).find(([, tipo]) => tipo === estado);
    const classes = aviso?.[2].split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["bg-white", "text-zinc-900"]),
    );
    expect(classes).not.toContain("text-foreground");
  },
);
