-- ============================================================================
--  PescaCorral · Migración 016: reportes al municipio con los datos del período
--  Idempotente. Ejecutar en Supabase -> SQL Editor (después de la 015).
--
--  El reporte mensual (HU-009) guardaba el resumen y los permisos por especie
--  acumulados desde el inicio, aunque su título indicara un período. Ahora
--  guarda los datos del período del reporte: salidas e ingresos por fecha de
--  la salida, permisos (y por especie) por fecha de emisión, como las alertas
--  de fauna (HU-015), y lugares vendidos por catamarán. Los reportes ya
--  registrados no se modifican. Se quita la vista v_ocupacion_catamaran, que
--  sólo usaba el reporte.
--
--  Después de ejecutarla: pruebas_seguridad.sql (161 casos, 0 fallas) y
--  verificar_base.sql (OK).
-- ============================================================================

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

    -- Los datos son los del período del reporte, no los acumulados: salidas e
    -- ingresos por fecha de la salida; permisos por fecha de emisión (como las
    -- alertas de fauna).
    select jsonb_build_object(
        'periodo', jsonb_build_object('desde', v_desde, 'hasta', v_hasta - 1),
        'resumen', jsonb_build_object(
            'reservas', (select count(*) from public.reserva
                         where estado in ('confirmada','completada') and fecha >= v_desde and fecha < v_hasta),
            'ingresos', (select coalesce(sum(monto_total), 0) from public.reserva
                         where estado in ('confirmada','completada') and fecha >= v_desde and fecha < v_hasta),
            'permisos', (select count(*) from public.permiso
                         where estado <> 'anulado'
                           and (fecha_emision at time zone 'America/Argentina/Salta')::date >= v_desde
                           and (fecha_emision at time zone 'America/Argentina/Salta')::date < v_hasta)),
        'permisos_por_especie', (select coalesce(jsonb_agg(jsonb_build_object('especie', e.nombre,
                                          'umbral_permisos', e.umbral_permisos, 'permisos_emitidos', x.n)
                                          order by x.n desc, e.nombre), '[]'::jsonb)
                                  from public.especie e
                                  cross join lateral (
                                      select count(*) as n from public.permiso_especie pe
                                      join public.permiso p on p.id = pe.id_permiso
                                      where pe.id_especie = e.id and p.estado <> 'anulado'
                                        and (p.fecha_emision at time zone 'America/Argentina/Salta')::date >= v_desde
                                        and (p.fecha_emision at time zone 'America/Argentina/Salta')::date < v_hasta) x),
        'ocupacion_catamaranes', (select coalesce(jsonb_agg(jsonb_build_object('catamaran', c.nombre,
                                          'capacidad', c.capacidad, 'lugares_vendidos', x.n)
                                          order by c.nombre), '[]'::jsonb)
                                  from public.catamaran c
                                  cross join lateral (
                                      select count(*) as n from public.reserva_lugar rl
                                      join public.lugar l on l.id = rl.id_lugar
                                      where l.id_catamaran = c.id and rl.estado = 'confirmada'
                                        and rl.fecha >= v_desde and rl.fecha < v_hasta) x),
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

drop view if exists public.v_ocupacion_catamaran;

select 'Migración 016 aplicada' as resultado;
