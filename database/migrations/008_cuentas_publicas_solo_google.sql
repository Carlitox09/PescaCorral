-- ============================================================================
--  PescaCorral · Migración 008 · Cuentas del público sólo con Google
--  Idempotente.
--
--  Antes del ingreso con Google, el público se registraba con correo y
--  contraseña. Las cuentas de pescadores o dueños de esa época que después
--  ingresaron con Google conservan la contraseña y la identidad de correo
--  heredadas. Se quitan, para que esas cuentas ingresen sólo con Google y
--  PescaCorral no guarde contraseñas del público. Las cuentas del personal
--  (municipio y administración) no se tocan.
-- ============================================================================

delete from auth.identities i
using public.usuario p
where i.user_id = p.id
  and i.provider = 'email'
  and p.rol in ('pescador', 'dueno')
  and exists (select 1 from auth.identities g where g.user_id = p.id and g.provider = 'google');

update auth.users u
set encrypted_password = '',
    raw_app_meta_data  = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                         || jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google'))
from public.usuario p
where p.id = u.id
  and p.rol in ('pescador', 'dueno')
  and exists (select 1 from auth.identities g where g.user_id = u.id and g.provider = 'google')
  and (coalesce(u.encrypted_password, '') <> '' or u.raw_app_meta_data ->> 'provider' = 'email');

-- Resultado: cuentas del público y cómo ingresan.
select p.email, p.rol,
       (select string_agg(i.provider, ', ' order by i.provider) from auth.identities i where i.user_id = p.id) as ingresa_con,
       coalesce(u.encrypted_password, '') <> '' as tiene_contrasena
from public.usuario p
join auth.users u on u.id = p.id
order by p.rol, p.email;
