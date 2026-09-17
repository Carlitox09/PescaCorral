-- ============================================================================
--  PescaCorral · Migración 002 · Seguridad de acceso, reportes y recordatorios
--  ----------------------------------------------------------------------------
--  Ejecutar en Supabase -> SQL Editor sobre una base creada con la versión
--  anterior de schema.sql. Es idempotente (se puede volver a ejecutar).
--  Si se crea la base desde cero, NO hace falta: schema.sql ya incluye todo.
--
--  Cubre las políticas definidas en el TFG:
--    · Seguridad / HU-002 : bloqueo temporal de la cuenta tras 3 intentos
--                           fallidos consecutivos (tabla intento_acceso).
--    · HU-004             : ocupación de lugares visible para cualquier usuario
--                           autenticado sin revelar quién reservó (vista).
--    · HU-009             : envío de reportes al municipio con registro de
--                           fecha, destinatario y origen (manual/automático).
--    · HU-011             : recordatorios de salida el día previo y el día de
--                           la reserva.
--    · Automatización     : pg_cron (si está disponible) genera el reporte
--                           mensual y los recordatorios diarios.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Intentos de acceso · bloqueo temporal (Seguridad · HU-002 criterio 3)
--    La tabla no es accesible desde la API: sólo a través de las funciones
--    SECURITY DEFINER de abajo, que aplican la política (3 intentos, 15 min).
-- ----------------------------------------------------------------------------
create table if not exists public.intento_acceso (
    email           text primary key,
    intentos        integer     not null default 0,
    ultimo_intento  timestamptz not null default now(),
    bloqueado_hasta timestamptz
);
alter table public.intento_acceso enable row level security;
revoke all on public.intento_acceso from anon, authenticated;

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

-- ----------------------------------------------------------------------------
-- 2. Ocupación de lugares visible para todos (HU-004 · lugares disponibles)
--    La vista se ejecuta con los privilegios del propietario (sin
--    security_invoker), por lo que no está limitada por RLS: expone sólo
--    id_lugar, id_catamaran y fecha, nunca quién realizó la reserva.
-- ----------------------------------------------------------------------------
create or replace view public.v_lugares_ocupados as
select rl.id_lugar, l.id_catamaran, rl.fecha
from public.reserva_lugar rl
join public.lugar l on l.id = rl.id_lugar
where rl.estado = 'confirmada';
grant select on public.v_lugares_ocupados to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Reportes al municipio (HU-009)
-- ----------------------------------------------------------------------------
alter table public.reporte add column if not exists destinatario text not null default 'Municipio de Coronel Moldes';
alter table public.reporte add column if not exists origen       text not null default 'manual';
alter table public.reporte add column if not exists estado_envio text not null default 'enviado';

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

    -- Instantánea de los indicadores (las vistas se consultan como propietario).
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

    -- Aviso a los administradores municipales.
    for adm in select id from public.usuario where rol = 'admin_municipal' and activo loop
        insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
        values (adm.id, 'sistema', 'Reporte recibido',
                'El sistema envió "' || v_titulo || '" al ' || v_dest || '.');
    end loop;

    return (select to_jsonb(r) from public.reporte r where r.id = v_id);
end;
$$;
grant execute on function public.generar_reporte_municipal(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Recordatorios de salida (HU-011 · criterio 2)
-- ----------------------------------------------------------------------------
alter table public.notificacion add column if not exists id_reserva uuid references public.reserva (id) on delete cascade;
create index if not exists idx_notificacion_reserva on public.notificacion (id_reserva);

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

-- ----------------------------------------------------------------------------
-- 5. Automatización con pg_cron (opcional; requiere habilitar la extensión en
--    Supabase -> Database -> Extensions). Si no está disponible, la app genera
--    el reporte mensual al ingresar a Reportes y los recordatorios al ingresar
--    a la pantalla principal.
-- ----------------------------------------------------------------------------
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
--  FIN DE LA MIGRACIÓN 002
-- ============================================================================
