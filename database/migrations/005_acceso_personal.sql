-- ============================================================================
--  PescaCorral · Migración 005 · Acceso del personal con usuario y contraseña
--  Para bases creadas con versiones anteriores de schema.sql. Idempotente.
--
--  Pescadores, turistas y dueños siguen ingresando sólo con Google. El personal
--  municipal y el administrador del sistema ingresan por /Municipio y /Admin con
--  usuario y contraseña (Supabase Auth, proveedor Email). No hay registro
--  abierto: toda alta con contraseña debe estar autorizada antes en
--  personal_autorizado; si no, el disparador la rechaza y la cuenta no se crea.
--
--  ALTA DE UNA CUENTA DEL PERSONAL
--    1. insert into public.personal_autorizado (usuario, email, rol, nombre, apellido)
--       values ('municipio', 'municipio@pescacorral.example.com', 'admin_municipal', 'Nombre', 'Apellido');
--    2. Dentro de los 15 minutos: Authentication -> Users -> Add user, con ese
--       correo, la contraseña y "Auto Confirm User" tildado.
-- ============================================================================

-- ---- 1. Autorizaciones de alta del personal ---------------------------------
create table if not exists public.personal_autorizado (
    usuario    text primary key check (usuario ~ '^[a-z0-9._-]{3,30}$'),
    email      text not null unique,
    rol        text not null check (rol in ('admin_municipal','admin_sistema')),
    nombre     text not null,
    apellido   text not null default '',
    expira     timestamptz not null default (now() + interval '15 minutes'),
    usado      boolean not null default false,
    created_at timestamptz not null default now()
);
comment on table public.personal_autorizado is
    'Altas autorizadas de cuentas del personal (usuario y contraseña). Sólo se usa desde el SQL Editor.';

alter table public.personal_autorizado enable row level security;
revoke all on public.personal_autorizado from anon, authenticated;

-- ---- 2. Alta de perfiles: Google libre, contraseña sólo con autorización ----
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
    v_aut      public.personal_autorizado%rowtype;
begin
    -- Cuentas con contraseña: sólo las autorizadas por la administración.
    if coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email' then
        select * into v_aut
        from public.personal_autorizado
        where lower(email) = lower(new.email) and not usado and expira > now()
        for update;
        if not found then
            raise exception 'Alta no autorizada: las cuentas con contraseña las crea la administración';
        end if;
        insert into public.usuario (id, nombre, apellido, email, rol, perfil_completo)
        values (new.id, v_aut.nombre, v_aut.apellido, lower(new.email), v_aut.rol, true)
        on conflict (id) do nothing;
        update public.personal_autorizado set usado = true where usuario = v_aut.usuario;
        return new;
    end if;

    -- Cuentas de Google: el perfil se crea con los datos de Google y se completa en la app.
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
