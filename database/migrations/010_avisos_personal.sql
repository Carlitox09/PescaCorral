-- ============================================================================
--  PescaCorral · Migración 010 · Avisos de la administración y alta del personal
--  Idempotente.
--   1. Avisos: la administración (municipio y administrador del sistema)
--      publica un aviso que llega como notificación a la campanita de los
--      usuarios elegidos (todos, pescadores, dueños o una persona). Cada
--      publicación queda registrada en la tabla aviso.
--   2. Personal: el administrador del sistema da de alta cuentas del personal
--      (municipio o administración) con usuario y contraseña, les cambia la
--      contraseña y las activa o desactiva, desde la aplicación. El rol de una
--      cuenta del personal se fija al crearla.
-- ============================================================================

-- ---- 1. Avisos ----------------------------------------------------------------
create table if not exists public.aviso (
    id              uuid primary key default gen_random_uuid(),
    titulo          text not null check (char_length(titulo) between 3 and 80),
    mensaje         text not null check (char_length(mensaje) between 3 and 500),
    destino         text not null check (destino in ('todos','pescador','dueno','usuario')),
    id_destinatario uuid references public.usuario (id) on delete set null,
    destinatarios   integer not null default 0,
    publicado_por   uuid references public.usuario (id) on delete set null,
    created_at      timestamptz not null default now()
);
alter table public.aviso enable row level security;
drop policy if exists aviso_select on public.aviso;
create policy aviso_select on public.aviso for select using (public.es_admin());
revoke all on public.aviso from anon, authenticated;
grant select on public.aviso to authenticated;

alter table public.notificacion drop constraint if exists notificacion_tipo_check;
alter table public.notificacion add constraint notificacion_tipo_check
    check (tipo in ('reserva','recordatorio','permiso','pago','sistema','aviso'));

create or replace function public.publicar_aviso(
    p_titulo     text,
    p_mensaje    text,
    p_destino    text default 'todos',
    p_id_usuario uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := public.exigir_cuenta_activa();
    v_titulo  text := trim(coalesce(p_titulo, ''));
    v_mensaje text := trim(coalesce(p_mensaje, ''));
    v_aviso   uuid;
    v_n       integer;
begin
    if not public.es_admin() then
        raise exception 'Solo la administración puede publicar avisos';
    end if;
    if char_length(v_titulo) not between 3 and 80 then
        raise exception 'El título debe tener entre 3 y 80 caracteres';
    end if;
    if char_length(v_mensaje) not between 3 and 500 then
        raise exception 'El mensaje debe tener entre 3 y 500 caracteres';
    end if;
    if coalesce(p_destino, '') not in ('todos', 'pescador', 'dueno', 'usuario') then
        raise exception 'Destinatarios inválidos';
    end if;
    if p_destino = 'usuario' and not exists (
        select 1 from public.usuario where id = p_id_usuario and rol in ('pescador', 'dueno') and activo) then
        raise exception 'Elegí una cuenta activa del público';
    end if;

    insert into public.aviso (titulo, mensaje, destino, id_destinatario, publicado_por)
    values (v_titulo, v_mensaje, p_destino, case when p_destino = 'usuario' then p_id_usuario end, v_uid)
    returning id into v_aviso;

    insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
    select u.id, 'aviso', v_titulo, v_mensaje
    from public.usuario u
    where u.activo
      and u.rol in ('pescador', 'dueno')
      and case p_destino
              when 'todos'   then true
              when 'usuario' then u.id = p_id_usuario
              else u.rol = p_destino
          end;
    get diagnostics v_n = row_count;

    update public.aviso set destinatarios = v_n where id = v_aviso;
    return jsonb_build_object('id', v_aviso, 'destinatarios', v_n);
end;
$$;

-- ---- 2. Cuentas del personal ----------------------------------------------------
-- Requisitos de las contraseñas del personal (los mismos que exige Supabase Auth).
create or replace function public.clave_segura(p_clave text)
returns boolean
language sql
immutable
set search_path = public
as $$
    select char_length(coalesce(p_clave, '')) >= 12
       and p_clave ~ '[a-z]' and p_clave ~ '[A-Z]' and p_clave ~ '[0-9]' and p_clave ~ '[^A-Za-z0-9]';
$$;

create or replace function public.crear_cuenta_personal(
    p_usuario  text,
    p_nombre   text,
    p_apellido text,
    p_rol      text,
    p_clave    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_uid     uuid := public.exigir_cuenta_activa();
    v_usuario text := lower(trim(coalesce(p_usuario, '')));
    v_email   text;
    v_id      uuid := gen_random_uuid();
begin
    if public.rol_actual() is distinct from 'admin_sistema' then
        raise exception 'Solo el administrador del sistema puede dar de alta cuentas del personal';
    end if;
    if v_usuario !~ '^[a-z0-9._-]{3,30}$' then
        raise exception 'El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto o guiones';
    end if;
    if coalesce(p_rol, '') not in ('admin_municipal', 'admin_sistema') then
        raise exception 'Rol inválido';
    end if;
    if trim(coalesce(p_nombre, '')) = '' then
        raise exception 'Ingresá el nombre';
    end if;
    if not public.clave_segura(p_clave) then
        raise exception 'La contraseña debe tener al menos 12 caracteres, con minúsculas, mayúsculas, números y símbolos';
    end if;
    -- Mismo dominio reservado que DOMINIO_PERSONAL en config.js.
    v_email := v_usuario || '@pescacorral.example.com';
    if exists (select 1 from auth.users where lower(email) = v_email) then
        raise exception 'Ya existe una cuenta con el usuario %', v_usuario;
    end if;

    -- La autorización la consume handle_new_user al crear la cuenta y define el rol.
    delete from public.personal_autorizado where usuario = v_usuario or lower(email) = v_email;
    insert into public.personal_autorizado (usuario, email, rol, nombre, apellido)
    values (v_usuario, v_email, p_rol, trim(p_nombre), trim(coalesce(p_apellido, '')));

    -- Cuenta de Supabase Auth con la contraseña cifrada (bcrypt) y el correo confirmado.
    -- Los tokens van vacíos (no nulos), como los deja el servicio de autenticación.
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
            crypt(p_clave, gen_salt('bf', 10)), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id,
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());

    return jsonb_build_object('id', v_id, 'usuario', v_usuario, 'email', v_email, 'rol', p_rol);
end;
$$;

create or replace function public.cambiar_clave_personal(p_id uuid, p_clave text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_uid uuid := public.exigir_cuenta_activa();
begin
    if public.rol_actual() is distinct from 'admin_sistema' then
        raise exception 'Solo el administrador del sistema puede cambiar contraseñas del personal';
    end if;
    if not exists (select 1 from public.usuario where id = p_id and rol in ('admin_municipal', 'admin_sistema')) then
        raise exception 'La cuenta no es del personal';
    end if;
    if not public.clave_segura(p_clave) then
        raise exception 'La contraseña debe tener al menos 12 caracteres, con minúsculas, mayúsculas, números y símbolos';
    end if;
    update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf', 10)), updated_at = now()
    where id = p_id;
    -- Las sesiones abiertas de esa cuenta se cierran (salvo la propia).
    if p_id <> v_uid then
        begin
            delete from auth.sessions where user_id = p_id;
        exception when insufficient_privilege then
            raise warning 'No se pudieron cerrar las sesiones';
        end;
    end if;
end;
$$;

-- Perfil: el administrador del sistema activa o desactiva cuentas del personal
-- (el rol de esas cuentas no cambia); el resto de las reglas sigue igual.
create or replace function public.proteger_perfil()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
begin
    -- Sin usuario (SQL Editor, tareas programadas, funciones internas): sin restricción.
    if v_uid is null then
        return new;
    end if;

    if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at then
        raise exception 'No está permitido modificar ese dato del perfil';
    end if;

    -- Cuenta ajena: sólo la administración, y sólo el tipo de cuenta o el estado.
    if old.id <> v_uid then
        if not public.es_admin() then
            raise exception 'No autorizado';
        end if;
        if (new.nombre, new.apellido, new.telefono, new.dni, new.avatar_url, new.perfil_completo)
           is distinct from
           (old.nombre, old.apellido, old.telefono, old.dni, old.avatar_url, old.perfil_completo) then
            raise exception 'La administración sólo puede cambiar el tipo de cuenta y el estado';
        end if;
        if old.rol in ('pescador', 'dueno') then
            if new.rol not in ('pescador', 'dueno') then
                raise exception 'Los roles administrativos se asignan al dar de alta una cuenta del personal';
            end if;
        else
            if new.rol <> old.rol then
                raise exception 'El rol de una cuenta del personal no se modifica';
            end if;
            if new.activo <> old.activo and public.rol_actual() is distinct from 'admin_sistema' then
                raise exception 'Solo el administrador del sistema puede activar o desactivar cuentas del personal';
            end if;
        end if;
        return new;
    end if;

    -- Cuenta propia: no cambia su estado; el tipo de cuenta se elige una sola vez, en el alta.
    if new.activo <> old.activo then
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

-- ---- Permisos de ejecución ------------------------------------------------------
revoke execute on function public.publicar_aviso(text, text, text, uuid),
                           public.clave_segura(text),
                           public.crear_cuenta_personal(text, text, text, text, text),
                           public.cambiar_clave_personal(uuid, text)
    from public, anon, authenticated;
grant execute on function public.publicar_aviso(text, text, text, uuid),
                          public.crear_cuenta_personal(text, text, text, text, text),
                          public.cambiar_clave_personal(uuid, text)
    to authenticated;

select 'Migración 010 aplicada' as resultado;
