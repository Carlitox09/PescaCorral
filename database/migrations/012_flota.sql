-- ============================================================================
--  PescaCorral · Migración 012 · Flota del dueño
--  Idempotente.
--   1. Varios catamaranes por dueño: la administración asigna (o quita) el
--      dueño de cualquier catamarán (asignar_propietario).
--   2. Avisos a los pasajeros de una salida (avisar_pasajeros): notificación
--      de tipo 'salida' para quienes reservaron esa fecha y turno.
--   3. Lista de embarque (lista_embarque): nombre, apellido y DNI de los
--      titulares de las reservas de una salida, sólo para su dueño y la
--      administración.
--   4. Fotos de los catamaranes en Supabase Storage (depósito "catamaranes")
--      y columna catamaran.fotos.
-- ============================================================================

-- ---- 1 a 3. Columnas, tipos de notificación y funciones ----------------------------
alter table public.catamaran add column if not exists fotos text[] not null default '{}';
alter table public.notificacion drop constraint if exists notificacion_tipo_check;
alter table public.notificacion add constraint notificacion_tipo_check
    check (tipo in ('reserva','recordatorio','permiso','pago','sistema','aviso','salida'));

-- ----------------------------------------------------------------------------
-- asignar_propietario (HU-003): la administración asigna (o quita) el dueño de
-- un catamarán; un dueño puede tener varios. Los gastos del dueño anterior en
-- esa embarcación pasan a ser gastos generales suyos.
-- ----------------------------------------------------------------------------
create or replace function public.asignar_propietario(p_id_catamaran uuid, p_id_propietario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := public.exigir_cuenta_activa();
    v_prev uuid;
begin
    if not public.es_admin() then
        raise exception 'Solo la administración asigna el dueño de un catamarán';
    end if;
    select id_propietario into v_prev from public.catamaran where id = p_id_catamaran for update;
    if not found then
        raise exception 'El catamarán no existe';
    end if;
    if p_id_propietario is not null and not exists (
        select 1 from public.usuario where id = p_id_propietario and rol = 'dueno' and activo) then
        raise exception 'Elegí una cuenta activa de dueño de catamarán';
    end if;
    if v_prev is not distinct from p_id_propietario then
        return;
    end if;
    update public.gasto set id_catamaran = null
    where id_catamaran = p_id_catamaran and id_propietario is distinct from p_id_propietario;
    update public.catamaran set id_propietario = p_id_propietario where id = p_id_catamaran;
end;
$$;

-- ----------------------------------------------------------------------------
-- avisar_pasajeros (HU-011): el dueño (o la administración) envía un aviso a
-- todos los que reservaron una salida (catamarán, fecha y turno), por ejemplo
-- si se suspende o si está por zarpar. Llega como notificación de tipo
-- 'salida'; el dueño no ve quiénes la reciben, sólo cuántos. Hasta 10 avisos
-- por salida. Devuelve la cantidad de destinatarios.
-- ----------------------------------------------------------------------------
create or replace function public.avisar_pasajeros(
    p_id_catamaran uuid,
    p_fecha        date,
    p_turno        text,
    p_titulo       text,
    p_mensaje      text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := public.exigir_cuenta_activa();
    v_hoy     date := (now() at time zone 'America/Argentina/Salta')::date;
    v_titulo  text := trim(coalesce(p_titulo, ''));
    v_mensaje text := trim(coalesce(p_mensaje, ''));
    v_prop    uuid;
    v_previos integer;
    v_n       integer;
begin
    select id_propietario into v_prop from public.catamaran where id = p_id_catamaran;
    if not found then
        raise exception 'El catamarán no existe';
    end if;
    if not (public.es_admin() or (v_prop is not distinct from v_uid and public.rol_actual() = 'dueno')) then
        raise exception 'No autorizado para avisar a los pasajeros de este catamarán';
    end if;
    if p_fecha is null or p_fecha < v_hoy then
        raise exception 'Solo se puede avisar sobre salidas de hoy en adelante';
    end if;
    if coalesce(p_turno, '') not in ('manana', 'tarde') then
        raise exception 'Turno inválido';
    end if;
    if char_length(v_titulo) not between 3 and 80 then
        raise exception 'El título debe tener entre 3 y 80 caracteres';
    end if;
    if char_length(v_mensaje) not between 3 and 500 then
        raise exception 'El mensaje debe tener entre 3 y 500 caracteres';
    end if;

    select count(distinct n.created_at) into v_previos
    from public.notificacion n
    join public.reserva r on r.id = n.id_reserva
    where n.tipo = 'salida' and r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno;
    if v_previos >= 10 then
        raise exception 'Ya se enviaron 10 avisos para esta salida';
    end if;

    insert into public.notificacion (id_usuario, id_reserva, tipo, titulo, mensaje)
    select distinct on (r.id_usuario) r.id_usuario, r.id, 'salida', v_titulo, v_mensaje
    from public.reserva r
    join public.usuario u on u.id = r.id_usuario
    where r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno
      and r.estado = 'confirmada' and u.activo
    order by r.id_usuario, r.created_at;
    get diagnostics v_n = row_count;
    if v_n = 0 then
        raise exception 'No hay pasajeros con reserva confirmada en esa salida';
    end if;
    return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- lista_embarque (HU-003): titulares de las reservas de una salida, con su
-- nombre, apellido y DNI y los lugares, para el control de embarque (por
-- ejemplo, ante Prefectura). Sólo el dueño del catamarán y la administración;
-- no entrega correo, teléfono, pago ni permiso.
-- ----------------------------------------------------------------------------
create or replace function public.lista_embarque(p_id_catamaran uuid, p_fecha date, p_turno text)
returns table (numero text, lugares integer[], cantidad_lugares integer, nombre text, apellido text, dni text)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    select r.numero, array_agg(l.numero order by l.numero), r.cantidad_lugares, u.nombre, u.apellido, u.dni
    from public.reserva r
    join public.usuario u        on u.id = r.id_usuario
    join public.reserva_lugar rl on rl.id_reserva = r.id
    join public.lugar l          on l.id = rl.id_lugar
    where r.id_catamaran = p_id_catamaran and r.fecha = p_fecha and r.turno = p_turno
      and r.estado in ('confirmada', 'completada')
    group by r.id, r.numero, r.cantidad_lugares, u.nombre, u.apellido, u.dni
    order by min(l.numero);
end;
$$;

-- ----------------------------------------------------------------------------
-- Fotos de los catamaranes (Supabase Storage, depósito "catamaranes", público).
--   Cada foto se guarda como <id del catamarán>/<archivo>; catamaran.fotos
--   tiene esas rutas en orden (la primera es la portada), hasta 6.
--   es_foto_propia: la usan las políticas del depósito; el dueño sube y borra
--   fotos sólo de sus catamaranes y la administración, de todos.
-- ----------------------------------------------------------------------------
create or replace function public.es_foto_propia(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.catamaran c
        where c.id::text = split_part(coalesce(p_nombre, ''), '/', 1)
          and (public.es_admin() or (c.id_propietario = auth.uid() and public.rol_actual() = 'dueno')));
$$;

create or replace function public.validar_fotos_catamaran()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if coalesce(cardinality(new.fotos), 0) > 6 then
        raise exception 'Un catamarán puede tener hasta 6 fotos';
    end if;
    if exists (select 1 from unnest(new.fotos) f
               where f !~ ('^' || new.id::text || '/[A-Za-z0-9_.-]+$')) then
        raise exception 'Las fotos deben pertenecer a ese catamarán';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_catamaran_fotos on public.catamaran;
create trigger trg_catamaran_fotos
    before insert or update of fotos on public.catamaran
    for each row execute function public.validar_fotos_catamaran();

grant update (fotos) on public.catamaran to authenticated;

-- ---- Permisos de ejecución ------------------------------------------------------
revoke execute on function public.asignar_propietario(uuid, uuid),
                           public.avisar_pasajeros(uuid, date, text, text, text),
                           public.lista_embarque(uuid, date, text),
                           public.es_foto_propia(text),
                           public.validar_fotos_catamaran()
    from public, anon, authenticated;
grant execute on function public.asignar_propietario(uuid, uuid),
                          public.avisar_pasajeros(uuid, date, text, text, text),
                          public.lista_embarque(uuid, date, text),
                          public.es_foto_propia(text)
    to authenticated;

-- ============================================================================
-- 4. Depósito de fotos (Supabase Storage)
--    Depósito público "catamaranes": cualquiera ve las fotos (las muestra la
--    lista de catamaranes); subir, reemplazar y borrar sólo el dueño de cada
--    embarcación y la administración (es_foto_propia). Hasta 2 MB por foto.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catamaranes', 'catamaranes', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists foto_catamaran_select on storage.objects;
drop policy if exists foto_catamaran_insert on storage.objects;
drop policy if exists foto_catamaran_update on storage.objects;
drop policy if exists foto_catamaran_delete on storage.objects;
create policy foto_catamaran_select on storage.objects
    for select to authenticated using (bucket_id = 'catamaranes');
create policy foto_catamaran_insert on storage.objects
    for insert to authenticated with check (bucket_id = 'catamaranes' and public.es_foto_propia(name));
create policy foto_catamaran_update on storage.objects
    for update to authenticated using (bucket_id = 'catamaranes' and public.es_foto_propia(name));
create policy foto_catamaran_delete on storage.objects
    for delete to authenticated using (bucket_id = 'catamaranes' and public.es_foto_propia(name));

select 'Migración 012 aplicada' as resultado;
