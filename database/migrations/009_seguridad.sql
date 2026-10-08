-- ============================================================================
--  PescaCorral · Migración 009 · Seguridad
--  Idempotente. Cierra los huecos encontrados en las pruebas de seguridad
--  (database/pruebas_seguridad.sql):
--   1. Sin sesión no se puede ejecutar ninguna función de negocio (antes se
--      podía generar el reporte municipal, anular reservas y generar avisos).
--   2. Las reservas, sus lugares, los permisos y los pagos sólo se crean o
--      modifican mediante las funciones que validan cada regla.
--   3. Una cuenta desactivada pierde de inmediato sus permisos (también los de
--      administración) y sus sesiones se cierran.
--   4. Las cuentas del personal y los roles administrativos se gestionan sólo
--      desde la base: la administración, desde la aplicación, sólo cambia el
--      tipo de cuenta (pescador o dueño) y el estado de las cuentas del público.
--   5. Sólo se anulan reservas confirmadas y, para el pescador, de hoy en adelante.
--   6. Privilegios mínimos para los roles de la API (anon y authenticated).
-- ============================================================================

-- ---- Rol y estado de la cuenta ----------------------------------------------
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select rol from public.usuario where id = auth.uid() and activo;
$$;

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

-- ---- Perfil: qué puede cambiar cada uno -------------------------------------
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

    -- Cuenta ajena: sólo la administración, y sólo el tipo de cuenta y el estado
    -- de las cuentas del público. El personal se gestiona desde la base.
    if old.id <> v_uid then
        if not public.es_admin() then
            raise exception 'No autorizado';
        end if;
        if old.rol not in ('pescador', 'dueno') or new.rol not in ('pescador', 'dueno') then
            raise exception 'Las cuentas del personal y los roles administrativos se gestionan desde la base de datos';
        end if;
        if (new.nombre, new.apellido, new.telefono, new.dni, new.avatar_url, new.perfil_completo)
           is distinct from
           (old.nombre, old.apellido, old.telefono, old.dni, old.avatar_url, old.perfil_completo) then
            raise exception 'La administración sólo puede cambiar el tipo de cuenta y el estado';
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

-- Al desactivar una cuenta se cierran sus sesiones (con ellas caen los refresh tokens).
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

drop trigger if exists trg_usuario_cerrar_sesiones on public.usuario;
create trigger trg_usuario_cerrar_sesiones
    after update of activo on public.usuario
    for each row execute function public.cerrar_sesiones_desactivada();

-- ---- Funciones de negocio ---------------------------------------------------
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

-- search_path fijo (aviso del Security Advisor de Supabase).
alter function public.set_updated_at()                    set search_path = public;
alter function public.generar_numero_permiso()            set search_path = public;
alter function public.ubicacion_lugar(integer, integer)   set search_path = public;

-- ---- Escrituras sólo mediante las funciones ---------------------------------
drop policy if exists reserva_insert       on public.reserva;
drop policy if exists reserva_update       on public.reserva;
drop policy if exists reserva_lugar_insert on public.reserva_lugar;
drop policy if exists permiso_update       on public.permiso;

-- ---- Privilegios de los roles de la API -------------------------------------
-- Sin sesión no se accede a ninguna tabla, vista ni función.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Usuarios con sesión: lo necesario para la aplicación (RLS decide qué filas).
revoke all on public.personal_autorizado from authenticated;
revoke insert, update, delete on public.reserva, public.reserva_lugar, public.permiso, public.pago from authenticated;
revoke insert, update, delete on public.notificacion from authenticated;
grant  update (leida) on public.notificacion to authenticated;
revoke update on public.catamaran from authenticated;
grant  update (nombre, descripcion, precio, habilitacion, estado) on public.catamaran to authenticated;

grant execute on function
    public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text),
    public.validar_permiso(text, date),
    public.anular_reserva(uuid),
    public.generar_reporte_municipal(text, text),
    public.generar_recordatorios(boolean),
    public.rol_actual(),
    public.es_admin()
to authenticated;

-- Resultado: funciones que cada rol de la API puede ejecutar.
select p.proname as funcion,
       has_function_privilege('anon', p.oid, 'execute')          as sin_sesion,
       has_function_privilege('authenticated', p.oid, 'execute') as con_sesion
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by 3 desc, 1;
