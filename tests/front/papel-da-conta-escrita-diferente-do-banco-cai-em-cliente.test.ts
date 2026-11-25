// Protege: `rotuloDoPapel` só aceita o valor EXATO que o banco grava
// (`profiles.role`, minúsculo, sem espaço). Qualquer outra escrita
// ("ADMIN", " admin") cai em "Cliente" — o papel de menor poder —, nunca em
// "Administrador". A tela de Clientes não "adivinha" um cargo de poder a
// partir de um texto torto: se o valor do banco um dia vier diferente do
// esperado, a lojista vê "Cliente" (conservador) em vez de um rótulo que
// sugira acesso ao painel que a conta pode não ter.
import { describe, expect, it } from "vitest";

import { rotuloDoPapel } from "@/lib/papel-da-conta";

describe("rotuloDoPapel — escrita diferente da do banco não promove ninguém", () => {
  it.each([["ADMIN"], ["Admin"], ["GERENTE"], ["Vendedor"]])(
    "%s (maiúsculas) cai em Cliente",
    (valor) => {
      expect(rotuloDoPapel(valor)).toBe("Cliente");
    },
  );

  it.each([[" admin"], ["admin "], ["admin\n"], [" gerente "]])(
    "%j (com espaço sobrando) cai em Cliente",
    (valor) => {
      expect(rotuloDoPapel(valor)).toBe("Cliente");
    },
  );
});
