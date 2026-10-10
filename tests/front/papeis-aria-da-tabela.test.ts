// O helper `papel` (papéis ARIA da tabela) morava copiado em duas telas
// (histórico de consultas de frete e ficha do cliente). Agora é um só, em
// `src/lib/papeis-aria-da-tabela.ts`; este teste prova o contrato e que as
// cópias locais não voltam.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê o fonte das duas telas da própria árvore do repositório (caminhos constantes, não de entrada de usuário) */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type PapelDeTabela, papel } from "../../src/lib/papeis-aria-da-tabela";

const PAPEIS: PapelDeTabela[] = [
  "table",
  "rowgroup",
  "row",
  "columnheader",
  "cell",
];

describe("papel (papéis ARIA da tabela)", () => {
  it.each(PAPEIS)("devolve { role: %s } para o espalhamento no JSX", (r) => {
    expect(papel(r)).toEqual({ role: r });
  });
});

describe("as telas usam o helper compartilhado", () => {
  const TELAS = [
    "src/components/admin/settings/HistoricoCotacoesCard.tsx",
    "src/views/admin/AdminUserDetailView.tsx",
  ];

  it.each(TELAS)("%s importa o helper e não declara cópia local", (tela) => {
    const fonte = readFileSync(tela, "utf8");
    expect(fonte).not.toMatch(/const papel\s*=/);
    expect(fonte).toMatch(/from "@\/lib\/papeis-aria-da-tabela"/);
  });
});
