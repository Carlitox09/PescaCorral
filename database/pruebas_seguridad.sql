-- ============================================================================
--  PescaCorral · Pruebas de seguridad
--  Ejecutar en Supabase -> SQL Editor. No deja datos: crea cuentas y registros
--  de prueba, intenta cada operación con la identidad de cada perfil (como lo
--  hace la API con el token de la sesión: rol "anon" o "authenticated" y el id
--  del usuario) y al terminar revierte todo. Lo único que no se revierte es el
--  avance de las secuencias de números de reserva y de permiso.
--
--  Devuelve una fila por caso (perfil, operación, resultado esperado, resultado
--  obtenido y OK / FALLA) y una fila final con el resumen.
--
--  Perfiles de prueba: sin sesión, pescadores A y B, dueño D (con su
--  catamarán), municipio M, administrador del sistema S, pescador desactivado X,
--  municipio desactivado MX y el servicio de ingreso (altas de cuentas).
-- ============================================================================

create temp table if not exists _pruebas_seguridad (
    n integer, perfil text, caso text, esperado text, obtenido text, resultado text);
truncate _pruebas_seguridad;

-- Ejecuta una sentencia como el perfil indicado y la revierte siempre.
--   p_uid nulo: sin sesión (rol anon).
--   p_tipo: 'lectura' cuenta las filas visibles; 'cambio' cuenta las filas
--   afectadas; 'servicio' corre sin suplantar a nadie (como el servicio de Auth).
--   p_control: consulta opcional que se corre después, ya sin suplantar, para
--   comprobar el efecto real; su número reemplaza al de filas.
create or replace function pg_temp.intentar(p_uid uuid, p_sql text, p_tipo text, p_control text default null)
returns text
language plpgsql
as $f$
declare
    v_n   integer;
    v_rol text := case when p_uid is null then 'anon' else 'authenticated' end;
begin
    begin
        if p_tipo <> 'servicio' then
            perform set_config('request.jwt.claims',
                               json_build_object('sub', p_uid, 'role', v_rol)::text, true);
            execute 'set local role ' || v_rol;
        end if;
        if p_tipo = 'lectura' then
            execute 'select count(*) from (' || p_sql || ') q' into v_n;
        else
            execute p_sql;
            get diagnostics v_n = row_count;
        end if;
        if p_control is not null then
            execute 'reset role';
            perform set_config('request.jwt.claims', '{}', true);
            execute p_control into v_n;
        end if;
        raise exception using errcode = 'PC000', message = coalesce(v_n, 0)::text;
    exception when others then
        if sqlstate = 'PC000' then
            return 'filas:' || sqlerrm;
        end if;
        return 'error:' || sqlerrm;
    end;
end;
$f$;

do $$
declare
    hoy   date := (now() at time zone 'America/Argentina/Salta')::date;
    a     uuid := gen_random_uuid();   -- pescador A
    b     uuid := gen_random_uuid();   -- pescador B
    d     uuid := gen_random_uuid();   -- dueño D
    m     uuid := gen_random_uuid();   -- municipio M
    s     uuid := gen_random_uuid();   -- administrador del sistema S
    x     uuid := gen_random_uuid();   -- pescador desactivado X
    mx    uuid := gen_random_uuid();   -- municipio desactivado MX
    cat_d uuid := gen_random_uuid();   -- catamarán del dueño D
    cat_o uuid := gen_random_uuid();   -- catamarán de otro propietario
    l1    uuid := gen_random_uuid();
    l2    uuid := gen_random_uuid();
    l3    uuid := gen_random_uuid();
    o1    uuid := gen_random_uuid();
    ra1   uuid := gen_random_uuid();   -- reserva de A para mañana (con permiso)
    ra2   uuid := gen_random_uuid();   -- salida de A que ya pasó
    rb1   uuid := gen_random_uuid();   -- reserva de B para mañana
    pa1   uuid := gen_random_uuid();   -- permiso de A
    dom   text := '@pruebas.pescacorral.invalid';
    clave text := 'Clave-Segura-2026';
    alta  text := 'select public.crear_cuenta_personal(%L, ''Prueba'', ''Nueva'', ''admin_municipal'', %L)';
    avisar text := 'select public.publicar_aviso(''Aviso de prueba'', ''Mensaje de prueba para los usuarios.'', %L, %L)';
    reservar text := 'select public.crear_reserva_completa(p_id_catamaran => %L, p_fecha => %L, '
                     'p_turno => %L, p_lugares => array[%L]::uuid[], p_metodo_pago => ''efectivo'', '
                     'p_tipo_permiso => ''diario'')';
    con_sesion boolean := true;
    v_res jsonb := '[]';
    c     record;
begin
    perform set_config('request.jwt.claims', '{}', true);
    begin
        -- ---- Datos de prueba (se revierten al final) ---------------------------
        -- Cuentas como las crea el ingreso con Google; el disparador crea el perfil.
        insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                                email_confirmed_at, created_at, updated_at)
        select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
               '{"provider":"google","providers":["google"]}'::jsonb,
               jsonb_build_object('full_name', u.nombre), now(), now(), now()
        from (values (a, 'prueba.a' || dom, 'Prueba A'), (b, 'prueba.b' || dom, 'Prueba B'),
                     (d, 'prueba.d' || dom, 'Prueba D'), (m, 'pc-prueba-m@pescacorral.example.com', 'Prueba M'),
                     (s, 'prueba.s' || dom, 'Prueba S'), (x, 'prueba.x' || dom, 'Prueba X'),
                     (mx, 'prueba.mx' || dom, 'Prueba MX')) u(id, email, nombre);

        update public.usuario u
           set rol = v.rol, activo = v.activo, perfil_completo = true, dni = v.dni, telefono = '3870000000'
          from (values (a, 'pescador', true, '90000001'), (b, 'pescador', true, '90000002'),
                       (d, 'dueno', true, '90000003'), (m, 'admin_municipal', true, '90000004'),
                       (s, 'admin_sistema', true, '90000005'), (x, 'pescador', false, '90000006'),
                       (mx, 'admin_municipal', false, '90000007')) v(id, rol, activo, dni)
         where u.id = v.id;

        insert into public.catamaran (id, id_propietario, nombre, capacidad, precio, habilitacion, estado)
        values (cat_d, d, 'Prueba D', 3, 1000, 'HAB-PRUEBA-1', 'activa'),
               (cat_o, null, 'Prueba O', 1, 1000, 'HAB-PRUEBA-2', 'activa');
        insert into public.lugar (id, id_catamaran, numero, ubicacion)
        values (l1, cat_d, 1, public.ubicacion_lugar(1, 3)), (l2, cat_d, 2, public.ubicacion_lugar(2, 3)),
               (l3, cat_d, 3, public.ubicacion_lugar(3, 3)), (o1, cat_o, 1, public.ubicacion_lugar(1, 1));

        insert into public.reserva (id, numero, id_usuario, id_catamaran, fecha, turno, estado,
                                    cantidad_lugares, monto_total, monto_permiso)
        values (ra1, 'RES-PRUEBA-A1', a, cat_d, hoy + 1, 'manana', 'confirmada', 1, 6000, 5000),
               (ra2, 'RES-PRUEBA-A2', a, cat_d, hoy - 3, 'manana', 'completada', 1, 6000, 5000),
               (rb1, 'RES-PRUEBA-B1', b, cat_d, hoy + 1, 'tarde',  'confirmada', 1, 6000, 5000);
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado)
        values (ra1, l1, hoy + 1, 'manana', 'confirmada'),
               (ra2, l1, hoy - 3, 'manana', 'confirmada'),
               (rb1, l1, hoy + 1, 'tarde',  'confirmada');
        insert into public.pago (id_reserva, monto, metodo, estado, comprobante)
        values (ra1, 6000, 'efectivo', 'aprobado', 'CMP-PRUEBA-A1'),
               (ra2, 6000, 'efectivo', 'aprobado', 'CMP-PRUEBA-A2'),
               (rb1, 6000, 'efectivo', 'aprobado', 'CMP-PRUEBA-B1');
        insert into public.permiso (id, id_reserva, id_usuario, numero, tipo, codigo_qr, fecha_vencimiento, estado)
        values (pa1, ra1, a, 'PCC-PRUEBA-A1', 'diario', 'PCC-PRUEBA-A1',
                ((hoy + 1) + time '23:59') at time zone 'America/Argentina/Salta', 'vigente');
        update public.reserva set id_permiso = pa1 where id = ra1;
        insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
        values (a, 'sistema', 'Aviso de prueba', 'Aviso de prueba');

        -- Una sesión abierta de B, para comprobar que se cierra al desactivarlo.
        begin
            insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), b, now(), now());
        exception when others then
            con_sesion := false;
        end;

        -- ---- Casos ----------------------------------------------------------------
        for c in
            select * from (values
            -- Sin sesión (sólo la clave pública de la aplicación)
            ('Sin sesión', null::uuid, 'Leer perfiles de usuario', 'rechazo', 'select * from public.usuario', 'lectura', null::text),
            ('Sin sesión', null, 'Leer reservas', 'rechazo', 'select * from public.reserva', 'lectura', null),
            ('Sin sesión', null, 'Leer permisos', 'rechazo', 'select * from public.permiso', 'lectura', null),
            ('Sin sesión', null, 'Leer pagos', 'rechazo', 'select * from public.pago', 'lectura', null),
            ('Sin sesión', null, 'Leer autorizaciones del personal', 'rechazo', 'select * from public.personal_autorizado', 'lectura', null),
            ('Sin sesión', null, 'Ver la ocupación de lugares', 'rechazo', 'select * from public.v_lugares_ocupados', 'lectura', null),
            ('Sin sesión', null, 'Enviar el reporte municipal', 'rechazo', 'select public.generar_reporte_municipal(''general'', ''manual'')', 'cambio', null),
            ('Sin sesión', null, 'Anular una reserva', 'rechazo', format('select public.anular_reserva(%L)', ra1), 'cambio', null),
            ('Sin sesión', null, 'Generar avisos para todos los usuarios', 'rechazo', 'select public.generar_recordatorios(false)', 'cambio', null),
            ('Sin sesión', null, 'Reservar', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', l2), 'cambio', null),
            ('Sin sesión', null, 'Publicar un aviso', 'rechazo', format(avisar, 'todos', null), 'cambio', null),
            ('Sin sesión', null, 'Cargar un catamarán', 'rechazo', 'insert into public.catamaran (nombre, capacidad, precio) values (''Intruso'', 1, 0)', 'cambio', null),

            -- Pescador B sobre los datos del pescador A
            ('Pescador B', b, 'Leer la reserva de otro pescador', 'rechazo', format('select * from public.reserva where id = %L', ra1), 'lectura', null),
            ('Pescador B', b, 'Leer el permiso de otro pescador', 'rechazo', format('select * from public.permiso where id = %L', pa1), 'lectura', null),
            ('Pescador B', b, 'Leer el pago de otro pescador', 'rechazo', format('select * from public.pago where id_reserva = %L', ra1), 'lectura', null),
            ('Pescador B', b, 'Leer los lugares de otro pescador', 'rechazo', format('select * from public.reserva_lugar where id_reserva = %L', ra1), 'lectura', null),
            ('Pescador B', b, 'Leer las notificaciones de otro pescador', 'rechazo', format('select * from public.notificacion where id_usuario = %L', a), 'lectura', null),
            ('Pescador B', b, 'Leer el perfil de otro pescador', 'rechazo', format('select * from public.usuario where id = %L', a), 'lectura', null),
            ('Pescador B', b, 'Modificar el perfil de otro pescador', 'rechazo', format('update public.usuario set telefono = ''0'' where id = %L', a), 'cambio', null),
            ('Pescador B', b, 'Modificar la reserva de otro pescador', 'rechazo', format('update public.reserva set estado = ''cancelada'' where id = %L', ra1), 'cambio', null),
            ('Pescador B', b, 'Anular la reserva de otro pescador', 'rechazo', format('select public.anular_reserva(%L)', ra1), 'cambio', null),
            ('Pescador B', b, 'Usar el permiso de otro pescador', 'rechazo', format('select public.validar_permiso(''PCC-PRUEBA-A1'', %L)', hoy + 1), 'cambio', null),

            -- Pescador A: sus datos y las reglas de negocio
            ('Pescador A', a, 'Ver su reserva, su permiso y su pago', 'permitido', format('select 1 from public.reserva r join public.permiso p on p.id = r.id_permiso join public.pago g on g.id_reserva = r.id where r.id = %L', ra1), 'lectura', null),
            ('Pescador A', a, 'Reservar y pagar (flujo normal)', 'permitido', format(reservar, cat_d, hoy + 1, 'tarde', l2), 'cambio', null),
            ('Pescador A', a, 'Reservar una fecha pasada', 'rechazo', format(reservar, cat_d, hoy - 1, 'tarde', l2), 'cambio', null),
            ('Pescador A', a, 'Reservar un lugar de otro catamarán', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', o1), 'cambio', null),
            ('Pescador A', a, 'Reservar un lugar ocupado', 'rechazo', format(reservar, cat_d, hoy + 1, 'manana', l1), 'cambio', null),
            ('Pescador A', a, 'Crear una reserva sin pagar (directo en la tabla)', 'rechazo', format('insert into public.reserva (id_usuario, id_catamaran, fecha, turno, cantidad_lugares, monto_total) values (%L, %L, %L, ''manana'', 1, 0)', a, cat_d, hoy + 2), 'cambio', null),
            ('Pescador A', a, 'Ocupar un lugar sin reservarlo', 'rechazo', format('insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno) values (%L, %L, %L, ''manana'')', ra1, l3, hoy + 1), 'cambio', null),
            ('Pescador A', a, 'Bajar el monto de su reserva', 'rechazo', format('update public.reserva set monto_total = 0 where id = %L', ra1), 'cambio', null),
            ('Pescador A', a, 'Reactivar una salida que ya pasó', 'rechazo', format('update public.reserva set estado = ''confirmada'' where id = %L', ra2), 'cambio', null),
            ('Pescador A', a, 'Emitirse un permiso', 'rechazo', format('insert into public.permiso (id_reserva, id_usuario, numero, codigo_qr, fecha_vencimiento) values (%L, %L, ''PCC-FALSO'', ''x'', now() + interval ''1 year'')', ra2, a), 'cambio', null),
            ('Pescador A', a, 'Modificar el pago de su reserva', 'rechazo', format('update public.pago set monto = 0 where id_reserva = %L', ra1), 'cambio', null),
            ('Pescador A', a, 'Crearse una notificación', 'rechazo', format('insert into public.notificacion (id_usuario, tipo, titulo, mensaje) values (%L, ''sistema'', ''x'', ''x'')', a), 'cambio', null),
            ('Pescador A', a, 'Cambiar el texto de sus notificaciones', 'rechazo', format('update public.notificacion set mensaje = ''x'' where id_usuario = %L', a), 'cambio', null),
            ('Pescador A', a, 'Marcar sus notificaciones como leídas', 'permitido', format('update public.notificacion set leida = true where id_usuario = %L', a), 'cambio', null),
            ('Pescador A', a, 'Actualizar su teléfono', 'permitido', format('update public.usuario set telefono = ''3871111111'' where id = %L', a), 'cambio', null),
            ('Pescador A', a, 'Cambiar su tipo de cuenta', 'rechazo', format('update public.usuario set rol = ''dueno'' where id = %L', a), 'cambio', null),
            ('Pescador A', a, 'Darse un rol administrativo', 'rechazo', format('update public.usuario set rol = ''admin_sistema'' where id = %L', a), 'cambio', null),
            ('Pescador A', a, 'Cambiar su correo', 'rechazo', format('update public.usuario set email = %L where id = %L', 'otro' || dom, a), 'cambio', null),
            ('Pescador A', a, 'Enviar el reporte municipal', 'rechazo', 'select public.generar_reporte_municipal(''general'', ''manual'')', 'cambio', null),
            ('Pescador A', a, 'Generar avisos para otros usuarios', 'rechazo', 'select public.generar_recordatorios(false)', 'cambio', format('select count(*)::int from public.notificacion where id_usuario = %L and tipo = ''recordatorio''', b)),
            ('Pescador A', a, 'Anular su reserva de mañana', 'permitido', format('select public.anular_reserva(%L)', ra1), 'cambio', null),
            ('Pescador A', a, 'Anular una salida que ya pasó', 'rechazo', format('select public.anular_reserva(%L)', ra2), 'cambio', null),
            ('Pescador A', a, 'Modificar un catamarán', 'rechazo', format('update public.catamaran set precio = 1 where id = %L', cat_d), 'cambio', null),
            ('Pescador A', a, 'Publicar un aviso', 'rechazo', format(avisar, 'todos', null), 'cambio', null),
            ('Pescador A', a, 'Leer los avisos publicados', 'rechazo', 'select * from public.aviso', 'lectura', null),
            ('Pescador A', a, 'Crear un aviso directo en la tabla', 'rechazo', 'insert into public.aviso (titulo, mensaje, destino) values (''Falso'', ''Aviso falso'', ''todos'')', 'cambio', null),
            ('Pescador A', a, 'Dar de alta una cuenta del personal', 'rechazo', format(alta, 'prueba.nueva', clave), 'cambio', null),
            ('Pescador A', a, 'Ver la ocupación de lugares', 'permitido', format('select * from public.v_lugares_ocupados where id_catamaran = %L', cat_d), 'lectura', null),

            -- Dueño de catamarán
            ('Dueño', d, 'Cambiar el precio de su catamarán', 'permitido', format('update public.catamaran set precio = 9000 where id = %L', cat_d), 'cambio', null),
            ('Dueño', d, 'Cambiar la capacidad de su catamarán', 'rechazo', format('update public.catamaran set capacidad = 40 where id = %L', cat_d), 'cambio', null),
            ('Dueño', d, 'Ceder su catamarán a otro usuario', 'rechazo', format('update public.catamaran set id_propietario = %L where id = %L', b, cat_d), 'cambio', null),
            ('Dueño', d, 'Modificar un catamarán ajeno', 'rechazo', format('update public.catamaran set precio = 1 where id = %L', cat_o), 'cambio', null),
            ('Dueño', d, 'Ver las reservas de su catamarán', 'permitido', format('select * from public.reserva where id_catamaran = %L', cat_d), 'lectura', null),
            ('Dueño', d, 'Ver el perfil de sus pasajeros', 'rechazo', format('select * from public.usuario where id = %L', a), 'lectura', null),
            ('Dueño', d, 'Ver el permiso de sus pasajeros', 'rechazo', format('select * from public.permiso where id = %L', pa1), 'lectura', null),

            -- Administración municipal
            ('Municipio', m, 'Ver los usuarios', 'permitido', format('select * from public.usuario where id in (%L, %L)', a, b), 'lectura', null),
            ('Municipio', m, 'Ver todas las reservas', 'permitido', format('select * from public.reserva where id in (%L, %L)', ra1, rb1), 'lectura', null),
            ('Municipio', m, 'Enviar el reporte municipal', 'permitido', 'select public.generar_reporte_municipal(''general'', ''manual'')', 'cambio', null),
            ('Municipio', m, 'Pasar un pescador a dueño', 'permitido', format('update public.usuario set rol = ''dueno'' where id = %L', b), 'cambio', null),
            ('Municipio', m, 'Dar un rol administrativo', 'rechazo', format('update public.usuario set rol = ''admin_municipal'' where id = %L', b), 'cambio', null),
            ('Municipio', m, 'Darse el rol de administrador del sistema', 'rechazo', format('update public.usuario set rol = ''admin_sistema'' where id = %L', m), 'cambio', null),
            ('Municipio', m, 'Desactivar al administrador del sistema', 'rechazo', format('update public.usuario set activo = false where id = %L', s), 'cambio', null),
            ('Municipio', m, 'Cambiar el correo de un usuario', 'rechazo', format('update public.usuario set email = %L where id = %L', 'otro' || dom, b), 'cambio', null),
            ('Municipio', m, 'Cambiar el DNI de un usuario', 'rechazo', format('update public.usuario set dni = ''1'' where id = %L', b), 'cambio', null),
            ('Municipio', m, 'Desactivar una cuenta y cerrar sus sesiones' || case when con_sesion then '' else ' (sin sesión de prueba)' end,
                'permitido', format('update public.usuario set activo = false where id = %L', b), 'cambio',
                format('select count(*)::int from public.usuario u where u.id = %L and not u.activo and not exists (select 1 from auth.sessions x where x.user_id = u.id)', b)),
            ('Municipio', m, 'Leer autorizaciones del personal', 'rechazo', 'select * from public.personal_autorizado', 'lectura', null),
            ('Municipio', m, 'Publicar un aviso para todos (llega solo a cuentas activas del público)', 'permitido', format(avisar, 'todos', null), 'cambio',
                format('select ((count(*) filter (where id_usuario in (%L, %L, %L))) = 3 and (count(*) filter (where id_usuario in (%L, %L, %L, %L))) = 0)::int from public.notificacion where tipo = ''aviso''', a, b, d, x, m, s, mx)),
            ('Municipio', m, 'Publicar un aviso para un usuario', 'permitido', format(avisar, 'usuario', a), 'cambio',
                format('select ((count(*) filter (where id_usuario = %L)) = 1 and count(*) = 1)::int from public.notificacion where tipo = ''aviso''', a)),
            ('Municipio', m, 'Dar de alta una cuenta del personal', 'rechazo', format(alta, 'prueba.nueva', clave), 'cambio', null),
            ('Municipio', m, 'Cambiar la contraseña del administrador del sistema', 'rechazo', format('select public.cambiar_clave_personal(%L, %L)', s, clave), 'cambio', null),

            -- Administración del sistema
            ('Administrador', s, 'Dar un rol administrativo', 'rechazo', format('update public.usuario set rol = ''admin_municipal'' where id = %L', b), 'cambio', null),
            ('Administrador', s, 'Desactivar una cuenta del personal', 'permitido', format('update public.usuario set activo = false where id = %L', m), 'cambio', null),
            ('Administrador', s, 'Cambiar el rol de una cuenta del personal', 'rechazo', format('update public.usuario set rol = ''admin_sistema'' where id = %L', m), 'cambio', null),
            ('Administrador', s, 'Publicar un aviso para los dueños', 'permitido', format(avisar, 'dueno', null), 'cambio',
                format('select ((count(*) filter (where id_usuario = %L)) = 1 and count(*) = 1)::int from public.notificacion where tipo = ''aviso''', d)),
            ('Administrador', s, 'Dar de alta una cuenta del personal', 'permitido', format(alta, 'prueba.nueva', clave), 'cambio',
                format('select count(*)::int from public.usuario u join auth.users au on au.id = u.id join auth.identities i on i.user_id = u.id and i.provider = ''email'' where u.email = ''prueba.nueva@pescacorral.example.com'' and u.rol = ''admin_municipal'' and u.perfil_completo and au.email_confirmed_at is not null and au.confirmation_token = '''' and au.encrypted_password = crypt(%L, au.encrypted_password)', clave)),
            ('Administrador', s, 'Dar de alta con una contraseña débil', 'rechazo', format(alta, 'prueba.nueva', 'corta'), 'cambio', null),
            ('Administrador', s, 'Dar de alta un usuario que ya existe', 'rechazo', format(alta, 'pc-prueba-m', clave), 'cambio', null),
            ('Administrador', s, 'Cambiar la contraseña de una cuenta del personal', 'permitido', format('select public.cambiar_clave_personal(%L, %L)', m, clave), 'cambio',
                format('select count(*)::int from auth.users where id = %L and encrypted_password = crypt(%L, encrypted_password)', m, clave)),
            ('Administrador', s, 'Cambiar la contraseña de un pescador', 'rechazo', format('select public.cambiar_clave_personal(%L, %L)', a, clave), 'cambio', null),

            -- Cuentas desactivadas
            ('Pescador desactivado', x, 'Reservar', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', l3), 'cambio', null),
            ('Municipio desactivado', mx, 'Ver los usuarios', 'rechazo', format('select * from public.usuario where id = %L', a), 'lectura', null),
            ('Municipio desactivado', mx, 'Enviar el reporte municipal', 'rechazo', 'select public.generar_reporte_municipal(''general'', ''manual'')', 'cambio', null),
            ('Municipio desactivado', mx, 'Pasar un pescador a dueño', 'rechazo', format('update public.usuario set rol = ''dueno'' where id = %L', a), 'cambio', null),

            -- Servicio de ingreso: alta de una cuenta con contraseña
            ('Servicio de ingreso', null, 'Alta con contraseña sin autorización', 'rechazo',
                format('insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at) values (''00000000-0000-0000-0000-000000000000'', gen_random_uuid(), ''authenticated'', ''authenticated'', %L, ''{"provider":"email","providers":["email"]}'', now(), now())', 'intruso' || dom),
                'servicio', null)
            ) t(perfil, uid, caso, esperado, sentencia, tipo, control)
        loop
            v_res := v_res || jsonb_build_object(
                'perfil', c.perfil, 'caso', c.caso, 'esperado', c.esperado,
                'obtenido', pg_temp.intentar(c.uid, c.sentencia, c.tipo, c.control));
        end loop;

        raise exception using errcode = 'PC999', message = 'fin de las pruebas';
    exception when sqlstate 'PC999' then
        null;   -- se revierten todos los datos de prueba
    end;

    insert into _pruebas_seguridad (n, perfil, caso, esperado, obtenido, resultado)
    select e.n::int, e.v ->> 'perfil', e.v ->> 'caso',
           case e.v ->> 'esperado' when 'rechazo' then 'Rechazado' else 'Permitido' end,
           case when e.v ->> 'obtenido' like 'error:%' then 'Rechazado: ' || left(substr(e.v ->> 'obtenido', 7), 110)
                when e.v ->> 'obtenido' = 'filas:0' then 'Sin efecto (0 filas)'
                else 'Permitido (' || substr(e.v ->> 'obtenido', 7) || ' filas)' end,
           case when (e.v ->> 'esperado' = 'rechazo') = (e.v ->> 'obtenido' like 'error:%' or e.v ->> 'obtenido' = 'filas:0')
                then 'OK' else 'FALLA' end
    from jsonb_array_elements(v_res) with ordinality as e(v, n);
end $$;

select n as "N°", perfil, caso, esperado, obtenido, resultado
from _pruebas_seguridad
union all
select null, 'Resumen', count(*) || ' casos', '',
       count(*) filter (where resultado = 'FALLA') || ' fallas',
       case when count(*) filter (where resultado = 'FALLA') = 0 then 'OK' else 'FALLA' end
from _pruebas_seguridad
order by 1 nulls last;
