-- 8b — ANTES da 20261197000000 (O DINHEIRO EXIGE O ADMIN DE AGORA): quantos
-- usuários têm papéis CONTRADITÓRIOS entre as duas fontes que `is_admin_atual()`
-- passa a exigir juntas — `auth.users.raw_app_meta_data ->> 'role'` e
-- `public.profiles.role`. É a consulta do cabeçalho da 197, só que devolvendo
-- CONTAGEM agregada: nenhum id, e-mail ou nome sai daqui.
-- SÓ LEITURA, um único SELECT.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro).
--   * "so no app_metadata" — admin para `is_admin()` (JWT) mas NÃO no profiles:
--     depois da 197 PERDE acesso a dinheiro. Esperado 0; cada um é decisão do
--     dono (qual das duas fontes está certa) ANTES de aplicar.
--   * "so no profiles" — o inverso; também deixa de passar.
--   * os controles de visibilidade existem porque um papel sem acesso ao schema
--     `auth` (ou com RLS escondendo tudo) devolveria 0 contraditórios sem ter
--     olhado nada: `usuarios visiveis` e `admins pelas duas fontes` têm de ser
--     > 0 para o "0" das outras linhas valer.
WITH j AS (
  SELECT COALESCE((u.raw_app_meta_data ->> 'role') = 'admin', false) AS admin_meta,
         COALESCE(p.role = 'admin', false) AS admin_perfil
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
), r(item, esperado, vivo) AS (
  SELECT 'controle: usuarios visiveis em auth.users', '>0',
         CASE WHEN count(*) > 0 THEN '>0' ELSE '0' END
    FROM j
  UNION ALL
  SELECT 'controle: perfis visiveis em public.profiles', '>0',
         CASE WHEN (SELECT count(*) FROM public.profiles) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'controle: admins pelas duas fontes', '>0',
         CASE WHEN count(*) FILTER (WHERE admin_meta AND admin_perfil) > 0 THEN '>0' ELSE '0' END
    FROM j
  UNION ALL
  SELECT 'admin so no app_metadata (profiles nao admin)', '0',
         (count(*) FILTER (WHERE admin_meta AND NOT admin_perfil))::text
    FROM j
  UNION ALL
  SELECT 'admin so no profiles (app_metadata nao admin)', '0',
         (count(*) FILTER (WHERE admin_perfil AND NOT admin_meta))::text
    FROM j
  UNION ALL
  SELECT 'papeis contraditorios (soma)', '0',
         (count(*) FILTER (WHERE admin_meta IS DISTINCT FROM admin_perfil))::text
    FROM j
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;
