---
name: "ecous-ecosystem-manager"
description: "Guidelines for multi-tenant codebase cloning, assets override, JSON config updates, and safe SQL DDL verification."
risk: medium
---

### 1. Rotina de Clonagem
- Copie todos os arquivos do Core (`core_app_mkt`) para a pasta de destino do novo cliente.
- Exclua as pastas `.git`, `.vercel`, `node_modules` e os arquivos `.env*`.
- Crie um arquivo `.env` limpo baseado em `.env.example`.
- Inicialize o `.agents/` local copiando as skills básicas do Setup Manager.

### 2. Rotina de Customização de Marca
- Acesse `src/config/branding.json` no cliente alvo.
- Substitua os metadados do aplicativo (nome, contato).
- Substitua a imagem física `public/branding/logo.png` e `public/branding/favicon.ico`.
- Certifique-se de que a paleta de cores hexadecimais corresponda às cores de marca do cliente.

### 3. Rotina de Sincronização Segura
- Realize o diff dos arquivos.
- Exclua `src/config/branding.json` e `public/branding/` da sincronização automática para proteger a marca do cliente.
- Aplique as atualizações de código do Core nas pastas correspondentes dos clientes.

### 4. Auditoria de Migrações Supabase
- Leia os novos arquivos `.sql` na pasta `supabase/migrations/`.
- Verifique a presença de `ENABLE ROW LEVEL SECURITY` em todas as tabelas criadas.
- Verifique a diretiva `search_path = public` em funções `SECURITY DEFINER`.
