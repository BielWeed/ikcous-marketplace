// RESUMO DA AUDITORIA DE DEPENDÊNCIAS — frente CI-SAÚDE (14/09/2026).
//
// Lê a saída `npm audit --json` (caminho vem de argv[2]) e publica no summary:
// contagem por severidade e, destacadas, as vulnerabilidades ALTA/CRÍTICA com
// a correção disponível ou não. Informativo: nunca falha o run.
//
// npm audit cobre o ecossistema npm (package-lock). O deno.lock é território
// dos testes de edge e não passa por aqui — anotado no desfecho da frente.

import fs from "node:fs";
import process from "node:process";

const arquivo = process.argv[2];
const gravidade = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

let auditoria;
try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do próprio workflow (${{ runner.temp }}), não de usuário
  auditoria = JSON.parse(fs.readFileSync(arquivo, "utf8"));
} catch {
  console.log(
    "### 🛡️ Dependências\n\n::warning::`npm audit --json` não produziu saída legível — conferir o log do passo de auditoria.",
  );
  process.exit(0);
}

const metadados = auditoria.metadata?.vulnerabilities;
if (!metadados) {
  // npm devolve {} quando não há lock auditável; não é silêncio, é recado.
  console.log(
    "### 🛡️ Dependências\n\nAuditoria não retornou metadados (lock ausente ou registry indisponível).",
  );
  process.exit(0);
}

console.log("### 🛡️ Dependências — `npm audit`\n");
console.log(
  `**Total: ${metadados.total}** — crítica: **${metadados.critical}** · alta: **${metadados.high}** · moderada: ${metadados.moderate} · baixa: ${metadados.low} · info: ${metadados.info}\n`,
);

const graves = Object.values(auditoria.vulnerabilities ?? {})
  .filter((v) => (gravidade[v.severity] ?? -1) >= gravidade.high)
  .sort((a, b) => (gravidade[b.severity] ?? 0) - (gravidade[a.severity] ?? 0));

if (graves.length === 0) {
  console.log("✅ Nenhuma vulnerabilidade de severidade ALTA ou CRÍTICA.\n");
} else {
  console.log("| Pacote | Severidade | Direto? | Correção disponível |");
  console.log("|---|---|---|---|");
  for (const v of graves) {
    const correcao =
      v.fixAvailable === true
        ? "sim"
        : v.fixAvailable && typeof v.fixAvailable === "object"
          ? `sim — atualizar \`${v.fixAvailable.name}\` p/ ${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? " (major: pode quebrar)" : ""}`
          : "**ainda sem correção**";
    console.log(
      `| \`${v.name}\` | ${v.severity === "critical" ? "🔴 crítica" : "🟠 alta"} | ${v.isDirect ? "sim" : "transitivo"} | ${correcao} |`,
    );
  }
  console.log("");
  for (const v of graves) {
    console.log(
      `::warning::Dependência ${v.severity === "critical" ? "CRÍTICA" : "DE ALTA SEVERIDADE"}: ${v.name} (${v.range}).`,
    );
  }
}

console.log(
  "\nFonte: `npm audit` sobre o `package-lock.json` do PR, dev+prod. Informativo — o gate continua sendo o de sempre.",
);
process.exit(0);
