-- ============================================================================
--  PescaCorral · Migración 014 · Permisos por especie y por pasajero
--  Idempotente. Ejecutar en Supabase -> SQL Editor.
--   1. Especies con precio de permiso y estado (activa); se agrega el Dentudo.
--      Las administra el municipio desde la aplicación (Especies y precios).
--   2. El permiso deja de tener tipo (diario, semanal, anual): vale para la
--      fecha de la salida y cuesta la suma de sus especies (permiso_especie).
--      Guarda quién lo usa (titular_nombre, titular_dni) y su importe.
--   3. Cada pasajero de la reserva tiene su permiso: el digital emitido con la
--      reserva (reserva_lugar.id_permiso) o el número del que ya tenía
--      (reserva_lugar.permiso_propio), que se registra sin validarlo.
--   4. Se quitan tarifa_permiso, validar_permiso, permiso.tipo,
--      permiso.id_especie y reserva.id_permiso (los datos se pasan antes).
-- ============================================================================

-- ---- 1. Especies -----------------------------------------------------------------------------
alter table public.especie add column if not exists precio_permiso numeric(12,2) not null default 0;
alter table public.especie add column if not exists activa boolean not null default true;
alter table public.especie drop constraint if exists especie_precio_permiso_check;
alter table public.especie add constraint especie_precio_permiso_check check (precio_permiso >= 0);
alter table public.especie drop constraint if exists especie_nombre_check;
alter table public.especie add constraint especie_nombre_check check (char_length(trim(nombre)) between 2 and 60);

insert into public.especie (nombre, nombre_cientifico, precio_permiso, umbral_permisos, descripcion)
select 'Dentudo', 'Oligosarcus jenynsii', 1000, 300, 'Especie de pesca deportiva frecuente en el embalse.'
where not exists (select 1 from public.especie where lower(nombre) = 'dentudo');

-- Precios de ejemplo (sólo donde todavía no hay precio; después los cambia el municipio).
update public.especie e set precio_permiso = v.precio
from (values ('dorado', 2000), ('pejerrey', 2000), ('dentudo', 1000), ('bagre', 1500), ('carpa', 1000)) as v(nombre, precio)
where lower(e.nombre) = v.nombre and e.precio_permiso = 0;

-- ---- 2. Especies de cada permiso -------------------------------------------------------------
create table if not exists public.permiso_especie (
    id_permiso  uuid not null references public.permiso (id) on delete cascade,
    id_especie  uuid not null references public.especie (id) on delete restrict,
    precio      numeric(12,2) not null check (precio >= 0),
    primary key (id_permiso, id_especie)
);
create index if not exists idx_permiso_especie_especie on public.permiso_especie (id_especie);
alter table public.permiso_especie enable row level security;
drop policy if exists permiso_especie_select on public.permiso_especie;
create policy permiso_especie_select on public.permiso_especie
    for select using (exists (select 1 from public.permiso p where p.id = permiso_especie.id_permiso));

-- ---- 3. Permisos: quién lo usa, importe y especies de los existentes ---------------------------
alter table public.permiso add column if not exists titular_nombre text;
alter table public.permiso add column if not exists titular_dni text;
alter table public.permiso add column if not exists monto numeric(12,2) not null default 0;
alter table public.permiso drop constraint if exists permiso_monto_check;
alter table public.permiso add constraint permiso_monto_check check (monto >= 0);

do $$
begin
    update public.permiso p
       set titular_nombre = trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')),
           titular_dni    = regexp_replace(regexp_replace(coalesce(u.dni, ''), '[^0-9]', '', 'g'),
                                           '^([0-9]{1,2})([0-9]{3})([0-9]{3})$', '\1.\2.\3')
      from public.usuario u
     where u.id = p.id_usuario and p.titular_nombre is null;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'permiso' and column_name = 'id_especie') then
        -- Importe: el que se cobró con la reserva en la que se emitió.
        update public.permiso p set monto = r.monto_permiso
          from public.reserva r
         where r.id = p.id_reserva and p.monto = 0;
        insert into public.permiso_especie (id_permiso, id_especie, precio)
        select p.id, p.id_especie, p.monto from public.permiso p
        where p.id_especie is not null
        on conflict do nothing;
    end if;
end $$;
alter table public.permiso alter column titular_nombre set not null;
alter table public.permiso alter column titular_dni set not null;

-- Vista y alertas de fauna por especie (antes de quitar permiso.id_especie).
create or replace view public.v_permisos_por_especie with (security_invoker = true) as
select e.id,
       e.nombre        as especie,
       e.umbral_permisos,
       count(p.id) filter (where p.estado <> 'anulado') as permisos_emitidos
from public.especie e
left join public.permiso_especie pe on pe.id_especie = e.id
left join public.permiso p on p.id = pe.id_permiso
group by e.id, e.nombre, e.umbral_permisos
order by permisos_emitidos desc;

drop trigger if exists trg_permiso_alerta_fauna on public.permiso;
create or replace function public.actualizar_alerta_fauna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_periodo text;
    v_umbral  integer;
    v_especie text;
    v_cant    integer;
    v_alerta  uuid;
    adm       record;
begin
    select to_char(fecha_emision at time zone 'America/Argentina/Salta', 'YYYY-MM') into v_periodo
    from public.permiso where id = new.id_permiso;
    select umbral_permisos, nombre into v_umbral, v_especie
    from public.especie where id = new.id_especie;
    if coalesce(v_umbral, 0) = 0 then
        return new;
    end if;

    select count(*) into v_cant
    from public.permiso_especie pe
    join public.permiso p on p.id = pe.id_permiso
    where pe.id_especie = new.id_especie
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

drop trigger if exists trg_permiso_especie_alerta on public.permiso_especie;
create trigger trg_permiso_especie_alerta
    after insert on public.permiso_especie
    for each row execute function public.actualizar_alerta_fauna();

-- Funciones que usaban las columnas que se quitan.
drop function if exists public.validar_permiso(text, date);
drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text, jsonb);
drop function if exists public.crear_reserva_completa(uuid, date, text, uuid[], text, text, uuid, text, text);

-- ---- 4. Permiso de cada pasajero -------------------------------------------------------------
alter table public.reserva_lugar add column if not exists id_permiso uuid;
alter table public.reserva_lugar add column if not exists permiso_propio text;
alter table public.reserva_lugar drop constraint if exists reserva_lugar_permiso_propio_check;
alter table public.reserva_lugar add constraint reserva_lugar_permiso_propio_check check (char_length(permiso_propio) between 3 and 40);
alter table public.reserva_lugar drop constraint if exists reserva_lugar_permiso_check;
alter table public.reserva_lugar add constraint reserva_lugar_permiso_check check (id_permiso is null or permiso_propio is null);
alter table public.reserva_lugar drop constraint if exists reserva_lugar_id_permiso_fkey;
alter table public.reserva_lugar add constraint reserva_lugar_id_permiso_fkey foreign key (id_permiso)
    references public.permiso (id) on delete set null;
create index if not exists idx_reserva_lugar_permiso on public.reserva_lugar (id_permiso);

do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'reserva' and column_name = 'id_permiso') then
        -- El lugar del titular (el primero sin acompañante) recibe el permiso de la
        -- reserva: el emitido con ella o, si era uno que ya tenía, su número.
        update public.reserva_lugar rl
           set id_permiso     = case when pe.id_reserva = r.id then pe.id end,
               permiso_propio = case when pe.id_reserva <> r.id then pe.numero end
          from (select distinct on (x.id_reserva) x.id, x.id_reserva
                  from public.reserva_lugar x join public.lugar l on l.id = x.id_lugar
                 where x.pasajero_nombre is null
                 order by x.id_reserva, l.numero) t
          join public.reserva r on r.id = t.id_reserva
          join lateral (select q.id, q.numero, q.id_reserva from public.permiso q
                         where q.id = r.id_permiso or (r.id_permiso is null and q.id_reserva = r.id)
                         order by q.fecha_emision limit 1) pe on true
         where rl.id = t.id and rl.id_permiso is null and rl.permiso_propio is null;
        alter table public.reserva drop column id_permiso;
    end if;
end $$;

-- ---- 5. Se quitan el tipo de permiso, la especie única y las tarifas ---------------------------
alter table public.permiso drop column if exists id_especie;
alter table public.permiso drop column if exists tipo;
alter table public.permiso drop constraint if exists permiso_id_reserva_key;
create index if not exists idx_permiso_reserva on public.permiso (id_reserva);
drop table if exists public.tarifa_permiso;

-- ---- 6. Reserva con un permiso por pasajero, anulación y lista de embarque ---------------------
-- ----------------------------------------------------------------------------
-- crear_reserva_completa
--   Operación atómica que implementa el flujo del TFG (HU-005 + HU-006 + HU-007):
--     1. Valida el catamarán (activo), los asientos (de esa embarcación y en
--        servicio), la fecha y el medio de pago, y que los asientos estén libres
--        en esa fecha y turno.
--     2. Pasajeros, uno por lugar: el primero es el titular (sus datos salen de
--        su perfil); de los demás se piden nombre y DNI, sin DNI repetidos.
--     3. Permiso de cada pasajero: "Ya tengo permiso" registra el número tal
--        como se ingresó, sin validarlo; si no, se emite un permiso digital para
--        las especies elegidas (habilitadas), al precio de cada una, válido para
--        la fecha de la salida.
--     4. Crea la reserva (número RES-), sus asientos, los permisos, el pago
--        aprobado y una notificación para el usuario.
--   Devuelve los números de reserva, de comprobante y de los permisos emitidos.
--
--   p_lugares: asientos (lugar.id); el primero es el del titular.
--   p_pasajeros: uno por lugar, en el mismo orden:
--     {"nombre", "dni", "permiso_propio": "N°"}  o  {"nombre", "dni", "especies": [id, ...]}
--   (en el titular, nombre y DNI se toman del perfil).
-- ----------------------------------------------------------------------------
create or replace function public.crear_reserva_completa(
    p_id_catamaran uuid,
    p_fecha        date,
    p_turno        text,
    p_lugares      uuid[],
    p_metodo_pago  text default 'tarjeta',
    p_pasajeros    jsonb default '[]'::jsonb,
    p_autorizacion text default null
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
    v_hoy         date := (now() at time zone 'America/Argentina/Salta')::date;
    v_cant        integer := coalesce(array_length(p_lugares, 1), 0);
    v_pas         jsonb := coalesce(p_pasajeros, '[]'::jsonb);
    v_vence       timestamptz := (p_fecha + time '23:59') at time zone 'America/Argentina/Salta';
    v_precio      numeric(12,2);
    v_estado_cat  text;
    v_titular     record;
    v_item        jsonb;
    v_quien       text;
    v_nombre      text;
    v_dni         text;
    v_dnis        text[] := '{}';
    v_propio      text;
    v_especies    uuid[];
    v_monto_p     numeric(12,2);
    v_permisos    numeric(12,2) := 0;
    v_total       numeric(12,2);
    v_reserva     uuid;
    v_nro_reserva text;
    v_lugar       uuid;
    v_ocupado     integer;
    v_permiso     uuid;
    v_numero      text;
    v_numeros     text[] := '{}';
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

    -- Pasajeros y permisos: se valida todo antes de escribir.
    if jsonb_typeof(v_pas) <> 'array' or jsonb_array_length(v_pas) <> v_cant then
        raise exception 'Completá los datos y el permiso de cada pasajero (uno por lugar)';
    end if;
    select nombre, apellido, dni into v_titular from public.usuario where id = v_uid;
    for i in 0 .. v_cant - 1 loop
        v_item  := v_pas -> i;
        v_quien := case when i = 0 then 'tu permiso' else 'el permiso del acompañante ' || i end;
        if i = 0 then
            v_dni := regexp_replace(coalesce(v_titular.dni, ''), '[^0-9]', '', 'g');
        else
            v_nombre := trim(coalesce(v_item ->> 'nombre', ''));
            v_dni    := regexp_replace(coalesce(v_item ->> 'dni', ''), '[^0-9]', '', 'g');
            if char_length(v_nombre) not between 3 and 80 then
                raise exception 'Ingresá el nombre y apellido del acompañante %', i;
            end if;
            if char_length(v_dni) not between 7 and 8 then
                raise exception 'El DNI del acompañante % debe tener 7 u 8 dígitos', i;
            end if;
        end if;
        if v_dni <> '' and v_dni = any (v_dnis) then
            raise exception 'Hay un DNI repetido entre los pasajeros';
        end if;
        v_dnis := v_dnis || v_dni;

        v_propio := trim(coalesce(v_item ->> 'permiso_propio', ''));
        if v_propio <> '' then
            if char_length(v_propio) not between 3 and 40 then
                raise exception 'El número de % debe tener entre 3 y 40 caracteres', v_quien;
            end if;
        else
            if jsonb_typeof(v_item -> 'especies') is distinct from 'array'
               or jsonb_array_length(v_item -> 'especies') = 0 then
                raise exception 'Elegí al menos una especie para %, o ingresá el número del que ya tiene', v_quien;
            end if;
            begin
                select array_agg(distinct x::uuid) into v_especies
                from jsonb_array_elements_text(v_item -> 'especies') as x;
            exception when invalid_text_representation then
                raise exception 'Especie inválida en %', v_quien;
            end;
            if cardinality(v_especies) <> jsonb_array_length(v_item -> 'especies') then
                raise exception 'Hay una especie repetida en %', v_quien;
            end if;
            if exists (select 1 from unnest(v_especies) as e(id)
                       left join public.especie s on s.id = e.id
                       where s.id is null or not s.activa) then
                raise exception 'Una de las especies elegidas para % no está habilitada', v_quien;
            end if;
            select sum(precio_permiso) into v_monto_p from public.especie where id = any (v_especies);
            v_permisos := v_permisos + v_monto_p;
        end if;
    end loop;

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

    v_total := v_precio * v_cant + v_permisos;

    insert into public.reserva (id_usuario, id_catamaran, fecha, turno, estado,
                                cantidad_lugares, monto_total, monto_permiso)
    values (v_uid, p_id_catamaran, p_fecha, v_turno, 'confirmada', v_cant, v_total, v_permisos)
    returning id, numero into v_reserva, v_nro_reserva;

    -- Un lugar por pasajero, con su permiso digital (emitido ahora) o el número del propio.
    for i in 0 .. v_cant - 1 loop
        v_item := v_pas -> i;
        if i = 0 then
            v_nombre := trim(coalesce(v_titular.nombre, '') || ' ' || coalesce(v_titular.apellido, ''));
            v_dni    := v_titular.dni;
        else
            v_nombre := trim(v_item ->> 'nombre');
            v_dni    := v_item ->> 'dni';
        end if;
        v_dni := regexp_replace(regexp_replace(coalesce(v_dni, ''), '[^0-9]', '', 'g'),
                                '^([0-9]{1,2})([0-9]{3})([0-9]{3})$', '\1.\2.\3');
        v_propio  := nullif(trim(coalesce(v_item ->> 'permiso_propio', '')), '');
        v_permiso := null;
        if v_propio is null then
            select array_agg(distinct x::uuid) into v_especies
            from jsonb_array_elements_text(v_item -> 'especies') as x;
            select sum(precio_permiso) into v_monto_p from public.especie where id = any (v_especies);
            v_numero := public.generar_numero_permiso();
            insert into public.permiso (id_reserva, id_usuario, titular_nombre, titular_dni, numero,
                                        codigo_qr, monto, fecha_vencimiento, estado)
            values (v_reserva, v_uid, v_nombre, v_dni, v_numero,
                    v_numero || '|' || regexp_replace(v_dni, '[^0-9]', '', 'g') || '|' || p_fecha::text,
                    v_monto_p, v_vence, 'vigente')
            returning id into v_permiso;
            insert into public.permiso_especie (id_permiso, id_especie, precio)
            select v_permiso, s.id, s.precio_permiso from public.especie s where s.id = any (v_especies);
            v_numeros := v_numeros || v_numero;
        end if;
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado,
                                          pasajero_nombre, pasajero_dni, id_permiso, permiso_propio)
        values (v_reserva, p_lugares[i + 1], p_fecha, v_turno, 'confirmada',
                case when i > 0 then v_nombre end, case when i > 0 then v_dni end, v_permiso, v_propio);
    end loop;

    v_comprobante := 'CMP-' || upper(substr(replace(v_reserva::text, '-', ''), 1, 10));
    insert into public.pago (id_reserva, monto, metodo, estado, comprobante, autorizacion)
    values (v_reserva, v_total, v_metodo, 'aprobado', v_comprobante, p_autorizacion);

    insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
    values (v_uid, v_reserva, 'reserva', 'Reserva confirmada',
            'Tu reserva ' || v_nro_reserva || ' para el ' || to_char(p_fecha, 'DD/MM/YYYY') || ' fue confirmada.' ||
            case when cardinality(v_numeros) > 0
                 then ' Permisos emitidos: ' || array_to_string(v_numeros, ', ') || '.' else '' end);

    return jsonb_build_object(
        'reserva_id',     v_reserva,
        'numero_reserva', v_nro_reserva,
        'monto_total',    v_total,
        'monto_permiso',  v_permisos,
        'comprobante',    v_comprobante,
        'permisos',       to_jsonb(v_numeros)
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- anular_reserva: cancela la reserva, libera los asientos y anula los permisos
-- emitidos con ella, salvo el que otra reserva activa declaró como propio.
-- Sólo reservas confirmadas; el pescador, las suyas y de hoy en adelante.
-- ----------------------------------------------------------------------------
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
      and not exists (select 1 from public.reserva_lugar rl
                      join public.reserva x on x.id = rl.id_reserva
                      where upper(rl.permiso_propio) = upper(pe.numero) and x.id <> p_id_reserva
                        and x.estado in ('confirmada', 'completada'));
end;
$$;

drop function if exists public.lista_embarque(uuid, date, text);
create or replace function public.lista_embarque(p_id_catamaran uuid, p_fecha date, p_turno text)
returns table (numero text, lugar integer, pasajero text, dni text, titular boolean, permiso text, permiso_digital boolean)
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
               pe.numero as p_digital, rl.permiso_propio as p_propio,
               row_number() over (partition by r.id, rl.pasajero_nombre is null order by l.numero) as orden
        from public.reserva r
        join public.usuario u        on u.id = r.id_usuario
        join public.reserva_lugar rl on rl.id_reserva = r.id
        join public.lugar l          on l.id = rl.id_lugar
        left join public.permiso pe  on pe.id = rl.id_permiso
        where r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno
          and r.estado in ('confirmada', 'completada')
    )
    select a.nro, a.nlugar,
           case when a.p_nombre is not null then a.p_nombre
                when a.orden = 1 then trim(both ', ' from coalesce(a.t_apellido, '') || ', ' || coalesce(a.t_nombre, '')) end,
           case when a.p_nombre is not null then a.p_dni
                when a.orden = 1 then a.t_dni end,
           (a.p_nombre is null and a.orden = 1),
           coalesce(a.p_digital, a.p_propio),
           a.p_digital is not null
    from asientos a
    order by a.nlugar;
end;
$$;

-- ---- 7. Privilegios ------------------------------------------------------------------------------
revoke all on public.permiso_especie from anon;
revoke insert, update, delete on public.permiso_especie from authenticated;
grant select on public.permiso_especie to authenticated;
revoke delete on public.especie from authenticated;

revoke execute on function public.crear_reserva_completa(uuid, date, text, uuid[], text, jsonb, text),
                           public.anular_reserva(uuid),
                           public.lista_embarque(uuid, date, text),
                           public.actualizar_alerta_fauna()
    from public, anon, authenticated;
grant execute on function public.crear_reserva_completa(uuid, date, text, uuid[], text, jsonb, text),
                          public.anular_reserva(uuid),
                          public.lista_embarque(uuid, date, text)
    to authenticated;

select 'Migración 014 aplicada' as resultado;
