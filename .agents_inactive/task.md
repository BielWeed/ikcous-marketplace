# Checklist de Execução - Verificação do Backend IKCOUS

- [x] Criar testes unitários para a Edge Function de cálculo de frete
  - [x] Criar `supabase/functions/calculate-shipping/index_test.ts`
  - [x] Validar a execução dos testes via `deno test`
- [x] Criar testes unitários de banco de dados (pgTAP)
  - [x] Criar diretório `supabase/tests` se não existir
  - [x] Criar `supabase/tests/database_verification_test.sql`
- [x] Criar os scripts automatizados na pasta de ferramentas do usuário
  - [x] Criar `Verificar_Completo.ps1`
  - [x] Criar `Executar_Verificacao_Completa.bat`
- [x] Executar o script de verificação e analisar os resultados
  - [x] Executar o script unificado
  - [x] Gerar o primeiro relatório `relatorio_verificacao.md`
- [x] Atualizar o Guia de Qualidade e Testes do Backend
  - [x] Atualizar `Guia de Qualidade e Testes do Backend.md` com as novas ferramentas e instruções
- [/] Criar walkthrough final
