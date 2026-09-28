-- ============================================================================
--  PescaCorral · Migración 003 · Ingreso con cuenta de Google
--  ----------------------------------------------------------------------------
--  Ejecutar en Supabase -> SQL Editor, después de la migración 002.
--  Es idempotente (se puede volver a ejecutar).
--  Si se crea la base desde cero, NO hace falta: schema.sql ya incluye todo.
--
--  Cambios:
--    1. Perfil: marca de perfil completo y foto de la cuenta de Google.
--    2. Alta automática del perfil con los datos que entrega Google.
--    3. Protección de los datos sensibles del perfil (rol, correo, estado):
--       un usuario no puede asignarse un rol administrativo desde la API.
--    4. Se retira el bloqueo por intentos fallidos: con el ingreso mediante
--       Google, la aplicación no recibe contraseñas y esa protección la
--       aplica Google sobre la cuenta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columnas de perfil
-- ----------------------------------------------------------------------------
alter table public.usuario add column if not exists perfil_completo boolean not null default false;
alter table public.usuario add column if not exists avatar_url      text;

-- Las cuentas existentes que ya tienen DNI se consideran completas.
update public.usuario
   set perfil_completo = true
 where not perfil_completo
   and coalesce(trim(dni), '') <> '';

-- ----------------------------------------------------------------------------
-- 2. Alta automática del perfil con los datos de la cuenta de Google
--    Google entrega nombre completo, correo y foto; DNI, teléfono y tipo de
--    cuenta los completa el usuario en su primer ingreso.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_completo text  := trim(coalesce(v_meta->>'full_name', v_meta->>'name', ''));
    v_nombre   text;
    v_apellido text;
begin
    v_nombre := coalesce(nullif(trim(v_meta->>'given_name'), ''),
                         nullif(split_part(v_completo, ' ', 1), ''),
                         split_part(new.email, '@', 1));
    v_apellido := coalesce(nullif(trim(v_meta->>'family_name'), ''),
                           nullif(trim(substr(v_completo, length(split_part(v_completo, ' ', 1)) + 2)), ''),
                           '');

    insert into public.usuario (id, nombre, apellido, email, avatar_url, rol, perfil_completo)
    values (new.id, v_nombre, v_apellido, lower(new.email),
            coalesce(v_meta->>'avatar_url', v_meta->>'picture'),
            'pescador', false)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. Protección de los datos sensibles del perfil
--    La política RLS permite que cada usuario edite su propio perfil; este
--    trigger impide que, al hacerlo, cambie su rol, su correo o su estado.
--    El tipo de cuenta (pescador o dueño) sólo se elige una vez, en el alta.
--    Las consultas administrativas (SQL Editor) no tienen restricción.
-- ----------------------------------------------------------------------------
create or replace function public.proteger_perfil()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if auth.uid() is null or public.es_admin() then
        return new;
    end if;

    if new.id <> old.id
       or new.email <> old.email
       or new.activo <> old.activo
       or new.created_at <> old.created_at then
        raise exception 'No está permitido modificar ese dato del perfil';
    end if;

    if new.rol <> old.rol then
        if old.perfil_completo or new.rol not in ('pescador', 'dueno') then
            raise exception 'El tipo de cuenta sólo puede modificarlo la administración municipal';
        end if;
    end if;

    if old.perfil_completo then
        new.perfil_completo := true;           -- el alta no se puede deshacer
    end if;
    return new;
end;
$$;

drop trigger if exists trg_usuario_proteger on public.usuario;
create trigger trg_usuario_proteger
    before update on public.usuario
    for each row execute function public.proteger_perfil();

-- ----------------------------------------------------------------------------
-- 4. Retiro del bloqueo por intentos fallidos (migración 002)
-- ----------------------------------------------------------------------------
do $$
begin
    perform cron.unschedule('pescacorral-limpieza-intentos');
exception when others then
    null;                                      -- pg_cron no instalado o tarea inexistente
end $$;

drop function if exists public.registrar_intento_acceso(text, boolean);
drop function if exists public.acceso_bloqueado(text);
drop table    if exists public.intento_acceso;

-- ============================================================================
--  FIN DE LA MIGRACIÓN 003
-- ============================================================================
