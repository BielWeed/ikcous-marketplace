---
name: "truth-gate-sros"
description: "Validação de axiomas de negócio e integridade lógica sob o protocolo SROS."
risk: medium
---

# Truth Gate & SROS

## Use esta habilidade quando
- Alterar validações de cadastro, regras de frete ou limites do marketplace em `src/utils/truth_gate.ts`.
- Atualizar ou estender o manifesto SROS em `public/sros_manifest.json`.

## Instruções
1. **Axiomas Estritos**: Sempre valide preço não-negativo, limite de estoque (10000), identidade do produto e margens financeiras antes de persistir alterações.
2. **Recibos de Validação**: Gere um `VerificationReceipt` contendo status (`VERIFIED` ou `ABORTED`), violações e aviso de prejuízo. Lance erro em caso de `ABORTED`.
3. **Auditoria SROS**: Registre no console o recibo formatado com estilo do VOR-G17 para auditoria do enxame.