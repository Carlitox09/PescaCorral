-- ============================================================================
--  PescaCorral · Actividad de demostración
--  ----------------------------------------------------------------------------
--  Genera reservas, pagos, permisos, notificaciones y alertas de fauna para que
--  el Panel Municipal y la pantalla de Reportes muestren información durante la
--  presentación del prototipo.
--
--  REQUISITOS
--    1. Haber ejecutado schema.sql y seed.sql (o las migraciones 002 y 003).
--    2. Haber ingresado al menos una vez a la aplicación con la cuenta de
--       Google que se usará en la demostración y completado el perfil.
--
--  CÓMO USARLO
--    Reemplazar el correo de la variable v_email por el de la cuenta de Google
--    de pescador que se usará en la demostración y ejecutar este archivo completo
--    en Supabase -> SQL Editor.
--
--  Genera salidas entre los últimos 30 días y los próximos 3, de modo que
--  existan reservas pasadas, una para hoy y otra para mañana, necesarias para
--  que se generen los recordatorios de salida.
-- ============================================================================

do $$
declare
    v_email    text := 'tu.cuenta@gmail.com';    -- <<< REEMPLAZAR POR TU CUENTA DE GOOGLE
    v_uid      uuid;
    v_cat_id   uuid;
    v_precio   numeric(12,2);
    v_activos  integer;
    v_esp      uuid;
    v_pejerrey uuid;
    v_lugares  uuid[];
    v_reserva  uuid;
    v_lugar    uuid;
    v_fecha    date;
    v_turno    text;
    v_estado   text;
    v_tipo     text;
    v_metodo   text;
    v_cant     integer;
    v_total    numeric(12,2);
    v_numero   text;
    v_vence    timestamptz;
    v_estado_p text;
    v_creadas  integer := 0;
    i          integer;
begin
    select id into v_uid from public.usuario where lower(email) = lower(trim(v_email));
    if v_uid is null then
        raise exception 'No existe una cuenta con el correo %. Ingresá primero a la aplicación con esa cuenta de Google.', v_email;
    end if;

    select count(*) into v_activos from public.catamaran where estado = 'activa';
    if v_activos = 0 then
        raise exception 'No hay catamaranes activos. Ejecutá seed.sql antes que este archivo.';
    end if;

    select id into v_pejerrey from public.especie where nombre = 'Pejerrey';

    for i in 0..33 loop
        v_fecha := current_date - (30 - i);

        -- Catamarán activo, rotando entre los disponibles.
        select c.id, c.precio into v_cat_id, v_precio
        from public.catamaran c
        where c.estado = 'activa'
        order by c.nombre
        offset (i % v_activos)
        limit 1;

        -- Entre 1 y 4 lugares que sigan libres en esa fecha.
        v_cant := 1 + (i % 4);
        select array_agg(l.id) into v_lugares
        from (
            select lu.id, lu.numero
            from public.lugar lu
            where lu.id_catamaran = v_cat_id
              and lu.activo
              and not exists (
                  select 1
                  from public.reserva_lugar rl
                  where rl.id_lugar = lu.id
                    and rl.fecha = v_fecha
                    and rl.estado = 'confirmada')
            order by lu.numero
            limit v_cant
        ) l;

        if v_lugares is null then
            continue;
        end if;

        v_cant  := array_length(v_lugares, 1);
        v_total := v_precio * v_cant;

        -- Estado según la fecha; una de cada doce queda cancelada.
        if i % 12 = 5 then
            v_estado := 'cancelada';
        elsif v_fecha < current_date then
            v_estado := 'completada';
        else
            v_estado := 'confirmada';
        end if;

        v_turno  := case when i % 3 = 0 then 'tarde' else 'manana' end;
        v_tipo   := case when i % 9 = 0 then 'semanal'
                         when i % 17 = 0 then 'anual'
                         else 'diario' end;
        v_metodo := (array['tarjeta','transferencia','mercadopago','efectivo'])[1 + (i % 4)];

        -- Mayoría de permisos de pejerrey, para un monitoreo de fauna realista.
        if i % 4 = 3 then
            select id into v_esp
            from public.especie
            where nombre <> 'Pejerrey'
            order by nombre
            offset (i % 3)
            limit 1;
        else
            v_esp := v_pejerrey;
        end if;

        insert into public.reserva (id_usuario, id_catamaran, fecha, turno, estado, cantidad_lugares, monto_total)
        values (v_uid, v_cat_id, v_fecha, v_turno, v_estado, v_cant, v_total)
        returning id into v_reserva;

        foreach v_lugar in array v_lugares loop
            insert into public.reserva_lugar (id_reserva, id_lugar, fecha, estado)
            values (v_reserva, v_lugar, v_fecha,
                    case when v_estado = 'cancelada' then 'cancelada' else 'confirmada' end);
        end loop;

        insert into public.pago (id_reserva, monto, metodo, estado, comprobante, fecha_pago)
        values (v_reserva, v_total, v_metodo,
                case when v_estado = 'cancelada' then 'rechazado' else 'aprobado' end,
                'CMP-' || upper(substr(replace(v_reserva::text, '-', ''), 1, 10)),
                v_fecha + time '10:05');

        v_numero := public.generar_numero_permiso();
        v_vence  := case v_tipo
                        when 'anual'   then (v_fecha + interval '1 year')
                        when 'semanal' then (v_fecha + interval '7 day')
                        else (v_fecha + time '23:59')
                    end;
        v_estado_p := case
                        when v_estado = 'cancelada' then 'anulado'
                        when v_vence < now()        then 'vencido'
                        else 'vigente'
                      end;

        insert into public.permiso (id_reserva, id_usuario, id_especie, numero, tipo, codigo_qr,
                                    fecha_emision, fecha_vencimiento, estado)
        values (v_reserva, v_uid, v_esp, v_numero, v_tipo,
                v_numero || '|' || v_uid::text || '|' || v_fecha::text,
                v_fecha + time '10:05', v_vence, v_estado_p);

        if v_estado <> 'cancelada' and v_fecha >= current_date then
            insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
            values (v_uid, v_reserva, 'reserva', 'Reserva confirmada',
                    'Tu reserva del ' || to_char(v_fecha, 'DD/MM/YYYY') ||
                    ' fue confirmada. Permiso ' || v_numero || '.');
        end if;

        v_creadas := v_creadas + 1;
    end loop;

    -- Alertas de fauna del período en curso, con valores cercanos al umbral.
    delete from public.alerta_fauna where periodo = to_char(current_date, 'YYYY-MM');
    insert into public.alerta_fauna (id_especie, periodo, permisos_emitidos, umbral, estado)
    select e.id,
           to_char(current_date, 'YYYY-MM'),
           (e.umbral_permisos * 0.93)::integer,
           e.umbral_permisos,
           'activa'
    from public.especie e
    where e.nombre in ('Pejerrey', 'Dorado', 'Bagre');

    raise notice 'Actividad generada: % salidas para %.', v_creadas, v_email;
end $$;

-- Comprobación de lo generado.
select (select count(*) from public.reserva)                               as reservas,
       (select count(*) from public.permiso)                               as permisos,
       (select count(*) from public.permiso where estado = 'vigente')      as permisos_vigentes,
       (select coalesce(sum(monto), 0) from public.pago
         where estado = 'aprobado')                                        as ingresos,
       (select count(*) from public.alerta_fauna where estado = 'activa')  as alertas_activas;

-- ----------------------------------------------------------------------------
--  Para volver a empezar: borra toda la actividad, sin tocar catamaranes,
--  especies ni cuentas de usuario. Descomentar y ejecutar.
-- ----------------------------------------------------------------------------
-- delete from public.notificacion;
-- delete from public.permiso;
-- delete from public.pago;
-- delete from public.reserva_lugar;
-- delete from public.reserva;
-- delete from public.alerta_fauna;
