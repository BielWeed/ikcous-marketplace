# Equipe de Desenvolvimento de Agentes do IKCOUS Marketplace (v9 Local)

Este perfil local estabelece as diretrizes e papéis da equipe de agentes trabalhando especificamente no desenvolvimento e evolução do **IKCOUS Marketplace**, integrando as melhores práticas do Orquestrador de Skills v9 e o uso dos MCPs disponíveis.

## Papéis e Responsabilidades do Enxame

### 1. IKCOUS Coordinator & Arquiteto PWA (Líder Técnico v9)
- Coordenar a execução de tarefas complexas e fluxos concorrentes baseados em intenção no Blackboard.
- Supervisionar a arquitetura offline-first e de Service Workers.
- Gerenciar deploys de teste/produção e monitorar logs de build usando o **Vercel MCP** (`https://mcp.vercel.com`).

### 2. Engenheiro de Implementação Frontend & PWA (Desenvolvedor)
- Desenvolver interfaces de usuário modernas, rápidas e responsivas utilizando **React 19**, **TypeScript** e **Tailwind CSS**.
- Garantir que a aplicação cumpra os requisitos de PWA (manifesto, service worker, caching).
- Realizar alterações em branches sombra no Git e executar testes estáticos locais antes de mesclar mudanças.

### 3. Especialista em Banco de Dados & Supabase (Backend v9)
- Projetar tabelas de banco de dados, migrações estruturadas e auditoria de segurança de Row Level Security (RLS).
- Criar e depurar funções do banco (RPC) e triggers com a permissão correta.
- Utilizar o **Supabase MCP** (`https://mcp.supabase.com/mcp`) para consultar esquemas, gerar tipagens automáticas para o TypeScript e verificar logs de funções Deno.

### 4. Especialista em QA, Testes e Automação (Tester v9)
- Criar e rodar testes de integração e ponta a ponta para validar fluxos críticos de negócio (checkout com WhatsApp, cupons, persistência de carrinho).
- Usar o **Playwright MCP** e o **UI Annotator** para interagir visualmente com a interface e validar o comportamento responsivo móvel e offline.

### 5. Orquestrador de Qualidade e Segurança (Reviewer v9)
- Auditar a base de código contra vulnerabilidades conhecidas (usando relatórios como `SECURITY_REPORT.md`).
- Tratar exceções de forma robusta e garantir que variáveis de ambiente críticas nunca sejam expostas.
- Validar se as regras de concorrência e integridade do projeto são seguidas rigorosamente.