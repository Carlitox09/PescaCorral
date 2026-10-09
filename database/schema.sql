-- ============================================================================
--  PescaCorral · Esquema relacional completo (PostgreSQL / Supabase)
--  Sistema de gestión de reservas de pesca deportiva y permisos municipales
--  Dique Cabra Corral · Municipio de Coronel Moldes (Salta, Argentina)
--
--  Autor del TFG: Carlos Agustín Romero · Universidad Siglo 21
--  Modelo basado en el DER y el Diagrama de Clases del TFG (Figuras 3 y 4).
--
--  CÓMO USARLO EN SUPABASE
--  1. Entrá a tu proyecto en https://supabase.com  ->  SQL Editor.
--  2. Pegá y ejecutá este archivo (schema.sql) COMPLETO.
--  3. Luego ejecutá seed.sql para cargar datos de ejemplo (catamaranes, etc.).
--  4. Pescadores, turistas y dueños ingresan con su cuenta de Google (OAuth 2.0)
--     y la aplicación no recibe sus contraseñas. El personal municipal y el
--     administrador ingresan por /Municipio y /Admin con usuario y contraseña
--     (Supabase Auth, proveedor Email), sólo con altas autorizadas en
--     personal_autorizado. Supabase Auth registra la identidad en auth.users y
--     la tabla "usuario" EXTIENDE ese registro con los datos de perfil y el rol.
--
--  Este script es idempotente: se puede volver a ejecutar sin error.
-- ============================================================================

-- Extensión para gen_random_uuid() (incluida en Supabase).
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. Limpieza previa (permite reejecutar el script desde cero)
-- ----------------------------------------------------------------------------
drop view  if exists public.v_dashboard_resumen      cascade;
drop view  if exists public.v_permisos_por_especie   cascade;
drop view  if exists public.v_ocupacion_catamaran    cascade;
drop view  if exists public.v_reservas_por_dia       cascade;
drop view  if exists public.v_lugares_ocupados       cascade;

drop table if exists public.intento_acceso cascade;
drop table if exists public.personal_autorizado cascade;
drop table if exists public.suscripcion_push cascade;
drop table if exists public.aviso          cascade;
drop table if exists public.gasto          cascade;
drop table if exists public.alerta_fauna   cascade;
drop table if exists public.tarifa_permiso cascade;
drop table if exists public.notificacion   cascade;
drop table if exists public.reporte        cascade;
drop table if exists public.pago           cascade;
drop table if exists public.permiso        cascade;
drop table if exists public.reserva_lugar  cascade;
drop table if exists public.reserva        cascade;
drop table if exists public.lugar          cascade;
drop table if exists public.catamaran      cascade;
drop table if exists public.especie        cascade;
drop table if exists public.usuario        cascade;

drop sequence if exists public.seq_numero_permiso cascade;
drop sequence if exists public.seq_numero_reserva cascade;

-- Funciones de versiones anteriores (otra firma u objetos que ya no se usan).
drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid);
drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text);
drop function if exists public.lista_embarque(uuid, date, text);
drop function if exists public.registrar_intento_acceso(text, boolean);
drop function if exists public.acceso_bloqueado(text);

-- ============================================================================
-- 1. TABLAS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USUARIO  (perfil; extiende auth.users de Supabase)
--   La identidad la verifica Google; acá no hay contraseñas. En el primer
--   ingreso el perfil se crea con los datos de Google (handle_new_user) y el
--   usuario completa DNI, teléfono y tipo de cuenta (perfil_completo).
--   Roles del sistema (TFG · sección Seguridad):
--     pescador        -> Pescador / Turista
--     dueno           -> Dueño de Catamarán
--     admin_municipal -> Administrador Municipal (Coronel Moldes)
--     admin_sistema   -> Administrador del Sistema
-- ---------------------------------------------------------------------------
create table public.usuario (
    id          uuid primary key references auth.users (id) on delete cascade,
    nombre      text        not null,
    apellido    text        not null default '',
    email       text        not null unique,
    telefono    text,
    dni         text,
    rol         text        not null default 'pescador'
                    check (rol in ('pescador','dueno','admin_municipal','admin_sistema')),
    activo      boolean     not null default true,
    perfil_completo boolean not null default false,   -- alta confirmada (HU-001)
    avatar_url  text,                                  -- foto de la cuenta de Google
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
comment on table  public.usuario is 'Perfil de usuario; extiende auth.users. El rol define los permisos.';
comment on column public.usuario.rol is 'pescador | dueno | admin_municipal | admin_sistema';

-- ---------------------------------------------------------------------------
-- ESPECIE  (fauna habilitada · soporte a HU-015 Monitoreo de fauna)
-- ---------------------------------------------------------------------------
create table public.especie (
    id               uuid primary key default gen_random_uuid(),
    nombre           text        not null unique,
    nombre_cientifico text,
    umbral_permisos  integer     not null default 500
                        check (umbral_permisos >= 0),
    descripcion      text,
    created_at       timestamptz not null default now()
);
comment on column public.especie.umbral_permisos is
    'Cantidad de permisos por período que dispara una alerta de presión pesquera.';

-- ---------------------------------------------------------------------------
-- CATAMARAN  (embarcación habilitada · Anexo 5)
-- ---------------------------------------------------------------------------
create table public.catamaran (
    id              uuid primary key default gen_random_uuid(),
    id_propietario  uuid references public.usuario (id) on delete set null,
    nombre          text        not null,
    descripcion     text,
    capacidad       integer     not null check (capacidad > 0),
    precio          numeric(12,2) not null default 0 check (precio >= 0),
    habilitacion    text,                       -- N° de habilitación municipal
    estado          text        not null default 'activa'
                        check (estado in ('activa','inactiva','mantenimiento')),
    fotos           text[]      not null default '{}',   -- rutas en Storage (<id>/<archivo>); la primera es la portada
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on column public.catamaran.precio is 'Precio por lugar (asiento) de la embarcación.';

-- ---------------------------------------------------------------------------
-- LUGAR  (asiento físico dentro de un catamarán)
--   Los crea crear_catamaran y los ajusta cambiar_capacidad: al quitar lugares,
--   los que ya tuvieron reservas quedan fuera de servicio (conservan el historial).
-- ---------------------------------------------------------------------------
create table public.lugar (
    id            uuid primary key default gen_random_uuid(),
    id_catamaran  uuid not null references public.catamaran (id) on delete cascade,
    numero        integer not null check (numero > 0),
    ubicacion     text,                          -- lugar en el plano, p. ej. 'estribor · centro' (ver ubicacion_lugar)
    activo        boolean not null default true, -- false = asiento fuera de servicio (se quitó del catamarán)
    created_at    timestamptz not null default now(),
    unique (id_catamaran, numero)
);

-- ---------------------------------------------------------------------------
-- RESERVA  (HU-005)
--   numero: número legible de la reserva (RES-001001).
--   id_permiso: permiso que ampara la salida, emitido con la reserva o uno que
--   el pescador ya tenía ("Ya tengo permiso"). monto_total incluye monto_permiso.
-- ---------------------------------------------------------------------------
create sequence public.seq_numero_reserva start 1001 increment 1;

create table public.reserva (
    id              uuid primary key default gen_random_uuid(),
    numero          text not null
                        default ('RES-' || lpad(nextval('public.seq_numero_reserva')::text, 6, '0')),
    id_usuario      uuid not null references public.usuario (id)   on delete cascade,
    id_catamaran    uuid not null references public.catamaran (id) on delete restrict,
    fecha           date not null,
    turno           text not null default 'manana'
                        check (turno in ('manana','tarde')),
    estado          text not null default 'confirmada'
                        check (estado in ('pendiente','confirmada','cancelada','completada')),
    cantidad_lugares integer not null default 0 check (cantidad_lugares >= 0),
    monto_total     numeric(12,2) not null default 0 check (monto_total >= 0),
    monto_permiso   numeric(12,2) not null default 0 check (monto_permiso >= 0),
    id_permiso      uuid,                          -- FK a permiso (se agrega debajo)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create unique index uq_reserva_numero on public.reserva (numero);
create index idx_reserva_usuario   on public.reserva (id_usuario);
create index idx_reserva_catamaran on public.reserva (id_catamaran);
create index idx_reserva_fecha     on public.reserva (fecha);

-- ---------------------------------------------------------------------------
-- RESERVA_LUGAR  (asientos concretos de una reserva · normaliza reserva.lugares)
--   Incluye "fecha" y "turno" (denormalizados) para impedir la doble reserva
--   del mismo asiento en la misma salida mediante un índice único parcial.
--   pasajero_nombre y pasajero_dni: acompañante que ocupa el lugar (nulos en el
--   lugar del titular de la reserva); con ellos se arma la lista de embarque.
-- ---------------------------------------------------------------------------
create table public.reserva_lugar (
    id          uuid primary key default gen_random_uuid(),
    id_reserva  uuid not null references public.reserva (id) on delete cascade,
    id_lugar    uuid not null references public.lugar (id)   on delete restrict,
    fecha       date not null,
    turno       text not null default 'manana'
                    constraint reserva_lugar_turno_check check (turno in ('manana','tarde')),
    estado      text not null default 'confirmada'
                    check (estado in ('confirmada','cancelada')),
    pasajero_nombre text check (char_length(pasajero_nombre) between 3 and 80),
    pasajero_dni    text check (pasajero_dni ~ '^[0-9]{1,2}[.][0-9]{3}[.][0-9]{3}$'),
    created_at  timestamptz not null default now(),
    constraint reserva_lugar_pasajero_check check ((pasajero_nombre is null) = (pasajero_dni is null))
);
create index idx_reserva_lugar_reserva on public.reserva_lugar (id_reserva);
create index idx_reserva_lugar_lugar   on public.reserva_lugar (id_lugar);

-- Un asiento sólo puede estar reservado una vez por fecha y turno (si no está cancelado).
create unique index uq_lugar_fecha_turno_activa
    on public.reserva_lugar (id_lugar, fecha, turno)
    where (estado = 'confirmada');

-- ---------------------------------------------------------------------------
-- PERMISO  (HU-006 · permiso digital con código de verificación)
-- ---------------------------------------------------------------------------
create table public.permiso (
    id                uuid primary key default gen_random_uuid(),
    id_reserva        uuid not null unique references public.reserva (id) on delete cascade,
    id_usuario        uuid not null references public.usuario (id) on delete cascade,
    id_especie        uuid references public.especie (id) on delete set null,
    numero            text not null unique,           -- p.ej. PCC-000215
    tipo              text not null default 'diario'
                          check (tipo in ('diario','semanal','anual')),
    codigo_qr         text not null,                  -- contenido codificado en el QR
    fecha_emision     timestamptz not null default now(),
    fecha_vencimiento timestamptz not null,
    estado            text not null default 'vigente'
                          check (estado in ('vigente','vencido','anulado')),
    created_at        timestamptz not null default now()
);
create index idx_permiso_usuario on public.permiso (id_usuario);
create index idx_permiso_especie on public.permiso (id_especie);
create index idx_permiso_estado  on public.permiso (estado);

alter table public.reserva
    add constraint reserva_id_permiso_fkey foreign key (id_permiso)
    references public.permiso (id) on delete set null;

-- ---------------------------------------------------------------------------
-- TARIFA_PERMISO  (precio de cada tipo de permiso de pesca)
-- ---------------------------------------------------------------------------
create table public.tarifa_permiso (
    tipo        text primary key check (tipo in ('diario','semanal','anual')),
    precio      numeric(12,2) not null check (precio >= 0),
    updated_at  timestamptz not null default now()
);
insert into public.tarifa_permiso (tipo, precio) values
    ('diario', 5000), ('semanal', 15000), ('anual', 45000);

-- ---------------------------------------------------------------------------
-- PAGO  (HU-007)
-- ---------------------------------------------------------------------------
create table public.pago (
    id           uuid primary key default gen_random_uuid(),
    id_reserva   uuid not null unique references public.reserva (id) on delete cascade,
    monto        numeric(12,2) not null check (monto >= 0),
    metodo       text not null default 'tarjeta'
                     check (metodo in ('tarjeta','transferencia','mercadopago','efectivo')),
    estado       text not null default 'aprobado'
                     check (estado in ('pendiente','aprobado','rechazado')),
    comprobante  text,                              -- código de comprobante digital
    autorizacion text,                              -- código de autorización de la pasarela
    fecha_pago   timestamptz not null default now(),
    created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- REPORTE  (HU-008 generación · HU-009 envío al municipio)
--   Cada envío registra fecha, destinatario, origen (manual / automático) y
--   una instantánea de los indicadores (datos).
-- ---------------------------------------------------------------------------
create table public.reporte (
    id            uuid primary key default gen_random_uuid(),
    tipo          text not null
                      check (tipo in ('ocupacion','permisos','ingresos','fauna','general')),
    titulo        text not null,
    fecha         date not null default current_date,
    parametros    jsonb not null default '{}'::jsonb,   -- período / filtros
    datos         jsonb not null default '{}'::jsonb,   -- contenido del reporte
    generado_por  uuid references public.usuario (id) on delete set null,
    destinatario  text not null default 'Municipio de Coronel Moldes',
    origen        text not null default 'manual'
                      check (origen in ('manual','automatico')),
    estado_envio  text not null default 'enviado'
                      check (estado_envio in ('pendiente','enviado','fallido')),
    created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- NOTIFICACION  (HU-011 · avisos de reserva, recordatorios y sistema)
-- ---------------------------------------------------------------------------
create table public.notificacion (
    id          uuid primary key default gen_random_uuid(),
    id_usuario  uuid not null references public.usuario (id) on delete cascade,
    id_reserva  uuid references public.reserva (id) on delete cascade,  -- evita recordatorios duplicados
    tipo        text not null default 'reserva'
                    check (tipo in ('reserva','recordatorio','permiso','pago','sistema','aviso','salida')),
    titulo      text not null,
    mensaje     text not null,
    leida       boolean not null default false,
    push_enviada timestamptz,                -- aviso al teléfono ya enviado (Web Push, función enviar-push)
    created_at  timestamptz not null default now()
);
create index idx_notificacion_usuario on public.notificacion (id_usuario, leida);
create index idx_notificacion_reserva on public.notificacion (id_reserva);

-- ---------------------------------------------------------------------------
-- AVISO  (HU-011 · avisos que la administración publica para los usuarios)
--   Cada publicación genera una notificación de tipo 'aviso' para cada
--   destinatario (todos, pescadores, dueños o una persona); acá queda el registro.
-- ---------------------------------------------------------------------------
create table public.aviso (
    id              uuid primary key default gen_random_uuid(),
    titulo          text not null check (char_length(titulo) between 3 and 80),
    mensaje         text not null check (char_length(mensaje) between 3 and 500),
    destino         text not null check (destino in ('todos','pescador','dueno','usuario')),
    id_destinatario uuid references public.usuario (id) on delete set null,
    destinatarios   integer not null default 0,
    publicado_por   uuid references public.usuario (id) on delete set null,
    created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- SUSCRIPCION_PUSH  (HU-011 · avisos al teléfono aunque la aplicación esté cerrada)
--   Cada teléfono o navegador que el usuario habilita para recibir avisos
--   (Web Push). Se registra y se borra sólo con registrar_push y borrar_push.
-- ---------------------------------------------------------------------------
create table public.suscripcion_push (
    id          uuid primary key default gen_random_uuid(),
    id_usuario  uuid not null references public.usuario (id) on delete cascade,
    endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
    p256dh      text not null check (char_length(p256dh) between 1 and 200),
    auth        text not null check (char_length(auth) between 1 and 100),
    created_at  timestamptz not null default now()
);
create index idx_suscripcion_push_usuario on public.suscripcion_push (id_usuario);

-- ---------------------------------------------------------------------------
-- ALERTA_FAUNA  (HU-015 · alertas de umbral por especie)
-- ---------------------------------------------------------------------------
create table public.alerta_fauna (
    id                uuid primary key default gen_random_uuid(),
    id_especie        uuid not null references public.especie (id) on delete cascade,
    periodo           text not null,                 -- p.ej. '2026-05'
    permisos_emitidos integer not null default 0,
    umbral            integer not null default 0,
    estado            text not null default 'activa'
                          check (estado in ('activa','resuelta')),
    created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- GASTO  (HU-003 · finanzas del dueño de catamarán)
--   Gastos que registra el dueño para conocer el resultado de su actividad:
--   ingresos por lugares vendidos menos gastos, por mes y por catamarán. Sin
--   catamarán es un gasto general de la flota. Son privados: sólo los ve y los
--   modifica su dueño.
-- ---------------------------------------------------------------------------
create table public.gasto (
    id              uuid primary key default gen_random_uuid(),
    id_propietario  uuid not null default auth.uid() references public.usuario (id) on delete cascade,
    id_catamaran    uuid references public.catamaran (id) on delete set null,
    fecha           date not null,
    categoria       text not null
                        check (categoria in ('combustible','mantenimiento','personal','seguro','amarre','impuestos','otros')),
    descripcion     text check (char_length(descripcion) <= 120),
    monto           numeric(12,2) not null check (monto > 0),
    created_at      timestamptz not null default now()
);
create index idx_gasto_propietario on public.gasto (id_propietario, fecha);

-- ---------------------------------------------------------------------------
-- PERSONAL_AUTORIZADO  (altas autorizadas de cuentas del personal)
--   El personal municipal y el administrador ingresan con usuario y contraseña
--   (/Municipio y /Admin). Sólo puede crearse una cuenta con contraseña si antes
--   se la autoriza acá; la autorización vence a los 15 minutos y se usa una vez.
-- ---------------------------------------------------------------------------
create table public.personal_autorizado (
    usuario    text primary key check (usuario ~ '^[a-z0-9._-]{3,30}$'),
    email      text not null unique,
    rol        text not null check (rol in ('admin_municipal','admin_sistema')),
    nombre     text not null,
    apellido   text not null default '',
    expira     timestamptz not null default (now() + interval '15 minutes'),
    usado      boolean not null default false,
    created_at timestamptz not null default now()
);

-- ============================================================================
-- 2. SECUENCIA Y FUNCIONES AUXILIARES
-- ============================================================================

-- Numeración correlativa de permisos: PCC-000001, PCC-000002, ...
create sequence public.seq_numero_permiso start 215 increment 1;

create or replace function public.generar_numero_permiso()
returns text
language sql
set search_path = public
as $$
    select 'PCC-' || lpad(nextval('public.seq_numero_permiso')::text, 6, '0');
$$;

-- Ubicación de un asiento en el plano del catamarán (vista desde arriba, proa
-- adelante): numeración en sentido horario desde la proa, primero por estribor
-- (lado derecho) y luego por babor, en tres zonas: proa, centro y popa.
-- Ejemplo con 20 lugares: el 6 queda en "estribor · centro".
create or replace function public.ubicacion_lugar(p_numero integer, p_total integer)
returns text
language sql
immutable
set search_path = public
as $$
    select case when p_numero <= x.filas then 'estribor' else 'babor' end
           || ' · ' ||
           case when x.fila * 3 < x.filas     then 'proa'
                when x.fila * 3 < x.filas * 2 then 'centro'
                else 'popa' end
    from (select ceil(p_total / 2.0)::int as filas,
                 case when p_numero <= ceil(p_total / 2.0)::int
                      then p_numero - 1
                      else 2 * ceil(p_total / 2.0)::int - p_numero end as fila) x;
$$;

-- Devuelve el rol del usuario autenticado, sólo si su cuenta está activa (una
-- cuenta desactivada pierde sus permisos, también los de administración).
-- SECURITY DEFINER para evitar recursión de RLS al consultarse desde políticas
-- sobre "usuario".
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select rol from public.usuario where id = auth.uid() and activo;
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.rol_actual() in ('admin_municipal','admin_sistema'), false);
$$;

-- Primera validación de toda función de negocio: hay un usuario y su cuenta
-- está activa. Devuelve su id.
create or replace function public.exigir_cuenta_activa()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid    uuid := auth.uid();
    v_activo boolean;
begin
    if v_uid is null then
        raise exception 'No autenticado';
    end if;
    select activo into v_activo from public.usuario where id = v_uid;
    if v_activo is null then
        raise exception 'No se encontró tu perfil';
    end if;
    if not v_activo then
        raise exception 'Tu cuenta está desactivada. Comunicate con el Municipio de Coronel Moldes.';
    end if;
    return v_uid;
end;
$$;

-- Mantener updated_at al actualizar filas.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_usuario_updated   before update on public.usuario
    for each row execute function public.set_updated_at();
create trigger trg_catamaran_updated before update on public.catamaran
    for each row execute function public.set_updated_at();
create trigger trg_reserva_updated   before update on public.reserva
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Alta automática del perfil.
--   Google: el perfil se crea con nombre, correo y foto; DNI, teléfono y tipo
--   de cuenta los completa el usuario. Toda cuenta nueva es "pescador".
--   Usuario y contraseña (personal): sólo con una autorización vigente en
--   personal_autorizado, que define el rol; si no, el alta se rechaza.
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

-- ----------------------------------------------------------------------------
-- Protección de los datos sensibles del perfil.
-- La política RLS permite que cada usuario edite su propio perfil; este
-- trigger impide que, al hacerlo, cambie su rol, su correo o su estado. El tipo
-- de cuenta (pescador o dueño) sólo se elige una vez, en el alta. Sobre cuentas
-- ajenas, la administración sólo cambia el tipo de cuenta (pescador o dueño) y
-- el estado; el de las cuentas del personal, sólo el administrador del sistema.
-- Los roles administrativos se fijan al dar de alta la cuenta del personal
-- (crear_cuenta_personal). Las consultas administrativas (SQL Editor) no tienen
-- restricción.
-- ----------------------------------------------------------------------------
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

create trigger trg_usuario_proteger
    before update on public.usuario
    for each row execute function public.proteger_perfil();

-- Al desactivar una cuenta se cierran sus sesiones (con ellas caen los refresh
-- tokens); desde ese momento rol_actual() y exigir_cuenta_activa() la rechazan.
create or replace function public.cerrar_sesiones_desactivada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.activo and not new.activo then
        begin
            delete from auth.sessions where user_id = new.id;
        exception when insufficient_privilege then
            raise warning 'No se pudieron cerrar las sesiones de %', new.email;
        end;
    end if;
    return null;
end;
$$;

create trigger trg_usuario_cerrar_sesiones
    after update of activo on public.usuario
    for each row execute function public.cerrar_sesiones_desactivada();

-- ============================================================================
-- 3. LÓGICA DE NEGOCIO (RPC)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- validar_permiso: verifica un permiso que el pescador ya tiene. Sirve para
-- una salida si es del mismo titular, no está anulado y la fecha de la salida
-- cae dentro de su vigencia.
-- ----------------------------------------------------------------------------
create or replace function public.validar_permiso(p_numero text, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid   uuid := public.exigir_cuenta_activa();
    p       record;
    v_desde date;
    v_hasta date;
begin
    if coalesce(trim(p_numero), '') = '' then
        raise exception 'Ingresá el número de tu permiso';
    end if;

    select pe.id, pe.numero, pe.tipo, pe.estado, pe.fecha_emision, pe.fecha_vencimiento,
           r.fecha as fecha_reserva, e.nombre as especie
      into p
      from public.permiso pe
      left join public.reserva r on r.id = pe.id_reserva
      left join public.especie e on e.id = pe.id_especie
     where upper(pe.numero) = upper(trim(p_numero))
       and pe.id_usuario = v_uid;
    if not found then
        raise exception 'No encontramos un permiso con ese número a tu nombre';
    end if;
    if p.estado = 'anulado' then
        raise exception 'El permiso % está anulado', p.numero;
    end if;

    v_desde := coalesce(p.fecha_reserva, (p.fecha_emision at time zone 'America/Argentina/Salta')::date);
    v_hasta := (p.fecha_vencimiento at time zone 'America/Argentina/Salta')::date;
    if p_fecha < v_desde or p_fecha > v_hasta then
        raise exception 'El permiso % no cubre el %: vale del % al %', p.numero,
            to_char(p_fecha, 'DD/MM/YYYY'), to_char(v_desde, 'DD/MM/YYYY'), to_char(v_hasta, 'DD/MM/YYYY');
    end if;

    return jsonb_build_object('id', p.id, 'numero', p.numero, 'tipo', p.tipo,
                              'especie', p.especie, 'desde', v_desde, 'hasta', v_hasta);
end;
$$;

-- ----------------------------------------------------------------------------
-- crear_reserva_completa
--   Operación atómica que implementa el flujo del TFG (HU-005 + HU-006 + HU-007):
--     1. Valida el catamarán (activo), los asientos (de esa embarcación), la
--        fecha y el medio de pago, y verifica que los asientos estén libres en
--        esa fecha y turno.
--     2. Permiso: con p_numero_permiso ("Ya tengo permiso") valida ese permiso;
--        sin él ("Comprar permiso") suma la tarifa del tipo elegido.
--     3. Crea la reserva (número RES-), sus asientos y el pago aprobado.
--     4. Si se compró, genera el permiso digital (número, código y vencimiento).
--     5. Crea una notificación para el usuario.
--   Devuelve los números de reserva, permiso y comprobante.
--
--   p_lugares: arreglo de UUID de asientos (lugar.id); el primero es el del titular.
--   p_acompanantes: [{"nombre", "dni"}] de quien ocupa cada uno de los demás
--   lugares, en el mismo orden (uno menos que la cantidad de lugares).
-- ----------------------------------------------------------------------------
create or replace function public.crear_reserva_completa(
    p_id_catamaran   uuid,
    p_fecha          date,
    p_turno          text,
    p_lugares        uuid[],
    p_metodo_pago    text default 'tarjeta',
    p_tipo_permiso   text default 'diario',
    p_id_especie     uuid default null,
    p_numero_permiso text default null,
    p_autorizacion   text default null,
    p_acompanantes   jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid         uuid := public.exigir_cuenta_activa();
    v_turno       text := coalesce(p_turno, 'manana');
    v_metodo      text := coalesce(p_metodo_pago, 'tarjeta');
    v_tipo        text := coalesce(p_tipo_permiso, 'diario');
    v_nuevo       boolean := coalesce(trim(p_numero_permiso), '') = '';
    v_hoy         date := (now() at time zone 'America/Argentina/Salta')::date;
    v_precio      numeric(12,2);
    v_estado_cat  text;
    v_cant        integer := coalesce(array_length(p_lugares, 1), 0);
    v_tarifa      numeric(12,2) := 0;
    v_total       numeric(12,2);
    v_reserva     uuid;
    v_nro_reserva text;
    v_lugar       uuid;
    v_ocupado     integer;
    v_valido      jsonb;
    v_numero      text;
    v_codigo      text;
    v_vence       timestamptz;
    v_permiso     uuid;
    v_comprobante text;
    v_acomp       jsonb := coalesce(p_acompanantes, '[]'::jsonb);
    v_nombre      text;
    v_dni         text;
    v_dnis        text[];
begin
    if v_cant = 0 then
        raise exception 'Debe seleccionar al menos un lugar';
    end if;
    if v_turno not in ('manana', 'tarde') then
        raise exception 'Turno inválido';
    end if;
    if v_metodo not in ('tarjeta', 'transferencia', 'mercadopago', 'efectivo') then
        raise exception 'Medio de pago inválido';
    end if;
    if p_fecha < v_hoy then
        raise exception 'No se puede reservar una fecha pasada';
    end if;

    select precio, estado into v_precio, v_estado_cat from public.catamaran where id = p_id_catamaran;
    if v_precio is null then
        raise exception 'El catamarán no existe';
    end if;
    if v_estado_cat <> 'activa' then
        raise exception 'El catamarán no está disponible para reservas';
    end if;
    if exists (select 1 from unnest(p_lugares) as x(id)
               left join public.lugar l on l.id = x.id
               where l.id is null or l.id_catamaran <> p_id_catamaran) then
        raise exception 'Los lugares elegidos no pertenecen a ese catamarán';
    end if;
    if exists (select 1 from public.lugar where id = any (p_lugares) and not activo) then
        raise exception 'Uno de los lugares ya no está disponible en ese catamarán. Actualizá el plano';
    end if;

    -- Acompañantes (lista de embarque): nombre y DNI de quien ocupa cada lugar
    -- además del titular, sin DNI repetidos entre los pasajeros.
    if jsonb_typeof(v_acomp) <> 'array' or jsonb_array_length(v_acomp) <> v_cant - 1 then
        raise exception 'Completá el nombre y el DNI de cada acompañante (uno por cada lugar además del tuyo)';
    end if;
    select array[regexp_replace(coalesce(dni, ''), '[^0-9]', '', 'g')] into v_dnis from public.usuario where id = v_uid;
    for i in 0 .. v_cant - 2 loop
        v_nombre := trim(coalesce(v_acomp -> i ->> 'nombre', ''));
        v_dni    := regexp_replace(coalesce(v_acomp -> i ->> 'dni', ''), '[^0-9]', '', 'g');
        if char_length(v_nombre) not between 3 and 80 then
            raise exception 'Ingresá el nombre y apellido del acompañante %', i + 1;
        end if;
        if char_length(v_dni) not between 7 and 8 then
            raise exception 'El DNI del acompañante % debe tener 7 u 8 dígitos', i + 1;
        end if;
        if v_dni = any (v_dnis) then
            raise exception 'Hay un DNI repetido entre los pasajeros';
        end if;
        v_dnis := v_dnis || v_dni;
    end loop;

    -- Permiso: el que ya tiene el pescador (se valida) o uno nuevo (se cobra la tarifa).
    if v_nuevo then
        if v_tipo not in ('diario', 'semanal', 'anual') then
            raise exception 'Tipo de permiso inválido';
        end if;
        select precio into v_tarifa from public.tarifa_permiso where tipo = v_tipo;
        v_tarifa := coalesce(v_tarifa, 0);
    else
        v_valido  := public.validar_permiso(p_numero_permiso, p_fecha);
        v_permiso := (v_valido ->> 'id')::uuid;
        v_numero  := v_valido ->> 'numero';
    end if;

    -- Disponibilidad de cada asiento en la fecha y el turno pedidos.
    foreach v_lugar in array p_lugares loop
        select count(*) into v_ocupado
        from public.reserva_lugar
        where id_lugar = v_lugar
          and fecha    = p_fecha
          and turno    = v_turno
          and estado   = 'confirmada';
        if v_ocupado > 0 then
            raise exception 'Uno de los lugares ya está ocupado en ese turno';
        end if;
    end loop;

    v_total := v_precio * v_cant + v_tarifa;

    insert into public.reserva (id_usuario, id_catamaran, fecha, turno, estado,
                                cantidad_lugares, monto_total, monto_permiso, id_permiso)
    values (v_uid, p_id_catamaran, p_fecha, v_turno, 'confirmada',
            v_cant, v_total, v_tarifa, v_permiso)
    returning id, numero into v_reserva, v_nro_reserva;

    for i in 1 .. v_cant loop
        v_nombre := null; v_dni := null;
        if i > 1 then
            v_nombre := trim(v_acomp -> (i - 2) ->> 'nombre');
            v_dni    := regexp_replace(regexp_replace(v_acomp -> (i - 2) ->> 'dni', '[^0-9]', '', 'g'),
                                       '^([0-9]{1,2})([0-9]{3})([0-9]{3})$', '\1.\2.\3');
        end if;
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado, pasajero_nombre, pasajero_dni)
        values (v_reserva, p_lugares[i], p_fecha, v_turno, 'confirmada', v_nombre, v_dni);
    end loop;

    v_comprobante := 'CMP-' || upper(substr(replace(v_reserva::text, '-', ''), 1, 10));
    insert into public.pago (id_reserva, monto, metodo, estado, comprobante, autorizacion)
    values (v_reserva, v_total, v_metodo, 'aprobado', v_comprobante, p_autorizacion);

    if v_nuevo then
        v_numero := public.generar_numero_permiso();
        -- Vencimiento en hora de Salta (el diario vale hasta las 23:59 del día de la salida).
        v_vence  := case v_tipo
                        when 'anual'   then (p_fecha + interval '1 year')
                        when 'semanal' then (p_fecha + interval '7 day')
                        else (p_fecha + time '23:59')
                    end at time zone 'America/Argentina/Salta';
        v_codigo := v_numero || '|' || v_uid::text || '|' || p_fecha::text;

        insert into public.permiso (id_reserva, id_usuario, id_especie, numero, tipo,
                                    codigo_qr, fecha_vencimiento, estado)
        values (v_reserva, v_uid, p_id_especie, v_numero, v_tipo, v_codigo, v_vence, 'vigente')
        returning id into v_permiso;

        update public.reserva set id_permiso = v_permiso where id = v_reserva;
    end if;

    insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
    values (v_uid, v_reserva, 'reserva', 'Reserva confirmada',
            'Tu reserva ' || v_nro_reserva || ' para el ' || to_char(p_fecha, 'DD/MM/YYYY') ||
            ' fue confirmada. Permiso ' || v_numero ||
            case when v_nuevo then ' emitido.' else ' asociado.' end);

    return jsonb_build_object(
        'reserva_id',     v_reserva,
        'numero_reserva', v_nro_reserva,
        'permiso_id',     v_permiso,
        'numero_permiso', v_numero,
        'permiso_nuevo',  v_nuevo,
        'monto_total',    v_total,
        'monto_permiso',  v_tarifa,
        'comprobante',    v_comprobante
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- anular_reserva: cancela la reserva, libera los asientos y anula el permiso
-- emitido con ella, salvo que ampare otra reserva activa. Sólo reservas
-- confirmadas; el pescador, las suyas y de hoy en adelante.
-- ----------------------------------------------------------------------------
create or replace function public.anular_reserva(p_id_reserva uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid   uuid := public.exigir_cuenta_activa();
    v_admin boolean := public.es_admin();
    r       record;
begin
    select id_usuario, estado, fecha into r from public.reserva where id = p_id_reserva;
    if not found then
        raise exception 'La reserva no existe';
    end if;
    if r.id_usuario <> v_uid and not v_admin then
        raise exception 'No autorizado para anular esta reserva';
    end if;
    if r.estado <> 'confirmada' then
        raise exception 'Sólo se puede anular una reserva confirmada';
    end if;
    if not v_admin and r.fecha < (now() at time zone 'America/Argentina/Salta')::date then
        raise exception 'No se puede anular una salida que ya pasó';
    end if;

    update public.reserva       set estado = 'cancelada' where id = p_id_reserva;
    update public.reserva_lugar set estado = 'cancelada' where id_reserva = p_id_reserva;
    update public.permiso pe    set estado = 'anulado'
    where pe.id_reserva = p_id_reserva
      and not exists (select 1 from public.reserva x
                      where x.id_permiso = pe.id and x.id <> p_id_reserva
                        and x.estado in ('confirmada', 'completada'));
end;
$$;

-- ----------------------------------------------------------------------------
-- crear_catamaran (HU-003): alta de una embarcación con todos sus lugares, en
-- una sola operación. El dueño la registra a su nombre; la administración, sin
-- dueño asignado. Devuelve el id del catamarán.
-- ----------------------------------------------------------------------------
create or replace function public.crear_catamaran(
    p_nombre       text,
    p_descripcion  text,
    p_capacidad    integer,
    p_precio       numeric,
    p_habilitacion text,
    p_estado       text default 'activa'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := public.exigir_cuenta_activa();
    v_rol text := public.rol_actual();
    v_id  uuid;
begin
    if v_rol not in ('dueno', 'admin_municipal', 'admin_sistema') then
        raise exception 'Solo un dueño de catamarán o la administración pueden dar de alta catamaranes';
    end if;
    if char_length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then
        raise exception 'Ingresá el nombre del catamarán (hasta 60 caracteres)';
    end if;
    if char_length(coalesce(p_descripcion, '')) > 300 then
        raise exception 'La descripción puede tener hasta 300 caracteres';
    end if;
    if p_capacidad is null or p_capacidad not between 1 and 60 then
        raise exception 'La cantidad de lugares debe ser un número entero entre 1 y 60';
    end if;
    if p_precio is null or p_precio < 0 then
        raise exception 'Ingresá un precio por lugar válido';
    end if;
    if trim(coalesce(p_habilitacion, '')) = '' then
        raise exception 'Ingresá el número de habilitación municipal';
    end if;
    if coalesce(p_estado, '') not in ('activa', 'inactiva', 'mantenimiento') then
        raise exception 'Estado inválido';
    end if;

    insert into public.catamaran (id_propietario, nombre, descripcion, capacidad, precio, habilitacion, estado)
    values (case when v_rol = 'dueno' then v_uid end, trim(p_nombre),
            nullif(trim(coalesce(p_descripcion, '')), ''), p_capacidad, p_precio, trim(p_habilitacion), p_estado)
    returning id into v_id;

    insert into public.lugar (id_catamaran, numero, ubicacion)
    select v_id, n, public.ubicacion_lugar(n, p_capacidad)
    from generate_series(1, p_capacidad) as n;
    return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- cambiar_capacidad (HU-003): cambia la cantidad de lugares de un catamarán.
--   Al sumar, crea (o vuelve a habilitar) los lugares que faltan. Al quitar, no
--   permite sacar lugares con reservas desde hoy; los que nunca se reservaron se
--   borran y los que tienen historial quedan fuera de servicio. En los dos casos
--   se recalcula la ubicación de cada lugar en el plano.
-- ----------------------------------------------------------------------------
create or replace function public.cambiar_capacidad(p_id_catamaran uuid, p_capacidad integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid    uuid := public.exigir_cuenta_activa();
    v_hoy    date := (now() at time zone 'America/Argentina/Salta')::date;
    v_prop   uuid;
    v_actual integer;
    v_ocupados text;
begin
    select id_propietario, capacidad into v_prop, v_actual
    from public.catamaran where id = p_id_catamaran for update;
    if not found then
        raise exception 'El catamarán no existe';
    end if;
    if not (public.es_admin() or (v_prop is not distinct from v_uid and public.rol_actual() = 'dueno')) then
        raise exception 'No autorizado para modificar este catamarán';
    end if;
    if p_capacidad is null or p_capacidad not between 1 and 60 then
        raise exception 'La cantidad de lugares debe ser un número entero entre 1 y 60';
    end if;
    if p_capacidad = v_actual then
        return;
    end if;

    select string_agg(numero::text, ', ' order by numero) into v_ocupados
    from (select distinct l.numero
          from public.lugar l
          join public.reserva_lugar rl on rl.id_lugar = l.id
          where l.id_catamaran = p_id_catamaran and l.numero > p_capacidad
            and rl.estado = 'confirmada' and rl.fecha >= v_hoy) q;
    if v_ocupados is not null then
        raise exception 'Hay reservas desde hoy en lugares que se quitarían (%). Elegí una cantidad mayor o esperá a que pasen esas salidas', v_ocupados;
    end if;

    delete from public.lugar l
    where l.id_catamaran = p_id_catamaran and l.numero > p_capacidad
      and not exists (select 1 from public.reserva_lugar rl where rl.id_lugar = l.id);
    update public.lugar set activo = (numero <= p_capacidad) where id_catamaran = p_id_catamaran;
    insert into public.lugar (id_catamaran, numero)
    select p_id_catamaran, n from generate_series(1, p_capacidad) as n
    where not exists (select 1 from public.lugar where id_catamaran = p_id_catamaran and numero = n);
    update public.lugar set ubicacion = public.ubicacion_lugar(numero, p_capacidad)
    where id_catamaran = p_id_catamaran and activo;
    update public.catamaran set capacidad = p_capacidad where id = p_id_catamaran;
end;
$$;

-- ----------------------------------------------------------------------------
-- asignar_propietario (HU-003): la administración asigna (o quita) el dueño de
-- un catamarán; un dueño puede tener varios. Los gastos del dueño anterior en
-- esa embarcación pasan a ser gastos generales suyos.
-- ----------------------------------------------------------------------------
create or replace function public.asignar_propietario(p_id_catamaran uuid, p_id_propietario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := public.exigir_cuenta_activa();
    v_prev uuid;
begin
    if not public.es_admin() then
        raise exception 'Solo la administración asigna el dueño de un catamarán';
    end if;
    select id_propietario into v_prev from public.catamaran where id = p_id_catamaran for update;
    if not found then
        raise exception 'El catamarán no existe';
    end if;
    if p_id_propietario is not null and not exists (
        select 1 from public.usuario where id = p_id_propietario and rol = 'dueno' and activo) then
        raise exception 'Elegí una cuenta activa de dueño de catamarán';
    end if;
    if v_prev is not distinct from p_id_propietario then
        return;
    end if;
    update public.gasto set id_catamaran = null
    where id_catamaran = p_id_catamaran and id_propietario is distinct from p_id_propietario;
    update public.catamaran set id_propietario = p_id_propietario where id = p_id_catamaran;
end;
$$;

-- ----------------------------------------------------------------------------
-- avisar_pasajeros (HU-011): el dueño (o la administración) envía un aviso a
-- todos los que reservaron una salida (catamarán, fecha y turno), por ejemplo
-- si se suspende o si está por zarpar. Llega como notificación de tipo
-- 'salida'; el dueño no ve quiénes la reciben, sólo cuántos. Hasta 10 avisos
-- por salida. Devuelve la cantidad de destinatarios.
-- ----------------------------------------------------------------------------
create or replace function public.avisar_pasajeros(
    p_id_catamaran uuid,
    p_fecha        date,
    p_turno        text,
    p_titulo       text,
    p_mensaje      text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := public.exigir_cuenta_activa();
    v_hoy     date := (now() at time zone 'America/Argentina/Salta')::date;
    v_titulo  text := trim(coalesce(p_titulo, ''));
    v_mensaje text := trim(coalesce(p_mensaje, ''));
    v_prop    uuid;
    v_previos integer;
    v_n       integer;
begin
    select id_propietario into v_prop from public.catamaran where id = p_id_catamaran;
    if not found then
        raise exception 'El catamarán no existe';
    end if;
    if not (public.es_admin() or (v_prop is not distinct from v_uid and public.rol_actual() = 'dueno')) then
        raise exception 'No autorizado para avisar a los pasajeros de este catamarán';
    end if;
    if p_fecha is null or p_fecha < v_hoy then
        raise exception 'Solo se puede avisar sobre salidas de hoy en adelante';
    end if;
    if coalesce(p_turno, '') not in ('manana', 'tarde') then
        raise exception 'Turno inválido';
    end if;
    if char_length(v_titulo) not between 3 and 80 then
        raise exception 'El título debe tener entre 3 y 80 caracteres';
    end if;
    if char_length(v_mensaje) not between 3 and 500 then
        raise exception 'El mensaje debe tener entre 3 y 500 caracteres';
    end if;

    select count(distinct n.created_at) into v_previos
    from public.notificacion n
    join public.reserva r on r.id = n.id_reserva
    where n.tipo = 'salida' and r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno;
    if v_previos >= 10 then
        raise exception 'Ya se enviaron 10 avisos para esta salida';
    end if;

    insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
    select distinct on (r.id_usuario) r.id_usuario, r.id, 'salida', v_titulo, v_mensaje
    from public.reserva r
    join public.usuario u on u.id = r.id_usuario
    where r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno
      and r.estado = 'confirmada' and u.activo
    order by r.id_usuario, r.created_at;
    get diagnostics v_n = row_count;
    if v_n = 0 then
        raise exception 'No hay pasajeros con reserva confirmada en esa salida';
    end if;
    return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- lista_embarque (HU-003): pasajeros de una salida, uno por lugar: el titular
-- de cada reserva (nombre, apellido y DNI de su perfil) y los acompañantes que
-- cargó al reservar. Un lugar de una reserva anterior sin acompañante cargado
-- sale sin nombre. Sólo el dueño del catamarán y la administración; no entrega
-- correo, teléfono, pago ni permiso.
-- ----------------------------------------------------------------------------
create or replace function public.lista_embarque(p_id_catamaran uuid, p_fecha date, p_turno text)
returns table (numero text, lugar integer, pasajero text, dni text, titular boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
    v_uid  uuid := public.exigir_cuenta_activa();
    v_prop uuid;
begin
    select c.id_propietario into v_prop from public.catamaran c where c.id = p_id_catamaran;
    if not found then
        raise exception 'El catamarán no existe';
    end if;
    if not (public.es_admin() or (v_prop is not distinct from v_uid and public.rol_actual() = 'dueno')) then
        raise exception 'No autorizado para ver la lista de embarque de este catamarán';
    end if;
    return query
    with asientos as (
        select r.numero as nro, l.numero as nlugar, u.nombre as t_nombre, u.apellido as t_apellido, u.dni as t_dni,
               rl.pasajero_nombre as p_nombre, rl.pasajero_dni as p_dni,
               row_number() over (partition by r.id, rl.pasajero_nombre is null order by l.numero) as orden
        from public.reserva r
        join public.usuario u        on u.id = r.id_usuario
        join public.reserva_lugar rl on rl.id_reserva = r.id
        join public.lugar l          on l.id = rl.id_lugar
        where r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno
          and r.estado in ('confirmada', 'completada')
    )
    select a.nro, a.nlugar,
           case when a.p_nombre is not null then a.p_nombre
                when a.orden = 1 then trim(both ', ' from coalesce(a.t_apellido, '') || ', ' || coalesce(a.t_nombre, '')) end,
           case when a.p_nombre is not null then a.p_dni
                when a.orden = 1 then a.t_dni end,
           (a.p_nombre is null and a.orden = 1)
    from asientos a
    order by a.nlugar;
end;
$$;

-- ----------------------------------------------------------------------------
-- Fotos de los catamaranes (Supabase Storage, depósito "catamaranes", público).
--   Cada foto se guarda como <id del catamarán>/<archivo>; catamaran.fotos
--   tiene esas rutas en orden (la primera es la portada), hasta 6.
--   es_foto_propia: la usan las políticas del depósito; el dueño sube y borra
--   fotos sólo de sus catamaranes y la administración, de todos.
-- ----------------------------------------------------------------------------
create or replace function public.es_foto_propia(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.catamaran c
        where c.id::text = split_part(coalesce(p_nombre, ''), '/', 1)
          and (public.es_admin() or (c.id_propietario = auth.uid() and public.rol_actual() = 'dueno')));
$$;

create or replace function public.validar_fotos_catamaran()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if coalesce(cardinality(new.fotos), 0) > 6 then
        raise exception 'Un catamarán puede tener hasta 6 fotos';
    end if;
    if exists (select 1 from unnest(new.fotos) f
               where f !~ ('^' || new.id::text || '/[A-Za-z0-9_.-]+$')) then
        raise exception 'Las fotos deben pertenecer a ese catamarán';
    end if;
    return new;
end;
$$;

create trigger trg_catamaran_fotos
    before insert or update of fotos on public.catamaran
    for each row execute function public.validar_fotos_catamaran();

-- ============================================================================
-- 4. VISTAS DE REPORTE  (alimentan el Panel Municipal y la pantalla de Reportes)
-- ============================================================================

-- Reservas confirmadas agrupadas por día.
create or replace view public.v_reservas_por_dia with (security_invoker = true) as
select fecha,
       count(*)               as cantidad_reservas,
       coalesce(sum(monto_total),0) as ingresos
from public.reserva
where estado in ('confirmada','completada')
group by fecha
order by fecha;

-- Ocupación por catamarán (asientos vendidos vs capacidad total).
create or replace view public.v_ocupacion_catamaran with (security_invoker = true) as
select c.id,
       c.nombre,
       c.capacidad,
       count(rl.id) filter (where rl.estado = 'confirmada') as lugares_ocupados
from public.catamaran c
left join public.reserva r  on r.id_catamaran = c.id
left join public.reserva_lugar rl on rl.id_reserva = r.id
group by c.id, c.nombre, c.capacidad
order by c.nombre;

-- Permisos emitidos por especie (HU-015).
create or replace view public.v_permisos_por_especie with (security_invoker = true) as
select e.id,
       e.nombre        as especie,
       e.umbral_permisos,
       count(p.id) filter (where p.estado <> 'anulado') as permisos_emitidos
from public.especie e
left join public.permiso p on p.id_especie = e.id
group by e.id, e.nombre, e.umbral_permisos
order by permisos_emitidos desc;

-- Ocupación de lugares por fecha, visible para cualquier usuario autenticado
-- (HU-004). Sin security_invoker: se ejecuta como propietario y por eso no la
-- limita RLS; expone sólo id_lugar, id_catamaran y fecha, nunca quién reservó.
create or replace view public.v_lugares_ocupados as
select rl.id_lugar, l.id_catamaran, rl.fecha, rl.turno
from public.reserva_lugar rl
join public.lugar l on l.id = rl.id_lugar
where rl.estado = 'confirmada';

-- Resumen de indicadores para las tarjetas del dashboard.
create or replace view public.v_dashboard_resumen with (security_invoker = true) as
select
    (select count(*) from public.reserva
        where fecha = (now() at time zone 'America/Argentina/Salta')::date
          and estado <> 'cancelada')                                       as reservas_hoy,
    (select count(*) from public.reserva
        where estado <> 'cancelada')                                       as reservas_total,
    (select count(*) from public.permiso
        where estado = 'vigente' and fecha_vencimiento >= now())           as permisos_vigentes,
    (select count(*) from public.permiso)                                  as permisos_total,
    (select coalesce(sum(monto),0) from public.pago where estado='aprobado') as ingresos_total,
    (select count(*) from public.usuario where rol = 'pescador')           as usuarios_pescadores,
    (select count(*) from public.alerta_fauna where estado = 'activa')     as alertas_activas;

-- ============================================================================
-- 5. SEGURIDAD A NIVEL DE FILA (Row Level Security)
--    Cada perfil accede únicamente a la información que le corresponde.
-- ============================================================================
alter table public.usuario        enable row level security;
alter table public.especie        enable row level security;
alter table public.catamaran      enable row level security;
alter table public.lugar          enable row level security;
alter table public.reserva        enable row level security;
alter table public.reserva_lugar  enable row level security;
alter table public.permiso        enable row level security;
alter table public.pago           enable row level security;
alter table public.reporte        enable row level security;
alter table public.notificacion   enable row level security;
alter table public.alerta_fauna   enable row level security;
alter table public.tarifa_permiso enable row level security;
alter table public.aviso          enable row level security;
alter table public.gasto          enable row level security;
alter table public.suscripcion_push enable row level security;
alter table public.personal_autorizado enable row level security;   -- sin políticas ni privilegios: sólo SQL Editor (sección 6)

-- ----- USUARIO --------------------------------------------------------------
create policy usuario_select_propio on public.usuario
    for select using (id = auth.uid() or public.es_admin());
create policy usuario_update_propio on public.usuario
    for update using (id = auth.uid() or public.es_admin());
-- El alta la realiza el trigger handle_new_user (SECURITY DEFINER).

-- ----- ESPECIE  (catálogo público de lectura; escritura sólo admin) ---------
create policy especie_select on public.especie
    for select using (true);
create policy especie_admin on public.especie
    for all using (public.es_admin()) with check (public.es_admin());

-- ----- CATAMARAN ------------------------------------------------------------
-- Lectura pública (permite explorar disponibilidad).
create policy catamaran_select on public.catamaran
    for select using (true);
-- El dueño administra sus embarcaciones; el admin, todas. El alta y la cantidad
-- de lugares van por crear_catamaran y cambiar_capacidad (crean los lugares).
create policy catamaran_update on public.catamaran
    for update using (public.es_admin() or (id_propietario = auth.uid() and public.rol_actual() = 'dueno'));
create policy catamaran_delete on public.catamaran
    for delete using (public.es_admin() or (id_propietario = auth.uid() and public.rol_actual() = 'dueno'));

-- ----- LUGAR  (lectura pública; se escriben sólo con las funciones) ----------
create policy lugar_select on public.lugar
    for select using (true);

-- ----- SUSCRIPCION_PUSH  (cada usuario ve sus dispositivos; se escriben con funciones)
create policy suscripcion_push_propia on public.suscripcion_push
    for select using (id_usuario = auth.uid());

-- ----- GASTO  (privados: sólo su dueño, y en sus propios catamaranes) --------
create policy gasto_dueno on public.gasto
    for all using (id_propietario = auth.uid() and public.rol_actual() = 'dueno')
    with check (
        id_propietario = auth.uid() and public.rol_actual() = 'dueno'
        and (id_catamaran is null
             or exists (select 1 from public.catamaran c
                        where c.id = gasto.id_catamaran and c.id_propietario = auth.uid()))
    );

-- ----- RESERVA --------------------------------------------------------------
-- El pescador ve las suyas; el dueño, las de sus catamaranes; admin, todas.
-- Reservas, lugares, permisos y pagos no tienen políticas de escritura: se
-- crean y anulan sólo con crear_reserva_completa y anular_reserva, que
-- validan cada regla (fecha, catamarán, lugares libres, pago y permiso).
create policy reserva_select on public.reserva
    for select using (
        id_usuario = auth.uid()
        or public.es_admin()
        or exists (select 1 from public.catamaran c
                   where c.id = reserva.id_catamaran and c.id_propietario = auth.uid())
    );

-- ----- RESERVA_LUGAR --------------------------------------------------------
create policy reserva_lugar_select on public.reserva_lugar
    for select using (
        public.es_admin()
        or exists (select 1 from public.reserva r
                   where r.id = reserva_lugar.id_reserva and r.id_usuario = auth.uid())
        or exists (select 1 from public.reserva r
                   join public.catamaran c on c.id = r.id_catamaran
                   where r.id = reserva_lugar.id_reserva and c.id_propietario = auth.uid())
    );

-- ----- PERMISO --------------------------------------------------------------
create policy permiso_select on public.permiso
    for select using (id_usuario = auth.uid() or public.es_admin());

-- ----- PAGO -----------------------------------------------------------------
create policy pago_select on public.pago
    for select using (
        public.es_admin()
        or exists (select 1 from public.reserva r
                   where r.id = pago.id_reserva and r.id_usuario = auth.uid())
    );

-- ----- REPORTE  (sólo administradores) --------------------------------------
create policy reporte_admin on public.reporte
    for all using (public.es_admin()) with check (public.es_admin());

-- ----- NOTIFICACION  (cada usuario, las suyas) ------------------------------
create policy notificacion_select on public.notificacion
    for select using (id_usuario = auth.uid());
create policy notificacion_update on public.notificacion
    for update using (id_usuario = auth.uid());

-- ----- TARIFA_PERMISO  (lectura pública; escritura sólo admin) -------------
create policy tarifa_permiso_select on public.tarifa_permiso
    for select using (true);
create policy tarifa_permiso_admin on public.tarifa_permiso
    for all using (public.es_admin()) with check (public.es_admin());

-- ----- AVISO  (lectura admin; se publica sólo con publicar_aviso) ------------
create policy aviso_select on public.aviso
    for select using (public.es_admin());

-- ----- ALERTA_FAUNA  (lectura admin; escritura admin) -----------------------
create policy alerta_fauna_admin on public.alerta_fauna
    for all using (public.es_admin()) with check (public.es_admin());

-- ============================================================================
-- 6. PRIVILEGIOS DE LOS ROLES DE LA API (roles de Supabase)
--    anon (sin sesión) no accede a nada: toda la aplicación requiere ingresar.
--    authenticated recibe lo que usa la aplicación y RLS decide qué filas ve o
--    modifica cada uno. Las vistas usan security_invoker, así que también
--    respetan RLS. Los permisos sobre funciones se dan al final del script
--    (sección 9), cuando ya están todas creadas.
-- ============================================================================
grant usage on schema public to anon, authenticated;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.personal_autorizado from authenticated;

-- Escrituras sólo mediante las funciones de negocio.
revoke insert, update, delete on public.reserva, public.reserva_lugar, public.permiso, public.pago, public.aviso from authenticated;
-- Notificaciones: sólo marcarlas como leídas.
revoke insert, update, delete on public.notificacion from authenticated;
grant  update (leida) on public.notificacion to authenticated;
-- Catamarán: el alta y la capacidad (que define los lugares) van por
-- crear_catamaran y cambiar_capacidad; el propietario no se cambia.
revoke insert, update on public.catamaran from authenticated;
grant  update (nombre, descripcion, precio, habilitacion, estado, fotos) on public.catamaran to authenticated;
revoke insert, update, delete on public.lugar from authenticated;
revoke insert, update, delete on public.suscripcion_push from authenticated;

-- ============================================================================
-- 7. (OPCIONAL) Realtime: descomentar para recibir cambios en vivo en la app.
-- ============================================================================
-- alter publication supabase_realtime add table public.reserva;
-- alter publication supabase_realtime add table public.reserva_lugar;
-- alter publication supabase_realtime add table public.notificacion;

-- ============================================================================
-- 8. REPORTES, RECORDATORIOS, ESTADOS Y ALERTAS DE FAUNA
-- ============================================================================

-- ---- 8.1 Envío de reportes al municipio (HU-009) ----------------------------
create or replace function public.generar_reporte_municipal(p_tipo text default 'general', p_origen text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hoy     date := (now() at time zone 'America/Argentina/Salta')::date;
    v_desde   date;
    v_hasta   date;
    v_periodo text;
    v_dest    text := 'Municipio de Coronel Moldes';
    v_titulo  text;
    v_datos   jsonb;
    v_id      uuid;
    adm       record;
begin
    -- Sin usuario sólo la tarea programada (pg_cron, sin token); desde la app, sólo la administración.
    if auth.uid() is null then
        if auth.role() is not null then
            raise exception 'No autenticado';
        end if;
    elsif not public.es_admin() then
        raise exception 'Sólo un administrador puede enviar reportes al municipio';
    end if;
    if p_origen not in ('manual', 'automatico') then p_origen := 'manual'; end if;

    -- Automático: mes anterior completo. Manual: mes en curso hasta hoy.
    if p_origen = 'automatico' then
        v_desde := (date_trunc('month', v_hoy) - interval '1 month')::date;
    else
        v_desde := date_trunc('month', v_hoy)::date;
    end if;
    v_hasta   := (v_desde + interval '1 month')::date;
    v_periodo := to_char(v_desde, 'YYYY-MM');

    v_titulo := case p_tipo
                    when 'ocupacion' then 'Reporte de ocupación de catamaranes'
                    when 'permisos'  then 'Reporte de permisos emitidos'
                    when 'fauna'     then 'Reporte de presión pesquera por especie'
                    when 'ingresos'  then 'Reporte de ingresos'
                    else 'Reporte general de actividad pesquera'
                end || ' · ' || v_periodo;

    select jsonb_build_object(
        'resumen',               (select to_jsonb(d) from public.v_dashboard_resumen d),
        'permisos_por_especie',  (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.v_permisos_por_especie e),
        'ocupacion_catamaranes', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from public.v_ocupacion_catamaran o),
        'reservas_por_dia',      (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.v_reservas_por_dia r
                                   where r.fecha >= v_desde and r.fecha < v_hasta),
        'generado_en',           now()
    ) into v_datos;

    insert into public.reporte (tipo, titulo, fecha, parametros, datos, generado_por, destinatario, origen, estado_envio)
    values (case when p_tipo in ('ocupacion','permisos','ingresos','fauna','general') then p_tipo else 'general' end,
            v_titulo, v_hoy,
            jsonb_build_object('periodo', v_periodo, 'origen', p_origen, 'destinatario', v_dest),
            v_datos, auth.uid(), v_dest, p_origen, 'enviado')
    returning id into v_id;

    for adm in select id from public.usuario where rol = 'admin_municipal' and activo loop
        insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
        values (adm.id, 'sistema', 'Reporte recibido',
                'El sistema envió "' || v_titulo || '" al ' || v_dest || '.');
    end loop;

    return (select to_jsonb(r) from public.reporte r where r.id = v_id);
end;
$$;

-- ---- 8.2 Recordatorios de salida (HU-011) -----------------------------------
-- Estados al día: permisos vencidos y salidas ya realizadas (completadas).
-- La llama generar_recordatorios, que corre a diario y al abrir la app.
create or replace function public.actualizar_estados()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hoy      date := (now() at time zone 'America/Argentina/Salta')::date;
    v_permisos integer;
    v_reservas integer;
begin
    update public.permiso set estado = 'vencido'
    where estado = 'vigente' and fecha_vencimiento < now();
    get diagnostics v_permisos = row_count;

    update public.reserva set estado = 'completada'
    where estado = 'confirmada' and fecha < v_hoy;
    get diagnostics v_reservas = row_count;

    return jsonb_build_object('permisos_vencidos', v_permisos, 'reservas_completadas', v_reservas);
end;
$$;

create or replace function public.generar_recordatorios(p_solo_usuario boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hoy date := (now() at time zone 'America/Argentina/Salta')::date;
    n integer := 0;
    r record;
begin
    -- Sin usuario sólo la tarea programada; un usuario genera sólo los suyos,
    -- salvo la administración.
    if auth.uid() is null then
        if auth.role() is not null then
            raise exception 'No autenticado';
        end if;
    else
        perform public.exigir_cuenta_activa();
        if not public.es_admin() then
            p_solo_usuario := true;
        end if;
    end if;

    perform public.actualizar_estados();
    for r in
        select res.id, res.id_usuario, res.fecha, res.turno, c.nombre as catamaran
        from public.reserva res
        join public.catamaran c on c.id = res.id_catamaran
        where res.estado = 'confirmada'
          and res.fecha between v_hoy and v_hoy + 1
          and (not p_solo_usuario or res.id_usuario = auth.uid())
          and not exists (select 1 from public.notificacion n
                          where n.id_reserva = res.id and n.tipo = 'recordatorio')
    loop
        insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
        values (r.id_usuario, r.id, 'recordatorio', 'Recordatorio de salida',
                'Tu salida en ' || r.catamaran || ' es ' ||
                case when r.fecha = v_hoy then 'hoy' else 'mañana' end ||
                ' (' || to_char(r.fecha, 'DD/MM/YYYY') || '), turno ' ||
                case when r.turno = 'tarde' then 'tarde' else 'mañana' end ||
                '. Recordá presentar tu permiso digital al embarcar.');
        n := n + 1;
    end loop;
    return n;
end;
$$;

-- ---- 8.3 Alertas de fauna automáticas (HU-015) ---------------------------
-- Al emitirse un permiso, si los permisos del mes de esa especie alcanzan el
-- 80 % del umbral, se registra la alerta y se avisa a la administración municipal.
create or replace function public.actualizar_alerta_fauna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_periodo text := to_char(new.fecha_emision at time zone 'America/Argentina/Salta', 'YYYY-MM');
    v_umbral  integer;
    v_especie text;
    v_cant    integer;
    v_alerta  uuid;
    adm       record;
begin
    if new.id_especie is null then
        return new;
    end if;
    select umbral_permisos, nombre into v_umbral, v_especie
    from public.especie where id = new.id_especie;
    if coalesce(v_umbral, 0) = 0 then
        return new;
    end if;

    select count(*) into v_cant
    from public.permiso p
    where p.id_especie = new.id_especie
      and p.estado <> 'anulado'
      and to_char(p.fecha_emision at time zone 'America/Argentina/Salta', 'YYYY-MM') = v_periodo;

    select id into v_alerta
    from public.alerta_fauna
    where id_especie = new.id_especie and periodo = v_periodo and estado = 'activa'
    limit 1;

    if v_alerta is not null then
        update public.alerta_fauna
        set permisos_emitidos = greatest(permisos_emitidos, v_cant), umbral = v_umbral
        where id = v_alerta;
    elsif v_cant * 100 >= v_umbral * 80 then
        insert into public.alerta_fauna (id_especie, periodo, permisos_emitidos, umbral, estado)
        values (new.id_especie, v_periodo, v_cant, v_umbral, 'activa');
        for adm in select id from public.usuario where rol = 'admin_municipal' and activo loop
            insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
            values (adm.id, 'sistema', 'Alerta de fauna',
                    'Los permisos de ' || v_especie || ' del período ' || v_periodo ||
                    ' llegaron a ' || v_cant || ' sobre un umbral de ' || v_umbral || '.');
        end loop;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_permiso_alerta_fauna on public.permiso;
create trigger trg_permiso_alerta_fauna
    after insert on public.permiso
    for each row execute function public.actualizar_alerta_fauna();

-- ---- 8.4 Avisos de la administración (HU-011) --------------------------------
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

-- ---- 8.5 Cuentas del personal (alta desde el panel del administrador) --------
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

-- ---- 8.7 Avisos al teléfono (Web Push, HU-011) ---------------------------------
-- registrar_push / borrar_push: el usuario habilita o deshabilita un teléfono o
-- navegador. Un mismo dispositivo queda asociado a la última cuenta que lo
-- registró; hasta 10 dispositivos por cuenta.
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := public.exigir_cuenta_activa();
begin
    if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 1000
       or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
        raise exception 'La suscripción para avisos no es válida';
    end if;
    delete from public.suscripcion_push where endpoint = p_endpoint;
    insert into public.suscripcion_push (id_usuario, endpoint, p256dh, auth)
    values (v_uid, p_endpoint, p_p256dh, p_auth);
    delete from public.suscripcion_push
    where id in (select id from public.suscripcion_push where id_usuario = v_uid
                 order by created_at desc offset 10);
end;
$$;

create or replace function public.borrar_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := public.exigir_cuenta_activa();
begin
    delete from public.suscripcion_push where endpoint = p_endpoint and id_usuario = v_uid;
end;
$$;

-- enviar_push (disparador): por cada aviso, aviso de una salida o recordatorio
-- nuevo de un usuario con teléfonos habilitados, pide a la función enviar-push
-- (Edge Function de Supabase) que lo mande. Sólo envía el id: la función lee la
-- notificación con permisos de servicio y la marca como enviada (una sola vez).
-- La llamada es asincrónica (pg_net) y nunca impide crear la notificación.
-- Dirección de la función en el proyecto de Supabase (cambiarla si se usa otro).
create or replace function public.enviar_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if exists (select 1 from public.suscripcion_push where id_usuario = new.id_usuario) then
        perform net.http_post(
            url  := 'https://xllcpqjhvlzqfvfrrbld.supabase.co/functions/v1/enviar-push',
            body := jsonb_build_object('id', new.id));
    end if;
    return null;
exception when others then
    raise warning 'Aviso al teléfono no enviado: %', sqlerrm;
    return null;
end;
$$;

create trigger trg_notificacion_push
    after insert on public.notificacion
    for each row when (new.tipo in ('salida', 'aviso', 'recordatorio'))
    execute function public.enviar_push();

-- pg_net (llamadas HTTP desde la base): incluido en Supabase.
do $$
begin
    create extension if not exists pg_net;
exception when others then
    raise notice 'pg_net no disponible (%). Los avisos al teléfono no se envían.', sqlerrm;
end $$;

-- ---- 8.6 Automatización con pg_cron (opcional) ------------------------------
-- Requiere habilitar la extensión en Supabase -> Database -> Extensions. Si no
-- está disponible, la app genera el reporte mensual al ingresar a Reportes y
-- los recordatorios al ingresar a la pantalla principal.
do $$
begin
    create extension if not exists pg_cron;
    perform cron.schedule('pescacorral-reporte-mensual',   '0 3 1 * *',
        $c$ select public.generar_reporte_municipal('general', 'automatico') $c$);
    perform cron.schedule('pescacorral-recordatorios',     '0 11 * * *',   -- 8:00 de Salta
        $c$ select public.generar_recordatorios(false) $c$);
    raise notice 'pg_cron: tareas programadas.';
exception when others then
    raise notice 'pg_cron no disponible (%). La app cubre la automatización desde el cliente.', sqlerrm;
end $$;

-- ============================================================================
-- 9. PERMISOS DE EJECUCIÓN DE FUNCIONES
--    PostgreSQL y Supabase dan EXECUTE a todos por defecto. Se quita y se da
--    sólo a usuarios con sesión, para las funciones que usa la aplicación (y
--    las que consultan las políticas RLS). Las demás son internas: las usan
--    otras funciones, los disparadores o pg_cron.
-- ============================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
    public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text, jsonb),
    public.registrar_push(text, text, text),
    public.borrar_push(text),
    public.validar_permiso(text, date),
    public.anular_reserva(uuid),
    public.crear_catamaran(text, text, integer, numeric, text, text),
    public.cambiar_capacidad(uuid, integer),
    public.asignar_propietario(uuid, uuid),
    public.avisar_pasajeros(uuid, date, text, text, text),
    public.lista_embarque(uuid, date, text),
    public.es_foto_propia(text),
    public.generar_reporte_municipal(text, text),
    public.generar_recordatorios(boolean),
    public.publicar_aviso(text, text, text, uuid),
    public.crear_cuenta_personal(text, text, text, text, text),
    public.cambiar_clave_personal(uuid, text),
    public.rol_actual(),
    public.es_admin()
to authenticated;

-- ============================================================================
-- 10. FOTOS DE LOS CATAMARANES (Supabase Storage)
--    Depósito público "catamaranes": cualquiera ve las fotos (las muestra la
--    lista de catamaranes); subir, reemplazar y borrar sólo el dueño de cada
--    embarcación y la administración (es_foto_propia). Hasta 2 MB por foto.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catamaranes', 'catamaranes', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists foto_catamaran_select on storage.objects;
drop policy if exists foto_catamaran_insert on storage.objects;
drop policy if exists foto_catamaran_update on storage.objects;
drop policy if exists foto_catamaran_delete on storage.objects;
create policy foto_catamaran_select on storage.objects
    for select to authenticated using (bucket_id = 'catamaranes');
create policy foto_catamaran_insert on storage.objects
    for insert to authenticated with check (bucket_id = 'catamaranes' and public.es_foto_propia(name));
create policy foto_catamaran_update on storage.objects
    for update to authenticated using (bucket_id = 'catamaranes' and public.es_foto_propia(name));
create policy foto_catamaran_delete on storage.objects
    for delete to authenticated using (bucket_id = 'catamaranes' and public.es_foto_propia(name));

-- ============================================================================
--  FIN DEL ESQUEMA · Ejecutá ahora seed.sql para cargar datos de ejemplo.
-- ============================================================================
