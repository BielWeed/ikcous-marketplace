// Diagnóstico temporário do incidente de 28/09/2026: roda o mesmo buildStore
// da Vercel, mas imprime o motivo real da falha (o CLI só diz "entrega não
// confirmada"). Só imprime mensagens de erro, nunca chaves.
import { buildStore } from "../buildStore.mjs";

function cadeia(erro) {
  const partes = [];
  let atual = erro;
  for (let i = 0; atual && i < 6; i++) {
    partes.push(`${atual.name ?? "Error"}: ${atual.message ?? String(atual)}`);
    atual = atual.cause;
  }
  return partes.join("\n  causa -> ");
}

try {
  await buildStore();
  console.log("BUILD OK");
} catch (erro) {
  console.error(`FALHA:\n  ${cadeia(erro)}`);
  if (erro?.stack) console.error(erro.stack.split("\n").slice(0, 12).join("\n"));
  process.exitCode = 1;
}
