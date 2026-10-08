-- ============================================================================
--  PescaCorral · Migración 007 · Mantenimiento y datos al día
--  Para bases creadas con versiones anteriores de schema.sql. Idempotente.
--
--  1. Vencimientos de permisos en hora de Salta (antes se guardaban en UTC y
--     el permiso diario vencía a las 20:59 del día de la salida).
--  2. Estados al día: actualizar_estados() marca los permisos vencidos y las
--     salidas ya realizadas como completadas. La llama generar_recordatorios,
--     que corre a diario con pg_cron y al abrir la pantalla principal.
--  3. Panel: "permisos vigentes" cuenta sólo los que no vencieron y "reservas
--     de hoy" usa la fecha de Salta.
--  4. Objetos de versiones anteriores que ya no se usan (si quedara alguno).
--  5. Datos de prueba o de ejemplo que no corresponden a la operación real.
--
--  Después de ejecutarla, database/verificar_base.sql compara la base con
--  schema.sql y lista cualquier diferencia.
-- ============================================================================

-- ---- 1. Vencimientos en hora de Salta ---------------------------------------
-- Los permisos ya emitidos con la regla anterior (vencimiento a las 23:59 o a
-- las 00:00 en UTC) pasan a esa misma hora en Salta. Los corregidos quedan a
-- las 02:59 o 03:00 UTC, así que una segunda ejecución no los vuelve a mover.
update public.permiso
set fecha_vencimiento = (fecha_vencimiento at time zone 'UTC') at time zone 'America/Argentina/Salta'
where to_char(fecha_vencimiento at time zone 'UTC', 'HH24:MI') in ('23:59', '00:00');

-- Los permisos nuevos se emiten con el vencimiento en hora de Salta.
create or replace function public.crear_reserva_completa(
    p_id_catamaran   uuid,
    p_fecha          date,
    p_turno          text,
    p_lugares        uuid[],
    p_metodo_pago    text default 'tarjeta',
    p_tipo_permiso   text default 'diario',
    p_id_especie     uuid default null,
    p_numero_permiso text default null,
    p_autorizacion   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid         uuid := auth.uid();
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

    foreach v_lugar in array p_lugares loop
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado)
        values (v_reserva, v_lugar, p_fecha, v_turno, 'confirmada');
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
grant execute on function public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text) to authenticated;

-- ---- 2. Estados al día -------------------------------------------------------
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
revoke execute on function public.actualizar_estados() from public, anon, authenticated;

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
grant execute on function public.generar_recordatorios(boolean) to authenticated;

-- ---- 3. Indicadores del panel ------------------------------------------------
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

-- ---- 4. Objetos de versiones anteriores --------------------------------------
drop function if exists public.registrar_intento_acceso(text, boolean);
drop function if exists public.acceso_bloqueado(text);
drop table    if exists public.intento_acceso;
drop index    if exists public.uq_lugar_fecha_activa;
drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid);

-- ---- 5. Datos de prueba o de ejemplo ------------------------------------------
-- Cuenta de prueba con contraseña, de antes del ingreso con Google (sin reservas).
delete from auth.users where email = 'as@as.com';

-- Alertas de fauna sin respaldo en los permisos emitidos (las de ejemplo de seed.sql).
delete from public.alerta_fauna a
where a.permisos_emitidos > (
    select count(*) from public.permiso p
    where p.id_especie = a.id_especie
      and p.estado <> 'anulado'
      and to_char(p.fecha_emision at time zone 'America/Argentina/Salta', 'YYYY-MM') = a.periodo);

-- Reportes automáticos que resumían el mes en curso (lógica anterior a la 004).
delete from public.reporte
where origen = 'automatico' and parametros ->> 'periodo' = to_char(fecha, 'YYYY-MM');

-- Estados al día desde ahora.
select public.actualizar_estados();

notify pgrst, 'reload schema';
