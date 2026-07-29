# Diretrizes de Desenvolvimento e Operação - IKCOUS Marketplace (v9 Local)

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

## 5. Orquestração e Uso Mandatório de Skills (Habilidades v9)

- **Priorizar Habilidades (Skills)**: Habilidades (Skills) são a principal ferramenta de capacitação e robustez do enxame de agentes. Sempre carregue e siga as diretrizes das skills JIT ativas (`antigravity-skill-orchestrator-v9`, `skill-installer-v9` e `skill-evaluator-v9`). Você deve carregar e usar skills proativamente para guiar praticamente todas as tarefas complexas de refatoração, teste, banco de dados ou integração.
- **Uso e Abuso de Habilidades**: Considere o uso de skills obrigatório para fortalecer as capacidades do agente. Sempre use e abuse das diretrizes de skills para validar suas execuções sob sandbox, garantir cobertura de testes com Playwright e gerenciar transações atômicas no Git shadow branches. Evite edições ad-hoc sem o amparo de diretrizes e validações formais descritas nas skills.

---

---

## 6. Homologação com Suíte de Qualidade (Compliance & Autonomia)

- **Validação Mandatória:** Qualquer alteração de código ou banco de dados deve ser validada por testes antes da conclusão da tarefa. O agente tem autonomia para escolher o nível de teste apropriado:
  - **Modo Rápido (Geral):** Execute `C:\\Users\\Gabriel\\Documents\\Ferramentas para projetos\\Executar_Todas_Suites_Modo_Rapido.bat` para um diagnóstico ágil de linters (Biome, ESLint, etc.) e tipagem antes de pequenas entregas.
  - **Modo Completo (Geral):** Execute `C:\\Users\\Gabriel\\Documents\\Ferramentas para projetos\\Executar_Todas_Suites_Modo_Completo.bat` para homologação profunda de builds, testes unitários, testes Deno/pgTAP e DAST antes de deploys, PRs ou refatorações de grande escala.
  - **Execução Focalizada (Filtro por Componente):** Para otimizar tempo, o agente tem autonomia para executar diretamente scripts individuais específicos dentro das subpastas das 6 categorias de qualidade em `C:\\Users\\Gabriel\\Documents\\Ferramentas para projetos\\` (ex: rodar apenas `01_ESLint_Backend.bat` para código de funções, `06_Supabase_pgTAP.bat` se alterar RLS/banco de dados, ou `01_Playwright_E2E_UI.bat` para fluxos visuais do frontend).
- **Tratamento de Resultados:** O agente deve ler as saídas do terminal ou logs consolidados e se auto-corrigir caso alguma validação falhe.
- **Declaração Obrigatória de Skills:** O agente deve, obrigatoriamente, incluir no final de cada resposta/execução uma seção denominada `### Skills Utilizadas nesta Execução` listando de forma legível os nomes de todas as skills (arquivos `.md` do diretório `.agents/skills`) que foram carregadas e aplicadas para guiar aquela tarefa.