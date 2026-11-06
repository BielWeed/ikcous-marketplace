// Os avisos de falha ao salvar o CPF mandavam a cliente para
// "Minha conta > Informações pessoais" — um menu que não existe no app (a
// tela se chama "Sua conta"; o atalho no Perfil é "Segurança e conta").
// `mensagemFalhaCpf` já é coberto em cpf-da-conta.test.ts; aqui o guarda é
// sobre os textos do CADASTRO em AuthContext, que são literais.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("avisos do CPF do cadastro citam um caminho que existe", () => {
  const fonte = readFileSync("src/contexts/AuthContext.tsx", "utf8");

  it("nenhum aviso manda para 'Informações pessoais' nem para 'Minha conta >'", () => {
    expect(fonte).not.toContain("Informações pessoais");
    expect(fonte).not.toContain("Minha conta >");
  });

  it("os avisos do cadastro apontam para Perfil > Segurança e conta", () => {
    expect(fonte).toContain("Informe-o em Perfil > Segurança e conta.");
    expect(fonte).toContain(
      "Você pode informá-lo depois em Perfil > Segurança e conta.",
    );
  });
});
