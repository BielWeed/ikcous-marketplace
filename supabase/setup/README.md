# Setup de Verificação do Backend (IKCOUS)

Este diretório contém a estrutura de ferramentas, guias e scripts para verificação da qualidade, integridade e estabilidade do ecossistema do backend (Supabase + Deno + Postgres) da aplicação **IKCOUS Marketplace**.

---

## 🛠️ Ferramentas Utilizadas

Nossa suite de ferramentas locais é composta por:

1. **Bruno (Git-Friendly API Client)**
   - **Descrição:** Cliente de API open-source focado em performance. As requisições são salvas em arquivos locais de texto plano (`.bru`), permitindo que a coleção de testes de endpoints seja versionada e compartilhada diretamente no repositório.
   - **Uso no projeto:** Validação de endpoints e simulação de fluxos de negócio.

2. **DBeaver Community Edition (Database Manager)**
   - **Descrição:** Administrador de banco de dados universal robusto.
   - **Uso no projeto:** Inspeção de tabelas, execução de consultas SQL e administração de esquemas local e remoto.

3. **Deno Runtime (Edge Functions Engine)**
   - **Descrição:** Runtime JavaScript/TypeScript seguro que executa nossas Edge Functions.
   - **Uso no projeto:** Análise estática (`deno lint`) e execução dos testes unitários das funções (`deno test`).

4. **HTTPie (CLI HTTP Client)**
   - **Descrição:** Cliente HTTP de terminal amigável com destaque de sintaxe nativo.
   - **Uso no projeto:** Testar endpoints e chamadas rápidas via linha de comando.

5. **k6 (Load Testing)**
   - **Descrição:** Ferramenta open-source de testes de carga e desempenho.
   - **Uso no projeto:** Simular acessos concorrentes massivos para garantir a estabilidade em eventos de alto tráfego.

6. **Supabase CLI (Local Environment Manager)**
   - **Descrição:** Interface de linha de comando oficial do Supabase.
   - **Uso no projeto:** Execução do ecossistema local em Docker, geração de tipos TypeScript, linting do banco (`supabase db lint`) e testes pgTAP (`supabase test db`).

---

## 🚀 Script de Verificação Automatizada

Para simplificar e unificar a validação do projeto, o script portátil `Verificar_Completo.ps1` executa um diagnóstico completo:

1. **Diagnóstico de Ambiente:** Verifica se as ferramentas básicas necessárias (`Node.js`, `Deno`, `Supabase CLI`, `Docker`) estão disponíveis.
2. **ESLint (Frontend):** Roda a verificação de regras e boas práticas do React/TypeScript.
3. **TypeScript Typecheck:** Valida a consistência de tipos estáticos do frontend.
4. **Deno Lint (Edge Functions):** Valida boas práticas de sintaxe e código Deno no diretório `supabase/functions/`.
5. **Deno Test:** Roda a suite de testes unitários do Deno (ex: testes de cálculo de frete e regras de negócio).
6. **Verificação de Banco de Dados (Postgres):** Se o Docker Desktop estiver ativo, inicializa as verificações locais de integridade de esquema (`supabase db lint`) e testes SQL pgTAP (`supabase test db`).
7. **Relatório de Saída:** Produz o arquivo `relatorio_verificacao.md` detalhando cada etapa executada e eventuais falhas detectadas.

### Como Executar

- **Windows Explorer:** Dê um duplo clique no arquivo `Executar_Verificacao_Completa.bat`.
- **PowerShell Terminal:** Execute o seguinte comando a partir da pasta raiz do projeto:

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\supabase\setup\Verificar_Completo.ps1
  ```

---

## 📁 Estrutura de Pastas

```text
supabase/setup/
├── projetos/
│   └── ikcous.md                        # Documentação e relatório da verificação do app IKCOUS
├── README.md                            # Este manual de setup e ferramentas
├── Verificar_Completo.ps1               # Script de verificação unificado portátil
├── Executar_Verificacao_Completa.bat    # Executável em lote para Windows
└── relatorio_verificacao.md             # Último relatório gerado pela execução do script
```
