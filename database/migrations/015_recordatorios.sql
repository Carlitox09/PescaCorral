-- ============================================================================
--  PescaCorral · Migración 015: preferencia de recordatorios en la base
--  (HU-011 · criterio 3). Idempotente: se puede ejecutar más de una vez.
--
--  Antes la preferencia "Recordatorios de salida" del perfil se guardaba sólo en
--  el teléfono y la tarea diaria (pg_cron) generaba los recordatorios para todas
--  las reservas. Ahora es la columna usuario.recordatorios (por defecto activada):
--  el usuario la cambia desde su perfil, la administración no puede cambiarla y
--  generar_recordatorios omite a quien la desactivó.
--
--  Después de ejecutarla: pruebas_seguridad.sql (161 casos, 0 fallas) y
--  verificar_base.sql (OK).
-- ============================================================================

alter table public.usuario add column if not exists recordatorios boolean not null default true;
comment on column public.usuario.recordatorios is 'Recibir recordatorios de salida (HU-011 · criterio 3)';

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

    -- Cuenta ajena: sólo la administración, y sólo el tipo de cuenta o el estado.
    if old.id <> v_uid then
        if not public.es_admin() then
            raise exception 'No autorizado';
        end if;
        if (new.nombre, new.apellido, new.telefono, new.dni, new.avatar_url, new.perfil_completo, new.recordatorios)
           is distinct from
           (old.nombre, old.apellido, old.telefono, old.dni, old.avatar_url, old.perfil_completo, old.recordatorios) then
            raise exception 'La administración sólo puede cambiar el tipo de cuenta y el estado';
        end if;
        if old.rol in ('pescador', 'dueno') then
            if new.rol not in ('pescador', 'dueno') then
                raise exception 'Los roles administrativos se asignan al dar de alta una cuenta del personal';
            end if;
        else
            if new.rol <> old.rol then
                raise exception 'El rol de una cuenta del personal no se modifica';
            end if;
            if new.activo <> old.activo and public.rol_actual() is distinct from 'admin_sistema' then
                raise exception 'Solo el administrador del sistema puede activar o desactivar cuentas del personal';
            end if;
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
        join public.usuario u on u.id = res.id_usuario
        where res.estado = 'confirmada'
          and u.recordatorios                          -- preferencia del usuario (HU-011 · criterio 3)
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

select 'Migración 015 aplicada' as resultado;
