# Equipe de Desenvolvimento de Agentes do IKCOUS Marketplace (v12 Local)

Este perfil local estabelece as diretrizes e papéis da equipe de agentes trabalhando especificamente no desenvolvimento e evolução do **IKCOUS Marketplace**, integrando as melhores práticas do Orquestrador de Skills v12 e o uso dos MCPs disponíveis.

## Papéis e Responsabilidades do Enxame

### 1. IKCOUS Coordinator & Arquiteto PWA (Líder Técnico v12)
- Coordenar a execução de tarefas complexas e fluxos concorrentes baseados em intenção no Blackboard.
- Supervisionar a arquitetura offline-first e de Service Workers.
- Gerenciar deploys de teste/produção e monitorar logs de build usando o **Vercel MCP** (`https://mcp.vercel.com`).

### 2. Engenheiro de Implementação Frontend & PWA (Desenvolvedor)
- Desenvolver interfaces de usuário modernas, rápidas e responsivas utilizando **React 19**, **TypeScript** e **Tailwind CSS**.
- Garantir que a aplicação cumpra os requisitos de PWA (manifesto, service worker, caching).
- Realizar alterações em branches sombra no Git e executar testes estáticos locais antes de mesclar mudanças.

### 3. Especialista em Banco de Dados & Supabase (Backend v12)
- Projetar tabelas de banco de dados, migrações estruturadas e auditoria de segurança de Row Level Security (RLS).
- Criar e depurar funções do banco (RPC) e triggers com a permissão correta.
- Utilizar o **Supabase MCP** (`https://mcp.supabase.com/mcp`) para consultar esquemas, gerar tipagens automáticas para o TypeScript e verificar logs de funções Deno.

### 4. Especialista em QA, Testes e Automação (Tester v12)
- Criar e rodar testes de integração e ponta a ponta para validar fluxos críticos de negócio (checkout com WhatsApp, cupons, persistência de carrinho).
- Usar o **Playwright MCP** e o **UI Annotator** para interagir visualmente com a interface e validar o comportamento responsivo móvel e offline.

### 5. Orquestrador de Qualidade e Segurança (Reviewer v12)
- Rodar e validar os testes e linters locais chamando o Modo Rápido da suíte de qualidade antes de aprovar a promoção de código.
- Auditar a base de código contra vulnerabilidades conhecidas (usando relatórios como `SECURITY_REPORT.md`).
- Tratar exceções de forma robusta e garantir que variáveis de ambiente críticas nunca sejam expostas.
- Validar se as regras de concorrência e integridade do projeto são seguidas rigorosamente.

### 9. Sniper Context & JIT Skill Orchestration (Orquestração em Tempo Real)
- Sempre que for iniciar uma tarefa ou se deparar com um problema específico (ex: acessibilidade, performance, banco de dados, deploy, etc.), você DEVE chamar a ferramenta `auto_orchestrate_skills` do orquestrador passando uma busca/intento (ex: 'PWA performance check' ou 'Supabase RLS policy').
- O orquestrador irá buscar na biblioteca de 2000+ skills, validar a qualidade/segurança da skill em tempo real (score >= 70) e instalá-la como uma skill JIT no diretório `.agents/skills/` local do projeto.
- Isso garante que você sempre tenha as diretrizes mais precisas, seguras e atualizadas (o 'sniper context') sem poluir o seu contexto com centenas de diretrizes irrelevantes.
- Declare obrigatoriamente as skills utilizadas no final da sua resposta.


# Diretrizes de Desenvolvimento e Operação - IKCOUS Marketplace (v12 Local)

Estas diretrizes complementam as regras do projeto e regulam o uso seguro das ferramentas de MCP e frameworks no workspace local do **IKCOUS Marketplace**.

---

## 1. Princípios do Produto (PWA & UX)

- **Mobile First & PWA**: A interface deve ser impecavelmente fluida em smartphones. Toda funcionalidade de checkout, carrinho e busca deve rodar offline ou com conexões instáveis (Offline-first por meio de Service Workers).
- **Aesthetics & Performance**: Usar fontes limpas (Inter, Outfit), animações de micro-interação suaves, Tailwind CSS e garantir que o carregamento inicial da página (Core Web Vitals) seja extremamente rápido.

---

## 2. Uso Seguro do Supabase MCP

O banco de dados do Supabase é a espinha dorsal de dados do marketplace. Siga estas restrições estritas:
- **Segurança de RLS (Row Level Security)**: Toda tabela de dados do usuário (como perfis, pedidos e avaliações) deve ter RLS ativado por padrão.
- **Funções SECURITY DEFINER**: Qualquer função SQL executada com privilégios elevados deve ter a cláusula `search_path = public` explícita para evitar ataques de busca de caminho. Apenas crie funções RPC se forem estritamente necessárias e auditadas.
- **Ambiente Dev-Only**: O **Supabase MCP** não deve fazer modificações destrutivas ou migrações de dados em produção sem validação de rollback em sandbox/local.
- **Tipagem Estática**: Sempre que alterar o banco de dados local ou remoto, execute a geração automática de tipos do TypeScript via Supabase MCP para manter a integridade estática no código frontend.

---

## 3. Gestão de Deploy e Logs (Vercel MCP)

- **Auditoria de Builds**: Após cada deploy automatizado ou solicitação de preview, use o **Vercel MCP** para inspecionar os logs de build. Corrija avisos de compilação, pacotes duplicados e erros de geração de páginas estáticas.
- **Depuração de Erros em Produção**: Se houver relatos de falhas de usuários finais, consulte os logs de servidor e Edge Functions via Vercel MCP para identificar rotas de API quebradas ou problemas de latência.

---

## 4. Testes e Estabilidade (QA & Sandbox)

- **Especulação Paralela**: Mudanças estruturais na lógica de estado global (como Contexts de Autenticação e Carrinho) devem ser testadas em isolamento no diretório `/scratch` antes de serem promovidas ao código do projeto.
- **Fluxos de Testes Automatizados**: Fluxos críticos (carrinho de compras, aplicação de cupons de desconto, checkout no WhatsApp e sistema de Q&A) devem ser validados usando testes do **Playwright MCP** para múltiplos cenários de rede.

---

## 5. Orquestração e Uso Mandatório de Skills (Habilidades v12)

- **Priorizar Habilidades (Skills)**: Habilidades (Skills) são a principal ferramenta de capacitação e robustez do enxame de agentes. Sempre carregue e siga as diretrizes das skills JIT ativas (`antigravity-skill-orchestrator-v12`, `skill-installer-v12` e `skill-evaluator-v12`). Você deve carregar e usar skills proativamente para guiar praticamente todas as tarefas complexas de refatoração, teste, banco de dados ou integração.
- **Uso e Abuso de Habilidades**: Considere o uso de skills obrigatório para fortalecer as capacidades do agente. Sempre use e abuse das diretrizes de skills para validar suas execuções sob sandbox, garantir cobertura de testes com Playwright e gerenciar transações atômicas no Git shadow branches. Evite edições ad-hoc sem o amparo de diretrizes e validações formais descritas nas skills.

---

---

## 6. Homologação com Suíte de Qualidade (Compliance & Autonomia)

- **Validação Mandatória:** Qualquer alteração de código ou banco de dados deve ser validada por testes antes da conclusão da tarefa. O agente tem autonomia para escolher o nível de teste apropriado:
  - **Modo Rápido (Geral):** Execute `C:\\Users\\Gabriel\\Documents\\Ferramentas para projetos\\Executar_Todas_Suites_Modo_Rapido.bat` para um diagnóstico ágil de linters (Biome, ESLint, etc.) e tipagem antes de pequenas entregas.
  - **Modo Completo (Geral):** Execute `C:\\Users\\Gabriel\\Documents\\Ferramentas para projetos\\Executar_Todas_Suites_Modo_Completo.bat` para homologação profunda de builds, testes unitários, testes Deno/pgTAP e DAST antes de deploys, PRs ou refatorações de grande escala.
  - **Execução Focalizada (Filtro por Componente):** Para otimizar tempo, o agente tem autonomia para executar diretamente scripts individuais específicos dentro das subpastas das 6 categorias de qualidade em `C:\\Users\\Gabriel\\Documents\\Ferramentas para projetos\\` (ex: rodar apenas `01_ESLint_Backend.bat` para código de funções, `06_Supabase_pgTAP.bat` se alterar RLS/banco de dados, ou `01_Playwright_E2E_UI.bat` para fluxos visuais do frontend).
- **Tratamento de Resultados:** O agente deve ler as saídas do terminal ou logs consolidados e se auto-corrigir caso alguma validação falhe.
- **Declaração Obrigatória de Skills da Biblioteca (+6.700 Skills JIT):** No final de cada resposta/execução, o agente DEVE incluir obrigatoriamente uma seção denominada `### Skills Utilizadas nesta Execução` listando especificamente os nomes das **skills especializadas da biblioteca carregadas/instaladas (pastas `jit-*` do diretório `.agents/skills`)**, e NÃO as meta-skills locais de infraestrutura.

### 9. Protocolo Obrigatório de Uso Intensivo e Proativo dos Servidores MCP e Skills JIT (14 MCPs Ativos)
O agente DEVE utilizar obrigatoriamente e de forma proativa as ferramentas dos 14 servidores MCP configurados no ecossistema e a biblioteca de +6.700 skills JIT. Em NENHUMA hipótese o agente deve limitar-se a programar sem consultar as ferramentas disponíveis. Abaixo está a matriz de gatilhos operacionais mandatória:

1. **`orchestrator` MCP (`search_library_skills`, `auto_orchestrate_skills`, `validate_skill`, `call_server_tool`)**:
   - **Gatilho**: Em toda e qualquer tarefa complexa, busque e orquestre skills JIT da biblioteca global de +6.700 skills. Sempre utilize `validate_skill` antes de promover a execução.

2. **`grep` MCP (`https://mcp.grep.app`)**:
   - **Gatilho**: Sempre que for criar componentes, lógicas de backend, hooks React ou resolver bugs, consulte padrões reais de referência no GitHub via `grep` MCP para extrair a arquitetura ideal.

3. **`supabase` MCP (`https://mcp.supabase.com/mcp`)**:
   - **Gatilho**: Sempre que alterar esquemas de banco, tabelas, políticas de RLS, RPCs ou tipos no frontend, consulte o esquema no Supabase MCP e execute a geração estática de tipos TypeScript.

4. **`shadcn` MCP (`shadcn`)**:
   - **Gatilho**: Ao criar ou refatorar componentes de interface de usuário (UI), consulte modelos e primitivas do `shadcn` para garantir visual moderno, acessibilidade e padrões limpos de Tailwind CSS.

5. **`context7` MCP (`@upstash/context7-mcp`)**:
   - **Gatilho**: Sempre que utilizar bibliotecas externas ou frameworks (React 19, Vite, Supabase, Tailwind, Zustand, Zod), consulte o `context7` para obter os trechos de documentação técnica mais recentes.

6. **`magic` MCP (`@21st-dev/magic`)**:
   - **Gatilho**: Utilize para gerar blocos de UI modernos, micro-interações dinâmicas e design systems visuais de ponta.

7. **`weweb-ai` MCP (`https://ai-api.weweb.io/v1/mcp`)**:
   - **Gatilho**: Consulte para estruturar e validar diagramas de fluxo de lógica de negócios, integrações e workflows.

8. **`github` MCP (`@modelcontextprotocol/server-github`)**:
   - **Gatilho**: Consulte para inspecionar repositórios de referência, histórico de versões, commits e issues em projetos abertos.

9. **`upstash` MCP (`@upstash/mcp-server`)**:
   - **Gatilho**: Utilize ao projetar camadas de cache Redis, rate-limiting ou bancos vetoriais serverless.

10. **`linear` MCP (`https://mcp.linear.app/mcp`)**:
    - **Gatilho**: Consulte para sincronizar requisitos, ler especificações de tarefas e gerenciar o backlog do projeto.

11. **`firecrawl` MCP (`firecrawl-mcp`)**:
    - **Gatilho**: Sempre que precisar raspagem técnica, conversão de documentações web para Markdown ou extração de endpoints públicos.

12. **`figma` MCP (`figma-developer-mcp`)**:
    - **Gatilho**: Consulte para extrair especificações de design, paletas de cores, tipografia e medidas de layout.

13. **`semgrep` & `ast-grep` MCP (`mcp-server-semgrep`, `@cabbages/tree-grep`)**:
    - **Gatilho**: Execute para análise estática AST, refatoração estrutural de código e varredura de vulnerabilidades de segurança antes de concluir entregas.

14. **`qdrant` MCP (`mcp-server-qdrant`)**:
    - **Gatilho**: Utilize para persistência e consulta semântica em base vetorial de conhecimento local.

15. **Protocolo Obrigatório de Pesquisa Prévia & Investigação Ativa**:
    - **Gatilho**: Antes de realizar qualquer alteração, refatoração ou implementação de código, a IA DEVE realizar pesquisas prévias na Web (`search_web`), documentação atualizada (`context7`), padrões no GitHub (`grep`) e skills especializadas (`orchestrator`). O objetivo é mapear novidades, boas práticas, casos de borda e pontos de atenção antes de escrever a primeira linha de código.

# Diretrizes de Desenvolvimento e Operação - IKCOUS Marketplace (v12 Local)

Estas diretrizes complementam as regras do projeto e regulam o uso seguro das ferramentas de MCP e frameworks no workspace local do **IKCOUS Marketplace**.

---

## 1. Princípios do Produto (PWA & UX)

- **Mobile First & PWA**: A interface deve ser impecavelmente fluida em smartphones. Toda funcionalidade de checkout, carrinho e busca deve rodar offline ou com conexões instáveis (Offline-first por meio de Service Workers).
- **Aesthetics & Performance**: Usar fontes limpas (Inter, Outfit), animações de micro-interação suaves, Tailwind CSS e garantir que o carregamento inicial da página (Core Web Vitals) seja extremamente rápido.

---

## 2. Uso Seguro do Supabase MCP

O banco de dados do Supabase é a espinha dorsal de dados do marketplace. Siga estas restrições estritas:
- **Segurança de RLS (Row Level Security)**: Toda tabela de dados do usuário (como perfis, pedidos e avaliações) deve ter RLS ativado por padrão.
- **Funções SECURITY DEFINER**: Qualquer função SQL executada com privilégios elevados deve ter a cláusula `search_path = public` explícita para evitar ataques de busca de caminho. Apenas crie funções RPC se forem estritamente necessárias e auditadas.
- **Ambiente Dev-Only**: O **Supabase MCP** não deve fazer modificações destrutivas ou migrações de dados em produção sem validação de rollback em sandbox/local.
- **Tipagem Estática**: Sempre que alterar o banco de dados local ou remoto, execute a geração automática de tipos do TypeScript via Supabase MCP para manter a integridade estática no código frontend.

---

## 3. Gestão de Deploy e Logs (Vercel MCP)

- **Auditoria de Builds**: Após cada deploy automatizado ou solicitação de preview, use o **Vercel MCP** para inspecionar os logs de build. Corrija avisos de compilação, pacotes duplicados e erros de geração de páginas estáticas.
- **Depuração de Erros em Produção**: Se houver relatos de falhas de usuários finais, consulte os logs de servidor e Edge Functions via Vercel MCP para identificar rotas de API quebradas ou problemas de latência.

---

## 4. Testes e Estabilidade (QA & Sandbox)

- **Especulação Paralela**: Mudanças estruturais na lógica de estado global (como Contexts de Autenticação e Carrinho) devem ser testadas em isolamento no diretório `/scratch` antes de serem promovidas ao código do projeto.
- **Fluxos de Testes Automatizados**: Fluxos críticos (carrinho de compras, aplicação de cupons de desconto, checkout no WhatsApp e sistema de Q&A) devem ser validados usando testes do **Playwright MCP** para múltiplos cenários de rede.

---

## 5. Orquestração e Uso Mandatório de Skills (Habilidades v12)

- **Priorizar Habilidades (Skills)**: Habilidades (Skills) são a principal ferramenta de capacitação e robustez do enxame de agentes. Sempre carregue e siga as diretrizes das skills JIT ativas (`antigravity-skill-orchestrator-v12`, `skill-installer-v12` e `skill-evaluator-v12`). Você deve carregar e usar skills proativamente para guiar praticamente todas as tarefas complexas de refatoração, teste, banco de dados ou integração.
- **Uso e Abuso de Habilidades**: Considere o uso de skills obrigatório para fortalecer as capacidades do agente. Sempre use e abuse das diretrizes de skills para validar suas execuções sob sandbox, garantir cobertura de testes com Playwright e gerenciar transações atômicas no Git shadow branches. Evite edições ad-hoc sem o amparo de diretrizes e validações formais descritas nas skills.

---

---

## 6. Homologação com Suíte de Qualidade (Compliance & Autonomia)

- **Validação Mandatória:** Qualquer alteração de código ou banco de dados deve ser validada por testes antes da conclusão da tarefa. O agente tem autonomia para escolher o nível de teste apropriado:
  - **Modo Rápido (Geral):** Execute `C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat` para um diagnóstico ágil de linters (Biome, ESLint, etc.) e tipagem antes de pequenas entregas.
  - **Modo Completo (Geral):** Execute `C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Completo.bat` para homologação profunda de builds, testes unitários, testes Deno/pgTAP e DAST antes de deploys, PRs ou refatorações de grande escala.
  - **Execução Focalizada (Filtro por Componente):** Para otimizar tempo, o agente tem autonomia para executar diretamente scripts individuais específicos dentro das subpastas das 6 categorias de qualidade em `C:\Users\Gabriel\Documents\Ferramentas para projetos\` (ex: rodar apenas `01_ESLint_Backend.bat` para código de funções, `06_Supabase_pgTAP.bat` se alterar RLS/banco de dados, ou `01_Playwright_E2E_UI.bat` para fluxos visuais do frontend).
- **Tratamento de Resultados:** O agente deve ler as saídas do terminal ou logs consolidados e se auto-corrigir caso alguma validação falhe.
- **Declaração Obrigatória de Skills da Biblioteca (+6.700 Skills JIT):** No final de cada resposta/execução, o agente DEVE incluir obrigatoriamente uma seção denominada `### Skills Utilizadas nesta Execução` listando especificamente os nomes das **skills especializadas da biblioteca carregadas/instaladas (pastas `jit-*` do diretório `.agents/skills`)**, e NÃO as meta-skills locais de infraestrutura.

---

## 7. Protocolo Obrigatório de Pesquisa Prévia & Investigação Ativa

- **Pesquisa Antes de Codificar**: Antes de iniciar qualquer codificação ou refatoração, a IA DEVE consultar ativamente a web (`search_web`), documentações oficiais de bibliotecas (`context7`), padrões de referência no GitHub (`grep`) e orquestração de skills (`orchestrator`).
- **Mapeamento de Casos de Borda**: Identificar novidades técnicas, boas práticas, armadilhas comuns e pontos de atenção antes de implementar qualquer solução.