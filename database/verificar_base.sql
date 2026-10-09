-- ============================================================================
--  PescaCorral · Verificación de la base
--  Sólo lectura: no modifica nada. Ejecutar en Supabase -> SQL Editor.
--
--  Compara la base con schema.sql (tablas, vistas, funciones, disparadores,
--  índices, secuencias, políticas RLS, privilegios de los roles de la API y
--  tareas de pg_cron) y revisa que los datos estén al día y sean coherentes
--  entre sí. Devuelve una fila por cada diferencia, o una sola fila "OK" si
--  todo coincide. Las pruebas de acceso con cada perfil están en
--  pruebas_seguridad.sql.
--
--  Al cambiar schema.sql (objetos nuevos o eliminados) hay que actualizar
--  también las listas de "esperado" de este archivo.
-- ============================================================================
with
esperado_tabla(n) as (values
    ('alerta_fauna'), ('aviso'), ('catamaran'), ('especie'), ('gasto'), ('lugar'), ('notificacion'), ('pago'),
    ('permiso'), ('permiso_especie'), ('personal_autorizado'), ('reporte'), ('reserva'), ('reserva_lugar'),
    ('suscripcion_push'), ('usuario')),
esperado_vista(n) as (values
    ('v_dashboard_resumen'), ('v_lugares_ocupados'), ('v_ocupacion_catamaran'),
    ('v_permisos_por_especie'), ('v_reservas_por_dia')),
esperado_funcion(n, args) as (values
    ('actualizar_alerta_fauna', 0), ('actualizar_estados', 0), ('anular_reserva', 1),
    ('asignar_propietario', 2), ('avisar_pasajeros', 5), ('es_foto_propia', 1), ('lista_embarque', 3),
    ('validar_fotos_catamaran', 0), ('cambiar_capacidad', 2), ('cambiar_clave_personal', 2), ('cerrar_sesiones_desactivada', 0),
    ('clave_segura', 1), ('crear_catamaran', 6), ('crear_cuenta_personal', 5),
    ('crear_reserva_completa', 7), ('registrar_push', 3), ('borrar_push', 1), ('enviar_push', 0), ('es_admin', 0),
    ('exigir_cuenta_activa', 0), ('generar_numero_permiso', 0), ('publicar_aviso', 4),
    ('generar_recordatorios', 1), ('generar_reporte_municipal', 2), ('handle_new_user', 0),
    ('proteger_perfil', 0), ('rol_actual', 0), ('set_updated_at', 0),
    ('ubicacion_lugar', 2)),
-- Funciones que pueden ejecutar los usuarios con sesión (las demás son internas).
esperado_funcion_api(n) as (values
    ('anular_reserva'), ('asignar_propietario'), ('registrar_push'), ('borrar_push'), ('avisar_pasajeros'), ('es_foto_propia'), ('lista_embarque'),
    ('cambiar_capacidad'), ('cambiar_clave_personal'), ('crear_catamaran'),
    ('crear_cuenta_personal'), ('crear_reserva_completa'), ('es_admin'), ('generar_recordatorios'),
    ('generar_reporte_municipal'), ('publicar_aviso'), ('rol_actual')),
esperado_disparador(t, n) as (values
    ('usuario', 'trg_usuario_updated'), ('usuario', 'trg_usuario_proteger'),
    ('usuario', 'trg_usuario_cerrar_sesiones'),
    ('catamaran', 'trg_catamaran_updated'), ('catamaran', 'trg_catamaran_fotos'), ('reserva', 'trg_reserva_updated'),
    ('permiso_especie', 'trg_permiso_especie_alerta'), ('notificacion', 'trg_notificacion_push'), ('auth.users', 'on_auth_user_created')),
esperado_indice(n) as (values
    ('idx_reserva_usuario'), ('idx_reserva_catamaran'), ('idx_reserva_fecha'),
    ('idx_reserva_lugar_reserva'), ('idx_reserva_lugar_lugar'), ('idx_reserva_lugar_permiso'), ('uq_lugar_fecha_turno_activa'),
    ('uq_reserva_numero'), ('idx_permiso_usuario'), ('idx_permiso_reserva'), ('idx_permiso_estado'),
    ('idx_permiso_especie_especie'),
    ('idx_notificacion_usuario'), ('idx_notificacion_reserva'), ('idx_gasto_propietario'), ('idx_suscripcion_push_usuario')),
esperado_secuencia(n) as (values ('seq_numero_permiso'), ('seq_numero_reserva')),
esperado_politica(t, n) as (values
    ('usuario', 'usuario_select_propio'), ('usuario', 'usuario_update_propio'),
    ('especie', 'especie_select'), ('especie', 'especie_admin'),
    ('catamaran', 'catamaran_select'), ('catamaran', 'catamaran_update'),
    ('catamaran', 'catamaran_delete'), ('lugar', 'lugar_select'), ('gasto', 'gasto_dueno'),
    ('reserva', 'reserva_select'), ('reserva_lugar', 'reserva_lugar_select'),
    ('permiso', 'permiso_select'), ('permiso_especie', 'permiso_especie_select'), ('pago', 'pago_select'),
    ('reporte', 'reporte_admin'), ('notificacion', 'notificacion_select'),
    ('notificacion', 'notificacion_update'), ('alerta_fauna', 'alerta_fauna_admin'),
    ('aviso', 'aviso_select'), ('suscripcion_push', 'suscripcion_push_propia')),
esperado_cron(n) as (values ('pescacorral-reporte-mensual'), ('pescacorral-recordatorios')),
-- Fotos de los catamaranes (Supabase Storage): políticas del depósito "catamaranes".
esperado_politica_fotos(n) as (values
    ('foto_catamaran_select'), ('foto_catamaran_insert'), ('foto_catamaran_update'), ('foto_catamaran_delete')),

-- Objetos reales del esquema public (sin los que pertenecen a extensiones).
real_rel as (
    select c.oid, c.relname as n, c.relkind as k
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')),
real_funcion as (
    select p.proname as n, p.pronargs as args,
           has_function_privilege('anon', p.oid, 'execute')          as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
real_disparador as (
    select case when s.nspname = 'public' then c.relname else s.nspname || '.' || c.relname end as t,
           tg.tgname as n
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace s on s.oid = c.relnamespace
    where not tg.tgisinternal
      and (s.nspname = 'public' or (s.nspname = 'auth' and c.relname = 'users'))),
real_indice as (
    select r.n from real_rel r
    where r.k = 'i' and not exists (select 1 from pg_constraint k where k.conindid = r.oid)),
real_politica as (select tablename as t, policyname as n from pg_policies where schemaname = 'public'),
real_cron as (
    select (xpath('/row/jobname/text()', x))[1]::text as n
    from unnest(xpath('/table/row',
        case when to_regclass('cron.job') is not null
             then query_to_xml('select jobname from cron.job', false, false, '')
             else '<table/>'::xml end)) as x),
hoy as (select (now() at time zone 'America/Argentina/Salta')::date as d),

hallazgos(tipo, objeto, detalle) as (
    -- Estructura
    select 'Tabla sobrante', n, 'no está en schema.sql' from real_rel where k in ('r', 'p', 'f') and n not in (select n from esperado_tabla)
    union all select 'Falta tabla', n, '' from esperado_tabla where n not in (select n from real_rel where k in ('r', 'p'))
    union all select 'Vista sobrante', n, 'no está en schema.sql' from real_rel where k in ('v', 'm') and n not in (select n from esperado_vista)
    union all select 'Falta vista', n, '' from esperado_vista where n not in (select n from real_rel where k = 'v')
    union all select 'Función sobrante', f.n, f.args || ' parámetros' from real_funcion f
        where not exists (select 1 from esperado_funcion e where e.n = f.n and e.args = f.args)
    union all select 'Falta función', e.n, e.args || ' parámetros' from esperado_funcion e
        where not exists (select 1 from real_funcion f where f.n = e.n and f.args = e.args)
    union all select 'Disparador sobrante', t || '.' || n, '' from real_disparador
        where (t, n) not in (select t, n from esperado_disparador)
    union all select 'Falta disparador', t || '.' || n, '' from esperado_disparador
        where (t, n) not in (select t, n from real_disparador)
    union all select 'Índice sobrante', n, '' from real_indice where n not in (select n from esperado_indice)
    union all select 'Falta índice', n, '' from esperado_indice where n not in (select n from real_indice)
    union all select 'Secuencia sobrante', n, '' from real_rel where k = 'S' and n not in (select n from esperado_secuencia)
    union all select 'Falta secuencia', n, '' from esperado_secuencia where n not in (select n from real_rel where k = 'S')
    union all select 'Política sobrante', t || '.' || n, '' from real_politica where (t, n) not in (select t, n from esperado_politica)
    union all select 'Falta política', t || '.' || n, '' from esperado_politica where (t, n) not in (select t, n from real_politica)
    union all select 'Tabla sin RLS', n, 'row level security desactivada' from real_rel r
        where k = 'r' and n in (select n from esperado_tabla)
          and not (select relrowsecurity from pg_class where oid = r.oid)
    union all select 'Tarea pg_cron sobrante', n, '' from real_cron where n not in (select n from esperado_cron)
    union all select 'Falta el depósito de fotos', 'catamaranes', 'público, hasta 2 MB, imágenes' where not exists (
        select 1 from storage.buckets where id = 'catamaranes' and public and file_size_limit <= 2097152)
    union all select 'Falta pg_net', 'net.http_post', 'avisos al teléfono: habilitar la extensión pg_net' where not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post')
    union all select 'Falta política de fotos', n, 'storage.objects' from esperado_politica_fotos
        where n not in (select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects')

    -- Privilegios de los roles de la API
    union all select 'Función ejecutable sin sesión', n, 'revocar a anon y public' from real_funcion where anon
    union all select 'Función interna expuesta', n, 'revocar a authenticated' from real_funcion
        where auth and n not in (select n from esperado_funcion_api)
    union all select 'Falta permiso de ejecución', n, 'otorgar a authenticated' from esperado_funcion_api
        where n not in (select n from real_funcion where auth)
    union all select 'Acceso sin sesión', r.n, 'revocar privilegios a anon' from real_rel r
        where r.k in ('r', 'p', 'v', 'm')
          and (has_table_privilege('anon', r.oid, 'select') or has_table_privilege('anon', r.oid, 'insert')
               or has_table_privilege('anon', r.oid, 'update') or has_table_privilege('anon', r.oid, 'delete'))
    union all select 'Escritura directa habilitada', t.n || ' · ' || p.p, 'sólo mediante las funciones de negocio'
        from (values ('reserva'), ('reserva_lugar'), ('permiso'), ('permiso_especie'), ('pago'), ('notificacion'),
                     ('catamaran'), ('lugar'), ('personal_autorizado'), ('aviso'), ('suscripcion_push')) t(n)
        cross join (values ('insert'), ('update'), ('delete')) p(p)
        where has_table_privilege('authenticated', 'public.' || t.n, p.p)
          and not (t.n = 'catamaran' and p.p = 'delete')
    union all select 'Especies borrables', 'especie', 'se desactivan; revocar delete a authenticated'
        where has_table_privilege('authenticated', 'public.especie', 'delete')
    union all select 'Autorizaciones legibles', 'personal_autorizado', 'revocar a authenticated'
        where has_table_privilege('authenticated', 'public.personal_autorizado', 'select')
    union all select 'Políticas de escritura', tablename || '.' || policyname, 'esa tabla se escribe sólo con funciones'
        from pg_policies where schemaname = 'public'
          and tablename in ('reserva', 'reserva_lugar', 'permiso', 'permiso_especie', 'pago', 'aviso', 'lugar', 'suscripcion_push') and cmd <> 'SELECT'

    -- Cuentas
    union all select 'Cuenta sin perfil', u.email, 'está en auth.users y no en usuario' from auth.users u
        where not exists (select 1 from public.usuario p where p.id = u.id)
    union all select 'Cuenta pública con contraseña', p.email, 'el público ingresa sólo con Google' from public.usuario p
        join auth.users u on u.id = p.id
        where p.rol in ('pescador', 'dueno')
          and (coalesce(u.encrypted_password, '') <> ''
               or exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'))
    union all select 'Personal con ingreso por Google', p.email, 'el personal ingresa con usuario y contraseña' from public.usuario p
        where p.rol in ('admin_municipal', 'admin_sistema')
          and exists (select 1 from auth.identities i where i.user_id = p.id and i.provider <> 'email')
    union all select 'Autorización vencida sin usar', usuario, 'personal_autorizado' from public.personal_autorizado
        where not usado and expira < now()

    -- Datos al día y coherentes
    union all select 'Permiso vencido como vigente', numero, to_char(fecha_vencimiento at time zone 'America/Argentina/Salta', 'DD/MM/YYYY HH24:MI')
        from public.permiso where estado = 'vigente' and fecha_vencimiento < now()
    union all select 'Salida pasada sin completar', numero, to_char(fecha, 'DD/MM/YYYY')
        from public.reserva where estado = 'confirmada' and fecha < (select d from hoy)
    union all select 'Lugares de la reserva no coinciden', r.numero, r.cantidad_lugares || ' declarados, ' || count(rl.id) || ' registrados'
        from public.reserva r left join public.reserva_lugar rl on rl.id_reserva = r.id
        group by r.id, r.numero, r.cantidad_lugares having count(rl.id) <> r.cantidad_lugares
    union all select 'Pago distinto del total', r.numero, 'pago ' || pg.monto || ', reserva ' || r.monto_total
        from public.reserva r join public.pago pg on pg.id_reserva = r.id where pg.monto <> r.monto_total
    union all select 'Reserva sin pago', r.numero, '' from public.reserva r
        where not exists (select 1 from public.pago pg where pg.id_reserva = r.id)
    union all select 'Catamarán con lugares distintos de su capacidad', c.nombre, c.capacidad || ' de capacidad, ' || count(l.id) || ' lugares habilitados'
        from public.catamaran c left join public.lugar l on l.id_catamaran = c.id and l.activo
        group by c.id, c.nombre, c.capacidad having count(l.id) <> c.capacidad
    union all select 'Lugar habilitado fuera de la capacidad', c.nombre || ' · lugar ' || l.numero, c.capacidad || ' de capacidad'
        from public.lugar l join public.catamaran c on c.id = l.id_catamaran
        where l.activo and l.numero > c.capacidad
    union all select 'Ubicación de lugar distinta del plano', c.nombre || ' · lugar ' || l.numero, coalesce(l.ubicacion, '(vacía)')
        from public.lugar l join public.catamaran c on c.id = l.id_catamaran
        where l.activo and l.ubicacion is distinct from public.ubicacion_lugar(l.numero, c.capacidad)
    union all select 'Reserva futura en un lugar fuera de servicio', c.nombre || ' · lugar ' || l.numero, to_char(rl.fecha, 'DD/MM/YYYY')
        from public.reserva_lugar rl join public.lugar l on l.id = rl.id_lugar join public.catamaran c on c.id = l.id_catamaran
        where not l.activo and rl.estado = 'confirmada' and rl.fecha >= (select d from hoy)
    union all select 'Foto de otro catamarán', c.nombre, f
        from public.catamaran c cross join unnest(c.fotos) f where f not like c.id::text || '/%'
    union all select 'Gasto en un catamarán ajeno', g.fecha::text || ' · ' || g.categoria, c.nombre
        from public.gasto g join public.catamaran c on c.id = g.id_catamaran
        where c.id_propietario is distinct from g.id_propietario
    union all select 'Alerta de fauna sin respaldo', e.nombre || ' · ' || a.periodo, a.permisos_emitidos || ' registrados'
        from public.alerta_fauna a join public.especie e on e.id = a.id_especie
        where a.permisos_emitidos > (select count(*) from public.permiso_especie pe
            join public.permiso p on p.id = pe.id_permiso
            where pe.id_especie = a.id_especie and p.estado <> 'anulado'
              and to_char(p.fecha_emision at time zone 'America/Argentina/Salta', 'YYYY-MM') = a.periodo)
    union all select 'Reporte automático del mes en curso', titulo, to_char(fecha, 'DD/MM/YYYY')
        from public.reporte where origen = 'automatico' and parametros ->> 'periodo' = to_char(fecha, 'YYYY-MM')
    union all select 'Reporte automático duplicado', parametros ->> 'periodo', count(*) || ' reportes'
        from public.reporte where origen = 'automatico' group by parametros ->> 'periodo' having count(*) > 1
    union all select 'Permiso sin especies', p.numero, '' from public.permiso p
        where not exists (select 1 from public.permiso_especie x where x.id_permiso = p.id)
    union all select 'Importe del permiso distinto de sus especies', p.numero, 'permiso ' || p.monto || ', especies ' || sum(x.precio)
        from public.permiso p join public.permiso_especie x on x.id_permiso = p.id
        group by p.id, p.numero, p.monto having sum(x.precio) <> p.monto
    union all select 'Importe de permisos distinto en la reserva', r.numero, 'reserva ' || r.monto_permiso || ', permisos ' || coalesce(sum(p.monto), 0)
        from public.reserva r left join public.permiso p on p.id_reserva = r.id
        group by r.id, r.numero, r.monto_permiso having coalesce(sum(p.monto), 0) <> r.monto_permiso
    union all select 'Permiso de otra reserva en un lugar', r.numero, p.numero
        from public.reserva_lugar rl join public.reserva r on r.id = rl.id_reserva join public.permiso p on p.id = rl.id_permiso
        where p.id_reserva <> rl.id_reserva
    union all select 'Falta especie habilitada', 'especie', 'sin especies activas no se pueden emitir permisos'
        where not exists (select 1 from public.especie where activa)
)
select tipo, objeto, detalle from hallazgos
union all
select 'OK', 'La base coincide con schema.sql y los datos están al día',
       to_char(now() at time zone 'America/Argentina/Salta', 'DD/MM/YYYY HH24:MI')
where not exists (select 1 from hallazgos)
order by 1, 2;
