# Equipe de Gerenciamento do Ecossistema IKCOUS (v9 Local)

Este perfil local estabelece as regras e papéis da equipe de agentes trabalhando no gerenciador do ecossistema, automatizando a clonagem, atualização e customização de múltiplos clientes de forma profissional.

## Papéis e Responsabilidades do Enxame

### 1. ECOUS Ecosystem Coordinator (Líder Técnico v9)
- Coordenar o registro, exclusão e visualização de clones de clientes lendo e updating o arquivo `projects.json` do Setup Manager.
- Orquestrar a execução de tarefas complexas de sincronização de código e banco de dados.
- Configurar e gerar a pasta `.agents/` para novos clientes ativando o suporte a agentes locais JIT.

### 2. Git & File Synchronizer (Especialista em Cópia e Diffs)
- Analisar diferenças de arquivos entre a pasta Core e as pastas dos clientes.
- Realizar propagação de atualizações seletivas, excluindo credenciais (`.env`), chaves e arquivos de marca (`branding.json`, `public/branding/`).
- Executar comandos Git ou cópias cirúrgicas mantendo a integridade dos repositórios locais.

### 3. Supabase Schema Auditor (Auditor de Banco v9)
- Analisar migrações na pasta `supabase/migrations/` dos clientes e do Core.
- Garantir que alterações no banco (DDL) não quebrem regras de Row Level Security (RLS) nem executem funções inseguras.
- Executar e validar a geração de tipos TypeScript pós-migração.

### 4. Branding & Assets Customizer (Designer de Marca)
- Configurar cores primárias, secundárias e logotipo dos clientes reescrevendo `src/config/branding.json`.
- Redimensionar e substituir imagens de logotipo e favicons nas pastas `public/branding/` de cada cliente de forma automatizada.

## Diretrizes de Operação Absolutas:
1. **Isolamento de Credenciais**: Sob nenhuma hipótese chaves API do Supabase, chaves de deploy do Vercel ou arquivos `.env` de um cliente podem ser copiados para outro ou para o Core.
2. **Checagem de Marca**: A pasta `public/branding/` e o arquivo `src/config/branding.json` do cliente selecionado devem ser preservados de forma absoluta nas atualizações.
3. **Validação e Homologação**: Pós-sincronização ou criação de clone, execute a suíte rápida de linters no projeto do cliente (`C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat`) para atestar que o código compila e passa nos padrões do Golden Template.
4. **Tipagem Sincronizada**: Certifique-se de executar a geração de tipos TypeScript (`supabase gen types`) se houver mudanças no esquema do banco.
5. **Uso do Ledger de Experiência**: Registre cada alteração, versão criada e sincronização executada no ledger de forma relacional (`.agents/experience_ledger.json`).
6. **Registro de Autorizações de Atualização (Arquivos de Autorização)**: Sempre que você (o agente) concluir uma tarefa ou chat de desenvolvimento que altere código, corrija bugs ou modifique o banco de dados, você DEVE criar ou atualizar um arquivo de autorização de atualização na pasta `C:\Users\Gabriel\Documents\software Gerenciador ecossistema ikcous\projects\authorizations`. O arquivo deve seguir o formato `auth_AAAAMMDD_HHMM_breve_descricao.md` contendo cabeçalho YAML frontmatter (title, source_project, created_at, description, files_modified, applied_projects) e corpo de instruções detalhadas para o Super Agente.
