-- ============================================================================
--  PescaCorral · Migración 004
--  Para bases creadas con versiones anteriores de schema.sql. Idempotente.
--
--  1. Ocupación por turno: un mismo asiento puede reservarse a la mañana y a la
--     tarde de la misma fecha (antes quedaba bloqueado todo el día).
--  2. Reserva más estricta: el catamarán debe estar activo, los asientos deben
--     pertenecerle y la fecha no puede haber pasado.
--  3. Alertas de fauna automáticas (HU-015): al emitirse un permiso, si los
--     permisos del mes de esa especie alcanzan el 80 % del umbral, se genera
--     la alerta y se avisa a la administración municipal.
--  4. El reporte mensual automático (HU-009) resume el mes que cerró.
-- ============================================================================

-- ---- 1. Turno en reserva_lugar ----------------------------------------------
alter table public.reserva_lugar add column if not exists turno text not null default 'manana';
do $$
begin
    alter table public.reserva_lugar
        add constraint reserva_lugar_turno_check check (turno in ('manana','tarde'));
exception when duplicate_object then null;
end $$;

update public.reserva_lugar rl
set turno = r.turno
from public.reserva r
where r.id = rl.id_reserva and rl.turno is distinct from r.turno;

drop index if exists public.uq_lugar_fecha_activa;
create unique index if not exists uq_lugar_fecha_turno_activa
    on public.reserva_lugar (id_lugar, fecha, turno)
    where (estado = 'confirmada');

create or replace view public.v_lugares_ocupados as
select rl.id_lugar, l.id_catamaran, rl.fecha, rl.turno
from public.reserva_lugar rl
join public.lugar l on l.id = rl.id_lugar
where rl.estado = 'confirmada';
grant select on public.v_lugares_ocupados to anon, authenticated;

-- ---- 2. Reserva atómica con validaciones y turno ---------------------------
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
    v_turno       text := coalesce(p_turno, 'manana');
    v_hoy         date := (now() at time zone 'America/Argentina/Salta')::date;
    v_precio      numeric(12,2);
    v_estado_cat  text;
    v_cant        integer := coalesce(array_length(p_lugares, 1), 0);
    v_total       numeric(12,2);
    v_reserva     uuid;
    v_lugar       uuid;
    v_ocupado     integer;
    v_numero      text;
    v_codigo      text;
    v_vence       timestamptz;
    v_permiso     uuid;
begin
    if v_uid is null then
        raise exception 'No autenticado';
    end if;
    if v_cant = 0 then
        raise exception 'Debe seleccionar al menos un lugar';
    end if;
    if v_turno not in ('manana', 'tarde') then
        raise exception 'Turno inválido';
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

    v_total := v_precio * v_cant;

    insert into public.reserva (id_usuario, id_catamaran, fecha, turno,
                                estado, cantidad_lugares, monto_total)
    values (v_uid, p_id_catamaran, p_fecha, v_turno, 'confirmada', v_cant, v_total)
    returning id into v_reserva;

    foreach v_lugar in array p_lugares loop
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado)
        values (v_reserva, v_lugar, p_fecha, v_turno, 'confirmada');
    end loop;

    insert into public.pago (id_reserva, monto, metodo, estado, comprobante)
    values (v_reserva, v_total, coalesce(p_metodo_pago,'tarjeta'), 'aprobado',
            'CMP-' || upper(substr(replace(v_reserva::text,'-',''), 1, 10)));

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

    insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
    values (v_uid, v_reserva, 'reserva', 'Reserva confirmada',
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

-- ---- 3. Alertas de fauna automáticas (HU-015) ------------------------------
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

-- ---- 4. Reporte al municipio: el automático resume el mes cerrado ----------
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
    -- Desde la app sólo un administrador puede enviar; pg_cron (sin usuario) genera el automático.
    if auth.uid() is not null and not public.es_admin() then
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
grant execute on function public.generar_reporte_municipal(text, text) to authenticated;
