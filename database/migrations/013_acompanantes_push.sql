-- ============================================================================
--  PescaCorral · Migración 013 · Acompañantes y avisos al teléfono
--  Idempotente.
--   1. Acompañantes: al reservar más de un lugar se cargan el nombre y el DNI
--      de quien ocupa cada uno (reserva_lugar.pasajero_nombre y pasajero_dni);
--      la lista de embarque sale con un pasajero por lugar.
--   2. Avisos al teléfono (Web Push): tabla suscripcion_push, funciones
--      registrar_push y borrar_push, y el disparador que pide a la función
--      enviar-push (Edge Function) que mande cada aviso, aviso de una salida o
--      recordatorio. Requiere pg_net (se habilita acá).
--   3. Los recordatorios diarios pasan a las 8:00 de Salta.
-- ============================================================================

-- ---- 1. Acompañantes ----------------------------------------------------------------------
alter table public.reserva_lugar add column if not exists pasajero_nombre text;
alter table public.reserva_lugar add column if not exists pasajero_dni text;
alter table public.reserva_lugar drop constraint if exists reserva_lugar_pasajero_nombre_check;
alter table public.reserva_lugar drop constraint if exists reserva_lugar_pasajero_dni_check;
alter table public.reserva_lugar drop constraint if exists reserva_lugar_pasajero_check;
alter table public.reserva_lugar add constraint reserva_lugar_pasajero_nombre_check check (char_length(pasajero_nombre) between 3 and 80);
alter table public.reserva_lugar add constraint reserva_lugar_pasajero_dni_check check (pasajero_dni ~ '^[0-9]{1,2}[.][0-9]{3}[.][0-9]{3}$');
alter table public.reserva_lugar add constraint reserva_lugar_pasajero_check check ((pasajero_nombre is null) = (pasajero_dni is null));

drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text);
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

drop function if exists public.lista_embarque(uuid, date, text);
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

-- ---- 2. Avisos al teléfono -------------------------------------------------------------------
alter table public.notificacion add column if not exists push_enviada timestamptz;
create table if not exists public.suscripcion_push (
    id          uuid primary key default gen_random_uuid(),
    id_usuario  uuid not null references public.usuario (id) on delete cascade,
    endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
    p256dh      text not null check (char_length(p256dh) between 1 and 200),
    auth        text not null check (char_length(auth) between 1 and 100),
    created_at  timestamptz not null default now()
);
create index if not exists idx_suscripcion_push_usuario on public.suscripcion_push (id_usuario);
alter table public.suscripcion_push enable row level security;
drop policy if exists suscripcion_push_propia on public.suscripcion_push;
create policy suscripcion_push_propia on public.suscripcion_push
    for select using (id_usuario = auth.uid());
revoke all on public.suscripcion_push from anon;
revoke insert, update, delete on public.suscripcion_push from authenticated;
grant select on public.suscripcion_push to authenticated;

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

drop trigger if exists trg_notificacion_push on public.notificacion;
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


-- ---- 3. Recordatorios a las 8:00 de Salta ------------------------------------------------------
do $$
begin
    perform cron.schedule('pescacorral-recordatorios', '0 11 * * *',
        $c$ select public.generar_recordatorios(false) $c$);
exception when others then
    raise notice 'pg_cron no disponible (%).', sqlerrm;
end $$;

-- ---- Permisos de ejecución ------------------------------------------------------
revoke execute on function public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text, jsonb),
                           public.lista_embarque(uuid, date, text),
                           public.registrar_push(text, text, text),
                           public.borrar_push(text),
                           public.enviar_push()
    from public, anon, authenticated;
grant execute on function public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text, jsonb),
                          public.lista_embarque(uuid, date, text),
                          public.registrar_push(text, text, text),
                          public.borrar_push(text)
    to authenticated;

select 'Migración 013 aplicada' as resultado;
