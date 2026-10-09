-- ============================================================================
--  PescaCorral · Migración 011 · Perfil del dueño de catamarán
--  Idempotente.
--   1. Finanzas: tabla gasto (gastos del dueño por catamarán o generales de la
--      flota), privada de cada dueño. Con los ingresos por lugares vendidos, la
--      aplicación calcula el resultado (ganancia o pérdida) de cada mes.
--   2. Catamaranes: el alta (con sus lugares) y el cambio de la cantidad de
--      lugares pasan a las funciones crear_catamaran y cambiar_capacidad; los
--      lugares ya no se escriben desde la API. Un lugar quitado que tuvo
--      reservas queda fuera de servicio y no se puede reservar.
-- ============================================================================

-- ---- 1. Gastos del dueño ----------------------------------------------------------
create table if not exists public.gasto (
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
create index if not exists idx_gasto_propietario on public.gasto (id_propietario, fecha);
alter table public.gasto enable row level security;
drop policy if exists gasto_dueno on public.gasto;
create policy gasto_dueno on public.gasto
    for all using (id_propietario = auth.uid() and public.rol_actual() = 'dueno')
    with check (
        id_propietario = auth.uid() and public.rol_actual() = 'dueno'
        and (id_catamaran is null
             or exists (select 1 from public.catamaran c
                        where c.id = gasto.id_catamaran and c.id_propietario = auth.uid()))
    );
revoke all on public.gasto from anon;
grant select, insert, update, delete on public.gasto to authenticated;

-- ---- 2. Catamaranes y lugares -----------------------------------------------------
drop policy if exists catamaran_insert on public.catamaran;
drop policy if exists catamaran_update on public.catamaran;
drop policy if exists catamaran_delete on public.catamaran;
create policy catamaran_update on public.catamaran
    for update using (public.es_admin() or (id_propietario = auth.uid() and public.rol_actual() = 'dueno'));
create policy catamaran_delete on public.catamaran
    for delete using (public.es_admin() or (id_propietario = auth.uid() and public.rol_actual() = 'dueno'));
drop policy if exists lugar_admin on public.lugar;
revoke insert on public.catamaran from authenticated;
revoke insert, update, delete on public.lugar from authenticated;

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

-- La reserva no acepta lugares fuera de servicio.
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
    if exists (select 1 from public.lugar where id = any (p_lugares) and not activo) then
        raise exception 'Uno de los lugares ya no está disponible en ese catamarán. Actualizá el plano';
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

-- ---- Permisos de ejecución ------------------------------------------------------
revoke execute on function public.crear_catamaran(text, text, integer, numeric, text, text),
                           public.cambiar_capacidad(uuid, integer)
    from public, anon, authenticated;
grant execute on function public.crear_catamaran(text, text, integer, numeric, text, text),
                          public.cambiar_capacidad(uuid, integer)
    to authenticated;

select 'Migración 011 aplicada' as resultado;
