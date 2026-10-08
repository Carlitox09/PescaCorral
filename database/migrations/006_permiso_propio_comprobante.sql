-- ============================================================================
--  PescaCorral · Migración 006
--  Para bases creadas con versiones anteriores de schema.sql. Idempotente.
--
--  1. Tarifas de los permisos de pesca (diario, semanal y anual).
--  2. Reserva con número legible (RES-001001), el permiso que ampara la salida
--     (comprado en la misma operación o uno que el pescador ya tenía) y el
--     importe del permiso separado del de los lugares.
--  3. Pago con el código de autorización de la pasarela.
--  4. Ubicación de cada asiento según el plano del catamarán: numeración en
--     sentido horario desde la proa, primero por estribor (lado derecho visto
--     desde arriba) y luego por babor, en tres zonas (proa, centro y popa).
--  5. validar_permiso y crear_reserva_completa con "Ya tengo permiso" o
--     "Comprar permiso".
--  6. anular_reserva no anula un permiso que ampara otra reserva activa.
-- ============================================================================

-- ---- 1. Tarifas de permisos ------------------------------------------------
create table if not exists public.tarifa_permiso (
    tipo        text primary key check (tipo in ('diario','semanal','anual')),
    precio      numeric(12,2) not null check (precio >= 0),
    updated_at  timestamptz not null default now()
);
insert into public.tarifa_permiso (tipo, precio) values
    ('diario', 5000), ('semanal', 15000), ('anual', 45000)
on conflict (tipo) do nothing;

alter table public.tarifa_permiso enable row level security;
drop policy if exists tarifa_permiso_select on public.tarifa_permiso;
create policy tarifa_permiso_select on public.tarifa_permiso
    for select using (true);
drop policy if exists tarifa_permiso_admin on public.tarifa_permiso;
create policy tarifa_permiso_admin on public.tarifa_permiso
    for all using (public.es_admin()) with check (public.es_admin());
grant select on public.tarifa_permiso to anon, authenticated;
grant insert, update, delete on public.tarifa_permiso to authenticated;

-- ---- 2. Número de reserva, permiso asociado e importe del permiso -----------
create sequence if not exists public.seq_numero_reserva start 1001 increment 1;
grant usage, select on sequence public.seq_numero_reserva to authenticated;

alter table public.reserva add column if not exists numero text;
alter table public.reserva add column if not exists monto_permiso numeric(12,2) not null default 0;
alter table public.reserva add column if not exists id_permiso uuid;
do $$
begin
    alter table public.reserva
        add constraint reserva_id_permiso_fkey foreign key (id_permiso)
        references public.permiso (id) on delete set null;
exception when duplicate_object then null;
end $$;

-- Numera las reservas existentes en orden de creación.
do $$
declare
    x record;
begin
    for x in select id from public.reserva where numero is null order by created_at, id loop
        update public.reserva
        set numero = 'RES-' || lpad(nextval('public.seq_numero_reserva')::text, 6, '0')
        where id = x.id;
    end loop;
end $$;
alter table public.reserva
    alter column numero set default ('RES-' || lpad(nextval('public.seq_numero_reserva')::text, 6, '0'));
alter table public.reserva alter column numero set not null;
create unique index if not exists uq_reserva_numero on public.reserva (numero);

-- Cada reserva existente queda amparada por el permiso que se emitió con ella.
update public.reserva r
set id_permiso = p.id
from public.permiso p
where p.id_reserva = r.id and r.id_permiso is null;

-- ---- 3. Código de autorización del pago -------------------------------------
alter table public.pago add column if not exists autorizacion text;

-- ---- 4. Ubicación de los asientos en el plano --------------------------------
create or replace function public.ubicacion_lugar(p_numero integer, p_total integer)
returns text
language sql
immutable
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

update public.lugar l
set ubicacion = public.ubicacion_lugar(l.numero, t.total)
from (select id_catamaran, count(*)::int as total from public.lugar group by id_catamaran) t
where t.id_catamaran = l.id_catamaran;

-- ---- 5. Validación del permiso propio y reserva completa --------------------
-- Un permiso sirve para una salida si es del mismo titular, no está anulado y
-- la fecha de la salida cae dentro de su vigencia.
create or replace function public.validar_permiso(p_numero text, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid   uuid := auth.uid();
    p       record;
    v_desde date;
    v_hasta date;
begin
    if v_uid is null then
        raise exception 'No autenticado';
    end if;
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
grant execute on function public.validar_permiso(text, date) to authenticated;

drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid);
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
        v_vence  := case v_tipo
                        when 'anual'   then (p_fecha + interval '1 year')
                        when 'semanal' then (p_fecha + interval '7 day')
                        else (p_fecha + time '23:59')
                    end;
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

-- ---- 6. Anulación: un permiso que ampara otra reserva activa se conserva ----
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
    update public.permiso pe    set estado = 'anulado'
    where pe.id_reserva = p_id_reserva
      and not exists (select 1 from public.reserva r
                      where r.id_permiso = pe.id and r.id <> p_id_reserva
                        and r.estado in ('confirmada', 'completada'));
end;
$$;
grant execute on function public.anular_reserva(uuid) to authenticated;

-- Que la API vea las columnas y funciones nuevas sin esperar.
notify pgrst, 'reload schema';
