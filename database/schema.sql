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
--  4. La autenticación (email + contraseña) la maneja Supabase Auth: las
--     contraseñas se almacenan cifradas (hash) en auth.users. La tabla
--     "usuario" EXTIENDE ese registro con los datos de perfil y el rol.
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
drop table if exists public.alerta_fauna   cascade;
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

-- ============================================================================
-- 1. TABLAS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USUARIO  (perfil; extiende auth.users de Supabase)
--   La contraseña NO se guarda acá: vive cifrada en auth.users (Supabase Auth).
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
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on column public.catamaran.precio is 'Precio por lugar (asiento) de la embarcación.';

-- ---------------------------------------------------------------------------
-- LUGAR  (asiento físico dentro de un catamarán)
-- ---------------------------------------------------------------------------
create table public.lugar (
    id            uuid primary key default gen_random_uuid(),
    id_catamaran  uuid not null references public.catamaran (id) on delete cascade,
    numero        integer not null check (numero > 0),
    ubicacion     text,                          -- proa | popa | babor | estribor...
    activo        boolean not null default true, -- false = asiento fuera de servicio
    created_at    timestamptz not null default now(),
    unique (id_catamaran, numero)
);

-- ---------------------------------------------------------------------------
-- RESERVA  (HU-005)
-- ---------------------------------------------------------------------------
create table public.reserva (
    id              uuid primary key default gen_random_uuid(),
    id_usuario      uuid not null references public.usuario (id)   on delete cascade,
    id_catamaran    uuid not null references public.catamaran (id) on delete restrict,
    fecha           date not null,
    turno           text not null default 'manana'
                        check (turno in ('manana','tarde')),
    estado          text not null default 'confirmada'
                        check (estado in ('pendiente','confirmada','cancelada','completada')),
    cantidad_lugares integer not null default 0 check (cantidad_lugares >= 0),
    monto_total     numeric(12,2) not null default 0 check (monto_total >= 0),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index idx_reserva_usuario   on public.reserva (id_usuario);
create index idx_reserva_catamaran on public.reserva (id_catamaran);
create index idx_reserva_fecha     on public.reserva (fecha);

-- ---------------------------------------------------------------------------
-- RESERVA_LUGAR  (asientos concretos de una reserva · normaliza reserva.lugares)
--   Incluye "fecha" (denormalizada) para impedir doble reserva del mismo
--   asiento en la misma fecha mediante un índice único parcial.
-- ---------------------------------------------------------------------------
create table public.reserva_lugar (
    id          uuid primary key default gen_random_uuid(),
    id_reserva  uuid not null references public.reserva (id) on delete cascade,
    id_lugar    uuid not null references public.lugar (id)   on delete restrict,
    fecha       date not null,
    estado      text not null default 'confirmada'
                    check (estado in ('confirmada','cancelada')),
    created_at  timestamptz not null default now()
);
create index idx_reserva_lugar_reserva on public.reserva_lugar (id_reserva);
create index idx_reserva_lugar_lugar   on public.reserva_lugar (id_lugar);

-- Un asiento sólo puede estar reservado una vez por fecha (si no está cancelado).
create unique index uq_lugar_fecha_activa
    on public.reserva_lugar (id_lugar, fecha)
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
                    check (tipo in ('reserva','recordatorio','permiso','pago','sistema')),
    titulo      text not null,
    mensaje     text not null,
    leida       boolean not null default false,
    created_at  timestamptz not null default now()
);
create index idx_notificacion_usuario on public.notificacion (id_usuario, leida);
create index idx_notificacion_reserva on public.notificacion (id_reserva);

-- ---------------------------------------------------------------------------
-- INTENTO_ACCESO  (Seguridad · HU-002: bloqueo temporal tras 3 intentos)
--   No es accesible desde la API: sólo a través de las funciones
--   acceso_bloqueado / registrar_intento_acceso (sección 8).
-- ---------------------------------------------------------------------------
create table public.intento_acceso (
    email           text primary key,
    intentos        integer     not null default 0,
    ultimo_intento  timestamptz not null default now(),
    bloqueado_hasta timestamptz
);

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

-- ============================================================================
-- 2. SECUENCIA Y FUNCIONES AUXILIARES
-- ============================================================================

-- Numeración correlativa de permisos: PCC-000001, PCC-000002, ...
create sequence public.seq_numero_permiso start 215 increment 1;

create or replace function public.generar_numero_permiso()
returns text
language sql
as $$
    select 'PCC-' || lpad(nextval('public.seq_numero_permiso')::text, 6, '0');
$$;

-- Devuelve el rol del usuario autenticado. SECURITY DEFINER para evitar
-- recursión de RLS al consultarse desde políticas sobre "usuario".
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select rol from public.usuario where id = auth.uid();
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

-- Mantener updated_at al actualizar filas.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
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
-- Alta automática del perfil al registrarse un usuario en Supabase Auth.
-- Lee los metadatos enviados desde la app (nombre, apellido, telefono, dni, rol).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rol text;
begin
    -- El rol llega en los metadatos de registro, pero los roles administrativos
    -- NO pueden auto-asignarse: sólo se otorgan manualmente (ver README).
    v_rol := coalesce(new.raw_user_meta_data->>'rol', 'pescador');
    if v_rol not in ('pescador', 'dueno') then
        v_rol := 'pescador';
    end if;

    insert into public.usuario (id, nombre, apellido, email, telefono, dni, rol)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'nombre',   split_part(new.email, '@', 1)),
        coalesce(new.raw_user_meta_data->>'apellido', ''),
        new.email,
        new.raw_user_meta_data->>'telefono',
        new.raw_user_meta_data->>'dni',
        v_rol
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================================
-- 3. LÓGICA DE NEGOCIO (RPC)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- crear_reserva_completa
--   Operación atómica que implementa el flujo del TFG (HU-005 + HU-006 + HU-007):
--     1. Verifica que los asientos estén libres para la fecha.
--     2. Crea la reserva.
--     3. Registra los asientos (reserva_lugar).
--     4. Registra el pago (aprobado).
--     5. Genera el permiso digital (con número, código y vencimiento).
--     6. Crea una notificación para el usuario.
--   Devuelve los datos de la reserva y del permiso generado.
--
--   p_lugares: arreglo de UUID de asientos (lugar.id).
-- ----------------------------------------------------------------------------
create or replace function public.crear_reserva_completa(
    p_id_catamaran uuid,
    p_fecha        date,
    p_turno        text,
    p_lugares      uuid[],
    p_metodo_pago  text default 'tarjeta',
    p_tipo_permiso text default 'diario',
    p_id_especie   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid         uuid := auth.uid();
    v_precio      numeric(12,2);
    v_cant        integer := coalesce(array_length(p_lugares, 1), 0);
    v_total       numeric(12,2);
    v_reserva     uuid;
    v_lugar       uuid;
    v_ocupado     integer;
    v_numero      text;
    v_codigo      text;
    v_vence       timestamptz;
    v_permiso     uuid;
    v_nombre      text;
begin
    if v_uid is null then
        raise exception 'No autenticado';
    end if;
    if v_cant = 0 then
        raise exception 'Debe seleccionar al menos un lugar';
    end if;

    select precio into v_precio from public.catamaran where id = p_id_catamaran;
    if v_precio is null then
        raise exception 'El catamarán no existe';
    end if;

    -- Verificar disponibilidad de cada asiento en la fecha pedida.
    foreach v_lugar in array p_lugares loop
        select count(*) into v_ocupado
        from public.reserva_lugar
        where id_lugar = v_lugar
          and fecha    = p_fecha
          and estado   = 'confirmada';
        if v_ocupado > 0 then
            raise exception 'El lugar % ya está ocupado para esa fecha', v_lugar;
        end if;
    end loop;

    v_total := v_precio * v_cant;

    -- 2. Reserva
    insert into public.reserva (id_usuario, id_catamaran, fecha, turno,
                                estado, cantidad_lugares, monto_total)
    values (v_uid, p_id_catamaran, p_fecha, coalesce(p_turno,'manana'),
            'confirmada', v_cant, v_total)
    returning id into v_reserva;

    -- 3. Asientos
    foreach v_lugar in array p_lugares loop
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, estado)
        values (v_reserva, v_lugar, p_fecha, 'confirmada');
    end loop;

    -- 4. Pago
    insert into public.pago (id_reserva, monto, metodo, estado, comprobante)
    values (v_reserva, v_total, coalesce(p_metodo_pago,'tarjeta'), 'aprobado',
            'CMP-' || upper(substr(replace(v_reserva::text,'-',''), 1, 10)));

    -- 5. Permiso digital
    v_numero := public.generar_numero_permiso();
    v_vence  := case coalesce(p_tipo_permiso,'diario')
                    when 'anual'   then (p_fecha + interval '1 year')
                    when 'semanal' then (p_fecha + interval '7 day')
                    else (p_fecha + time '23:59')
                end;
    v_codigo := v_numero || '|' || v_uid::text || '|' || p_fecha::text;

    insert into public.permiso (id_reserva, id_usuario, id_especie, numero, tipo,
                                codigo_qr, fecha_vencimiento, estado)
    values (v_reserva, v_uid, p_id_especie, v_numero, coalesce(p_tipo_permiso,'diario'),
            v_codigo, v_vence, 'vigente')
    returning id into v_permiso;

    -- 6. Notificación
    select nombre into v_nombre from public.usuario where id = v_uid;
    insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
    values (v_uid, 'reserva', 'Reserva confirmada',
            'Tu reserva para el ' || to_char(p_fecha,'DD/MM/YYYY') ||
            ' fue confirmada. Permiso ' || v_numero || '.');

    return jsonb_build_object(
        'reserva_id', v_reserva,
        'permiso_id', v_permiso,
        'numero_permiso', v_numero,
        'monto_total', v_total,
        'codigo_qr', v_codigo,
        'fecha_vencimiento', v_vence
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- anular_reserva: cancela la reserva, libera los asientos y anula el permiso.
-- ----------------------------------------------------------------------------
create or replace function public.anular_reserva(p_id_reserva uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_dueno uuid;
begin
    select id_usuario into v_dueno from public.reserva where id = p_id_reserva;
    if v_dueno is null then
        raise exception 'La reserva no existe';
    end if;
    if v_dueno <> v_uid and not public.es_admin() then
        raise exception 'No autorizado para anular esta reserva';
    end if;

    update public.reserva       set estado = 'cancelada' where id = p_id_reserva;
    update public.reserva_lugar set estado = 'cancelada' where id_reserva = p_id_reserva;
    update public.permiso       set estado = 'anulado'   where id_reserva = p_id_reserva;
end;
$$;

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
select rl.id_lugar, l.id_catamaran, rl.fecha
from public.reserva_lugar rl
join public.lugar l on l.id = rl.id_lugar
where rl.estado = 'confirmada';

-- Resumen de indicadores para las tarjetas del dashboard.
create or replace view public.v_dashboard_resumen with (security_invoker = true) as
select
    (select count(*) from public.reserva
        where fecha = current_date and estado <> 'cancelada')              as reservas_hoy,
    (select count(*) from public.reserva
        where estado <> 'cancelada')                                       as reservas_total,
    (select count(*) from public.permiso
        where estado = 'vigente')                                          as permisos_vigentes,
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
alter table public.intento_acceso enable row level security;   -- sin políticas: sólo vía funciones

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
-- El dueño administra sus embarcaciones; el admin, todas.
create policy catamaran_insert on public.catamaran
    for insert with check (
        public.es_admin()
        or (public.rol_actual() = 'dueno' and id_propietario = auth.uid())
    );
create policy catamaran_update on public.catamaran
    for update using (id_propietario = auth.uid() or public.es_admin());
create policy catamaran_delete on public.catamaran
    for delete using (id_propietario = auth.uid() or public.es_admin());

-- ----- LUGAR ----------------------------------------------------------------
create policy lugar_select on public.lugar
    for select using (true);
create policy lugar_admin on public.lugar
    for all using (
        public.es_admin()
        or exists (select 1 from public.catamaran c
                   where c.id = lugar.id_catamaran and c.id_propietario = auth.uid())
    )
    with check (
        public.es_admin()
        or exists (select 1 from public.catamaran c
                   where c.id = lugar.id_catamaran and c.id_propietario = auth.uid())
    );

-- ----- RESERVA --------------------------------------------------------------
-- El pescador ve/crea las suyas; el dueño ve las de sus catamaranes; admin todas.
create policy reserva_select on public.reserva
    for select using (
        id_usuario = auth.uid()
        or public.es_admin()
        or exists (select 1 from public.catamaran c
                   where c.id = reserva.id_catamaran and c.id_propietario = auth.uid())
    );
create policy reserva_insert on public.reserva
    for insert with check (id_usuario = auth.uid());
create policy reserva_update on public.reserva
    for update using (id_usuario = auth.uid() or public.es_admin());

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
create policy reserva_lugar_insert on public.reserva_lugar
    for insert with check (
        exists (select 1 from public.reserva r
                where r.id = reserva_lugar.id_reserva and r.id_usuario = auth.uid())
    );

-- ----- PERMISO --------------------------------------------------------------
create policy permiso_select on public.permiso
    for select using (id_usuario = auth.uid() or public.es_admin());
create policy permiso_update on public.permiso
    for update using (public.es_admin());

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

-- ----- ALERTA_FAUNA  (lectura admin; escritura admin) -----------------------
create policy alerta_fauna_admin on public.alerta_fauna
    for all using (public.es_admin()) with check (public.es_admin());

-- ============================================================================
-- 6. PERMISOS DE EJECUCIÓN DE FUNCIONES (roles de Supabase)
-- ============================================================================
grant execute on function public.crear_reserva_completa(uuid,date,text,uuid[],text,text,uuid) to authenticated;
grant execute on function public.anular_reserva(uuid) to authenticated;
grant execute on function public.rol_actual() to authenticated, anon;
grant execute on function public.es_admin()   to authenticated, anon;

-- Acceso a tablas, vistas y secuencias para los roles de la API.
-- La seguridad real la imponen las políticas RLS de arriba; estos grants son
-- el modelo estándar de Supabase (y dejan el script self-contained en cualquier
-- PostgreSQL). Las vistas usan security_invoker, así que también respetan RLS.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
revoke all on public.intento_acceso from anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant select on
    public.v_reservas_por_dia,
    public.v_ocupacion_catamaran,
    public.v_permisos_por_especie,
    public.v_dashboard_resumen
to authenticated;
grant select on public.v_lugares_ocupados to anon, authenticated;

-- ============================================================================
-- 7. (OPCIONAL) Realtime: descomentar para recibir cambios en vivo en la app.
-- ============================================================================
-- alter publication supabase_realtime add table public.reserva;
-- alter publication supabase_realtime add table public.reserva_lugar;
-- alter publication supabase_realtime add table public.notificacion;

-- ============================================================================
-- 8. SEGURIDAD DE ACCESO, REPORTES AL MUNICIPIO Y RECORDATORIOS
--    (mismo contenido que database/migrations/002_*.sql)
-- ============================================================================

-- ---- 8.1 Bloqueo temporal tras 3 intentos fallidos (Seguridad · HU-002) ----
create or replace function public.acceso_bloqueado(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r     public.intento_acceso;
    v_min integer := 0;
begin
    select * into r from public.intento_acceso where email = lower(trim(p_email));
    if r.email is null then
        return jsonb_build_object('bloqueado', false, 'intentos', 0, 'minutos_restantes', 0);
    end if;
    if r.bloqueado_hasta is not null and r.bloqueado_hasta > now() then
        v_min := ceil(extract(epoch from (r.bloqueado_hasta - now())) / 60.0);
        return jsonb_build_object('bloqueado', true, 'intentos', r.intentos, 'minutos_restantes', greatest(v_min, 1));
    end if;
    if r.bloqueado_hasta is not null then          -- bloqueo vencido: se reinicia el contador
        delete from public.intento_acceso where email = r.email;
        return jsonb_build_object('bloqueado', false, 'intentos', 0, 'minutos_restantes', 0);
    end if;
    return jsonb_build_object('bloqueado', false, 'intentos', r.intentos, 'minutos_restantes', 0);
end;
$$;

create or replace function public.registrar_intento_acceso(p_email text, p_exitoso boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email   text := lower(trim(p_email));
    v_max     constant integer  := 3;                    -- intentos permitidos
    v_bloqueo constant interval := interval '15 minutes'; -- duración del bloqueo
    r         public.intento_acceso;
begin
    if p_exitoso then
        delete from public.intento_acceso where email = v_email;
        return jsonb_build_object('bloqueado', false, 'intentos', 0, 'minutos_restantes', 0);
    end if;

    insert into public.intento_acceso (email, intentos, ultimo_intento)
    values (v_email, 1, now())
    on conflict (email) do update set
        intentos = case
                     when public.intento_acceso.bloqueado_hasta is not null
                      and public.intento_acceso.bloqueado_hasta > now()  then public.intento_acceso.intentos
                     when public.intento_acceso.bloqueado_hasta is not null then 1
                     else public.intento_acceso.intentos + 1
                   end,
        ultimo_intento  = now(),
        bloqueado_hasta = case
                            when public.intento_acceso.bloqueado_hasta is not null
                             and public.intento_acceso.bloqueado_hasta > now() then public.intento_acceso.bloqueado_hasta
                            else null
                          end
    returning * into r;

    if r.intentos >= v_max and (r.bloqueado_hasta is null or r.bloqueado_hasta <= now()) then
        update public.intento_acceso set bloqueado_hasta = now() + v_bloqueo where email = v_email;
    end if;
    return public.acceso_bloqueado(v_email);
end;
$$;

grant execute on function public.acceso_bloqueado(text)                    to anon, authenticated;
grant execute on function public.registrar_intento_acceso(text, boolean)   to anon, authenticated;

-- ---- 8.2 Envío de reportes al municipio (HU-009) ----------------------------
create or replace function public.generar_reporte_municipal(p_tipo text default 'general', p_origen text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_periodo text := to_char(current_date, 'YYYY-MM');
    v_dest    text := 'Municipio de Coronel Moldes';
    v_titulo  text;
    v_datos   jsonb;
    v_id      uuid;
    adm       record;
begin
    -- Desde la app sólo un administrador puede enviar; pg_cron (sin usuario) genera el automático.
    if auth.uid() is not null and not public.es_admin() then
        raise exception 'Sólo un administrador puede enviar reportes al municipio';
    end if;
    if p_origen not in ('manual', 'automatico') then p_origen := 'manual'; end if;

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
                                   where r.fecha >= date_trunc('month', current_date)),
        'generado_en',           now()
    ) into v_datos;

    insert into public.reporte (tipo, titulo, fecha, parametros, datos, generado_por, destinatario, origen, estado_envio)
    values (case when p_tipo in ('ocupacion','permisos','ingresos','fauna','general') then p_tipo else 'general' end,
            v_titulo, current_date,
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
grant execute on function public.generar_reporte_municipal(text, text) to authenticated;

-- ---- 8.3 Recordatorios de salida (HU-011) -----------------------------------
create or replace function public.generar_recordatorios(p_solo_usuario boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    n integer := 0;
    r record;
begin
    for r in
        select res.id, res.id_usuario, res.fecha, res.turno, c.nombre as catamaran
        from public.reserva res
        join public.catamaran c on c.id = res.id_catamaran
        where res.estado = 'confirmada'
          and res.fecha between current_date and current_date + 1
          and (not p_solo_usuario or res.id_usuario = auth.uid())
          and not exists (select 1 from public.notificacion n
                          where n.id_reserva = res.id and n.tipo = 'recordatorio')
    loop
        insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
        values (r.id_usuario, r.id, 'recordatorio', 'Recordatorio de salida',
                'Tu salida en ' || r.catamaran || ' es ' ||
                case when r.fecha = current_date then 'hoy' else 'mañana' end ||
                ' (' || to_char(r.fecha, 'DD/MM/YYYY') || '), turno ' ||
                case when r.turno = 'tarde' then 'tarde' else 'mañana' end ||
                '. Recordá presentar tu permiso digital al embarcar.');
        n := n + 1;
    end loop;
    return n;
end;
$$;
grant execute on function public.generar_recordatorios(boolean) to authenticated;

-- ---- 8.4 Automatización con pg_cron (opcional) ------------------------------
-- Requiere habilitar la extensión en Supabase -> Database -> Extensions. Si no
-- está disponible, la app genera el reporte mensual al ingresar a Reportes y
-- los recordatorios al ingresar a la pantalla principal.
do $$
begin
    create extension if not exists pg_cron;
    perform cron.schedule('pescacorral-reporte-mensual',   '0 3 1 * *',
        $c$ select public.generar_reporte_municipal('general', 'automatico') $c$);
    perform cron.schedule('pescacorral-recordatorios',     '0 8 * * *',
        $c$ select public.generar_recordatorios(false) $c$);
    perform cron.schedule('pescacorral-limpieza-intentos', '30 3 * * *',
        $c$ delete from public.intento_acceso where ultimo_intento < now() - interval '1 day' $c$);
    raise notice 'pg_cron: tareas programadas.';
exception when others then
    raise notice 'pg_cron no disponible (%). La app cubre la automatización desde el cliente.', sqlerrm;
end $$;

-- ============================================================================
--  FIN DEL ESQUEMA · Ejecutá ahora seed.sql para cargar datos de ejemplo.
-- ============================================================================
