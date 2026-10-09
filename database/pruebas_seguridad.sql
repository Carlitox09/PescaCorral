-- ============================================================================
--  PescaCorral · Pruebas de seguridad
--  Ejecutar en Supabase -> SQL Editor. No deja datos: crea cuentas y registros
--  de prueba, intenta cada operación con la identidad de cada perfil (como lo
--  hace la API con el token de la sesión: rol "anon" o "authenticated" y el id
--  del usuario) y al terminar revierte todo. Lo único que no se revierte es el
--  avance de las secuencias de números de reserva y de permiso.
--
--  Devuelve una fila por caso (perfil, operación, resultado esperado, resultado
--  obtenido y OK / FALLA), con las fallas primero, y una fila final con el resumen.
--
--  Las comprobaciones miran sólo los datos creados por la prueba: la base real
--  puede tener avisos, dueños y cuentas de Google (sin contraseña) propios.
--
--  Perfiles de prueba: sin sesión, pescadores A y B, dueño D (con su
--  catamarán y sus gastos), municipio M, administrador del sistema S, pescador
--  desactivado X, municipio desactivado MX y el servicio de ingreso (altas de
--  cuentas). Especies de prueba: dos habilitadas (1.000 y 2.500) y una no.
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
    l4    uuid := gen_random_uuid();
    o1    uuid := gen_random_uuid();
    o2    uuid := gen_random_uuid();   -- lugar fuera de servicio del otro catamarán
    ra1   uuid := gen_random_uuid();   -- reserva de A para mañana (con permiso)
    ra2   uuid := gen_random_uuid();   -- salida de A que ya pasó
    rb1   uuid := gen_random_uuid();   -- reserva de B para mañana
    rb2   uuid := gen_random_uuid();   -- reserva de B para pasado mañana (lugar 3)
    pa1   uuid := gen_random_uuid();   -- permiso de A
    esp1  uuid := gen_random_uuid();   -- especie de prueba ($ 1.000)
    esp2  uuid := gen_random_uuid();   -- especie de prueba ($ 2.500)
    espx  uuid := gen_random_uuid();   -- especie de prueba deshabilitada
    dom   text := '@pruebas.pescacorral.invalid';
    clave text := 'Clave-Segura-2026';
    alta  text := 'select public.crear_cuenta_personal(%L, ''Prueba'', ''Nueva'', ''admin_municipal'', %L)';
    avisar text := 'select public.publicar_aviso(''Aviso de prueba'', ''Mensaje de prueba para los usuarios.'', %L, %L)';
    reservar text := 'select public.crear_reserva_completa(p_id_catamaran => %L, p_fecha => %L, '
                     'p_turno => %L, p_lugares => array[%L]::uuid[], p_metodo_pago => ''efectivo'', '
                     'p_pasajeros => %L::jsonb)';
    pas1  text := format('[{"especies": ["%s"]}]', esp1);
    avisar_s text := 'select public.avisar_pasajeros(%L, %L, %L, ''Salida suspendida'', ''Se suspende por viento.'')';
    embarque text := 'select * from public.lista_embarque(%L, %L, %L)';
    reservar2 text := 'select public.crear_reserva_completa(p_id_catamaran => %L, p_fecha => %L, '
                     'p_turno => ''tarde'', p_lugares => array[%L, %L]::uuid[], p_metodo_pago => ''efectivo'', '
                     'p_pasajeros => %L::jsonb)';
    reservar3 text := 'select public.crear_reserva_completa(p_id_catamaran => %L, p_fecha => %L, '
                     'p_turno => ''tarde'', p_lugares => array[%L, %L, %L]::uuid[], p_metodo_pago => ''efectivo'', '
                     'p_pasajeros => %L::jsonb)';
    ep_a  text := 'https://push.prueba.invalid/a';
    ep_b  text := 'https://push.prueba.invalid/b';
    foto    text := 'select 1 where public.es_foto_propia(%L)';
    asignar text := 'select public.asignar_propietario(%L, %L)';
    altacat text := 'select public.crear_catamaran(%L, ''Catamarán de prueba'', %s, 1000, ''HAB-PRUEBA'', ''activa'')';
    gastar  text := 'insert into public.gasto (%s fecha, categoria, monto) values (%s %L, ''combustible'', 15000)';
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

        insert into public.especie (id, nombre, precio_permiso, activa, umbral_permisos)
        values (esp1, 'Especie Prueba 1', 1000, true, 0), (esp2, 'Especie Prueba 2', 2500, true, 0),
               (espx, 'Especie Prueba X', 500, false, 0);

        insert into public.catamaran (id, id_propietario, nombre, capacidad, precio, habilitacion, estado)
        values (cat_d, d, 'Prueba D', 4, 1000, 'HAB-PRUEBA-1', 'activa'),
               (cat_o, null, 'Prueba O', 1, 1000, 'HAB-PRUEBA-2', 'activa');
        insert into public.lugar (id, id_catamaran, numero, ubicacion, activo)
        values (l1, cat_d, 1, public.ubicacion_lugar(1, 4), true), (l2, cat_d, 2, public.ubicacion_lugar(2, 4), true),
               (l3, cat_d, 3, public.ubicacion_lugar(3, 4), true), (l4, cat_d, 4, public.ubicacion_lugar(4, 4), true),
               (o1, cat_o, 1, public.ubicacion_lugar(1, 1), true), (o2, cat_o, 2, null, false);

        insert into public.reserva (id, numero, id_usuario, id_catamaran, fecha, turno, estado,
                                    cantidad_lugares, monto_total, monto_permiso)
        values (ra1, 'RES-PRUEBA-A1', a, cat_d, hoy + 1, 'manana', 'confirmada', 1, 6000, 5000),
               (ra2, 'RES-PRUEBA-A2', a, cat_d, hoy - 3, 'manana', 'completada', 1, 6000, 5000),
               (rb1, 'RES-PRUEBA-B1', b, cat_d, hoy + 1, 'tarde',  'confirmada', 1, 6000, 5000),
               (rb2, 'RES-PRUEBA-B2', b, cat_d, hoy + 2, 'manana', 'confirmada', 2, 7000, 5000);
        insert into public.permiso (id, id_reserva, id_usuario, titular_nombre, titular_dni, numero, codigo_qr, monto,
                                    fecha_vencimiento, estado)
        values (pa1, ra1, a, 'Prueba A', '90.000.001', 'PCC-PRUEBA-A1', 'PCC-PRUEBA-A1', 5000,
                ((hoy + 1) + time '23:59') at time zone 'America/Argentina/Salta', 'vigente');
        insert into public.permiso_especie (id_permiso, id_especie, precio) values (pa1, esp1, 5000);
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado, id_permiso)
        values (ra1, l1, hoy + 1, 'manana', 'confirmada', pa1);
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado)
        values (ra2, l1, hoy - 3, 'manana', 'confirmada'),
               (rb1, l1, hoy + 1, 'tarde',  'confirmada'),
               (rb2, l3, hoy + 2, 'manana', 'confirmada');
        insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno, estado, pasajero_nombre, pasajero_dni)
        values (rb2, l2, hoy + 2, 'manana', 'confirmada', 'Acompañante Prueba', '30.555.666');
        insert into public.pago (id_reserva, monto, metodo, estado, comprobante)
        values (ra1, 6000, 'efectivo', 'aprobado', 'CMP-PRUEBA-A1'),
               (ra2, 6000, 'efectivo', 'aprobado', 'CMP-PRUEBA-A2'),
               (rb1, 6000, 'efectivo', 'aprobado', 'CMP-PRUEBA-B1'),
               (rb2, 7000, 'efectivo', 'aprobado', 'CMP-PRUEBA-B2');
        insert into public.notificacion (id_usuario, tipo, titulo, mensaje)
        values (a, 'sistema', 'Aviso de prueba', 'Aviso de prueba');
        insert into public.suscripcion_push (id_usuario, endpoint, p256dh, auth)
        values (a, ep_a, 'clave-a', 'auth-a'), (b, ep_b, 'clave-b', 'auth-b');
        insert into public.gasto (id_propietario, id_catamaran, fecha, categoria, descripcion, monto)
        values (d, cat_d, hoy, 'mantenimiento', 'Gasto de prueba', 10000);

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
            ('Sin sesión', null, 'Reservar', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', l2, pas1), 'cambio', null),
            ('Sin sesión', null, 'Publicar un aviso', 'rechazo', format(avisar, 'todos', null), 'cambio', null),
            ('Sin sesión', null, 'Cargar un catamarán', 'rechazo', 'insert into public.catamaran (nombre, capacidad, precio) values (''Intruso'', 1, 0)', 'cambio', null),
            ('Sin sesión', null, 'Dar de alta un catamarán', 'rechazo', format(altacat, 'Intruso', 2), 'cambio', null),
            ('Sin sesión', null, 'Leer los gastos de los dueños', 'rechazo', 'select * from public.gasto', 'lectura', null),
            ('Sin sesión', null, 'Avisar a los pasajeros de una salida', 'rechazo', format(avisar_s, cat_d, hoy + 1, 'manana'), 'cambio', null),
            ('Sin sesión', null, 'Ver una lista de embarque', 'rechazo', format(embarque, cat_d, hoy + 1, 'manana'), 'lectura', null),
            ('Sin sesión', null, 'Registrar un teléfono para avisos', 'rechazo', 'select public.registrar_push(''https://push.prueba.invalid/x'', ''k'', ''a'')', 'cambio', null),
            ('Sin sesión', null, 'Leer los teléfonos registrados', 'rechazo', 'select * from public.suscripcion_push', 'lectura', null),
            ('Sin sesión', null, 'Leer las especies y sus precios', 'rechazo', 'select * from public.especie', 'lectura', null),

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
            ('Pescador B', b, 'Leer las especies del permiso de otro pescador', 'rechazo', format('select * from public.permiso_especie where id_permiso = %L', pa1), 'lectura', null),
            ('Pescador B', b, 'Declarar como propio el número de un permiso ajeno (se registra, sin acceso al permiso)', 'permitido',
                format(reservar, cat_d, hoy + 1, 'manana', l2, '[{"permiso_propio": "PCC-PRUEBA-A1"}]'), 'cambio',
                format('select ((select count(*) from public.reserva_lugar rl join public.reserva r on r.id = rl.id_reserva where r.id_usuario = %L and rl.permiso_propio = ''PCC-PRUEBA-A1'' and rl.id_permiso is null) = 1 and (select count(*) from public.permiso where id_usuario = %L) = 0)::int', b, b)),
            ('Pescador B', b, 'Leer los gastos de un dueño', 'rechazo', 'select * from public.gasto', 'lectura', null),

            -- Pescador A: sus datos y las reglas de negocio
            ('Pescador A', a, 'Ver su reserva, su permiso y su pago', 'permitido', format('select 1 from public.reserva r join public.permiso p on p.id_reserva = r.id join public.permiso_especie e on e.id_permiso = p.id join public.pago g on g.id_reserva = r.id where r.id = %L', ra1), 'lectura', null),
            ('Pescador A', a, 'Reservar y pagar (flujo normal)', 'permitido', format(reservar, cat_d, hoy + 1, 'tarde', l2, pas1), 'cambio', null),
            ('Pescador A', a, 'Reservar una fecha pasada', 'rechazo', format(reservar, cat_d, hoy - 1, 'tarde', l2, pas1), 'cambio', null),
            ('Pescador A', a, 'Reservar un lugar de otro catamarán', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', o1, pas1), 'cambio', null),
            ('Pescador A', a, 'Reservar un lugar ocupado', 'rechazo', format(reservar, cat_d, hoy + 1, 'manana', l1, pas1), 'cambio', null),
            ('Pescador A', a, 'Reservar un lugar fuera de servicio', 'rechazo', format(reservar, cat_o, hoy + 1, 'manana', o2, pas1), 'cambio', null),
            ('Pescador A', a, 'Reservar dos lugares sin los datos del acompañante', 'rechazo', format(reservar2, cat_d, hoy + 1, l2, l3, pas1), 'cambio', null),
            ('Pescador A', a, 'Reservar dos lugares con el acompañante y su permiso de dos especies', 'permitido',
                format(reservar2, cat_d, hoy + 1, l2, l3, format('[{"especies": ["%s"]}, {"nombre": "Ana Acompañante", "dni": "31222333", "especies": ["%s", "%s"]}]', esp1, esp1, esp2)), 'cambio',
                'select count(*)::int from public.reserva_lugar rl join public.permiso p on p.id = rl.id_permiso where rl.pasajero_nombre = ''Ana Acompañante'' and rl.pasajero_dni = ''31.222.333'' and p.titular_nombre = ''Ana Acompañante'' and p.titular_dni = ''31.222.333'' and p.monto = 3500 and (select count(*) from public.permiso_especie x where x.id_permiso = p.id) = 2'),
            ('Pescador A', a, 'Reservar con un DNI repetido entre los pasajeros', 'rechazo', format(reservar2, cat_d, hoy + 1, l2, l3, format('[{"especies": ["%s"]}, {"nombre": "Otro Nombre", "dni": "90000001", "especies": ["%s"]}]', esp1, esp1)), 'cambio', null),
            ('Pescador A', a, 'Reservar para tres con permisos mixtos (dos digitales y uno propio)', 'permitido',
                format(reservar3, cat_d, hoy + 1, l2, l3, l4, format('[{"especies": ["%s", "%s"]}, {"nombre": "Uno Acompañante", "dni": "32111222", "permiso_propio": "LIC-2026-55"}, {"nombre": "Dos Acompañante", "dni": "33111222", "especies": ["%s"]}]', esp1, esp2, esp2)), 'cambio',
                format('select ((select count(*) from public.permiso p join public.reserva r on r.id = p.id_reserva where r.id_usuario = %L and r.fecha = %L and r.turno = ''tarde'') = 2 and (select monto_permiso from public.reserva where id_usuario = %L and fecha = %L and turno = ''tarde'') = 6000 and (select count(*) from public.reserva_lugar where permiso_propio = ''LIC-2026-55'' and id_permiso is null) = 1)::int', a, hoy + 1, a, hoy + 1)),
            ('Pescador A', a, 'Ya tengo permiso: se registra el número sin validarlo', 'permitido',
                format(reservar, cat_d, hoy + 1, 'tarde', l2, '[{"permiso_propio": "Permiso en papel 123"}]'), 'cambio',
                format('select ((select count(*) from public.reserva_lugar where permiso_propio = ''Permiso en papel 123'' and id_permiso is null) = 1 and (select count(*) from public.permiso where id_usuario = %L) = 1)::int', a)),
            ('Pescador A', a, 'Reservar sin elegir especies ni permiso propio', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', l2, '[{"especies": []}]'), 'cambio', null),
            ('Pescador A', a, 'Reservar con una especie deshabilitada', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', l2, format('[{"especies": ["%s"]}]', espx)), 'cambio', null),
            ('Pescador A', a, 'Fijar el precio de su permiso (lo calcula la base)', 'permitido',
                format(reservar, cat_d, hoy + 1, 'tarde', l2, format('[{"especies": ["%s"], "precio": 1, "monto": 1}]', esp2)), 'cambio',
                format('select count(*)::int from public.permiso p join public.reserva r on r.id = p.id_reserva where r.id_usuario = %L and r.turno = ''tarde'' and p.monto = 2500 and r.monto_permiso = 2500', a)),
            ('Pescador A', a, 'Cambiar el precio de una especie', 'rechazo', format('update public.especie set precio_permiso = 0 where id = %L', esp1), 'cambio', null),
            ('Pescador A', a, 'Agregarse una especie a su permiso', 'rechazo', format('insert into public.permiso_especie (id_permiso, id_especie, precio) values (%L, %L, 0)', pa1, esp2), 'cambio', null),
            ('Pescador A', a, 'Registrar su teléfono para avisos', 'permitido', 'select public.registrar_push(''https://push.prueba.invalid/a2'', ''k'', ''a'')', 'cambio',
                format('select count(*)::int from public.suscripcion_push where id_usuario = %L', a)),
            ('Pescador A', a, 'Registrar un teléfono directo en la tabla', 'rechazo', format('insert into public.suscripcion_push (id_usuario, endpoint, p256dh, auth) values (%L, ''https://push.prueba.invalid/z'', ''k'', ''a'')', a), 'cambio', null),
            ('Pescador A', a, 'Leer los teléfonos de otro usuario', 'rechazo', format('select * from public.suscripcion_push where id_usuario = %L', b), 'lectura', null),
            ('Pescador A', a, 'Borrar el teléfono de otro usuario', 'rechazo', format('select public.borrar_push(%L)', ep_b), 'cambio',
                format('select (count(*) = 0)::int from public.suscripcion_push where endpoint = %L', ep_b)),
            ('Pescador A', a, 'Crear una reserva sin pagar (directo en la tabla)', 'rechazo', format('insert into public.reserva (id_usuario, id_catamaran, fecha, turno, cantidad_lugares, monto_total) values (%L, %L, %L, ''manana'', 1, 0)', a, cat_d, hoy + 2), 'cambio', null),
            ('Pescador A', a, 'Ocupar un lugar sin reservarlo', 'rechazo', format('insert into public.reserva_lugar (id_reserva, id_lugar, fecha, turno) values (%L, %L, %L, ''manana'')', ra1, l3, hoy + 1), 'cambio', null),
            ('Pescador A', a, 'Bajar el monto de su reserva', 'rechazo', format('update public.reserva set monto_total = 0 where id = %L', ra1), 'cambio', null),
            ('Pescador A', a, 'Reactivar una salida que ya pasó', 'rechazo', format('update public.reserva set estado = ''confirmada'' where id = %L', ra2), 'cambio', null),
            ('Pescador A', a, 'Emitirse un permiso', 'rechazo', format('insert into public.permiso (id_reserva, id_usuario, titular_nombre, titular_dni, numero, codigo_qr, fecha_vencimiento) values (%L, %L, ''Prueba A'', ''90.000.001'', ''PCC-FALSO'', ''x'', now() + interval ''1 year'')', ra2, a), 'cambio', null),
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
            ('Pescador A', a, 'Anular su reserva de mañana (se anula su permiso)', 'permitido', format('select public.anular_reserva(%L)', ra1), 'cambio',
                format('select count(*)::int from public.permiso where id = %L and estado = ''anulado''', pa1)),
            ('Pescador A', a, 'Anular una salida que ya pasó', 'rechazo', format('select public.anular_reserva(%L)', ra2), 'cambio', null),
            ('Pescador A', a, 'Modificar un catamarán', 'rechazo', format('update public.catamaran set precio = 1 where id = %L', cat_d), 'cambio', null),
            ('Pescador A', a, 'Dar de alta un catamarán', 'rechazo', format(altacat, 'Prueba A', 2), 'cambio', null),
            ('Pescador A', a, 'Registrar un gasto', 'rechazo', format(gastar, '', '', hoy), 'cambio', null),
            ('Pescador A', a, 'Avisar a los pasajeros de un catamarán', 'rechazo', format(avisar_s, cat_d, hoy + 1, 'manana'), 'cambio', null),
            ('Pescador A', a, 'Ver la lista de embarque de un catamarán', 'rechazo', format(embarque, cat_d, hoy + 1, 'manana'), 'lectura', null),
            ('Pescador A', a, 'Subir una foto a un catamarán', 'rechazo', format(foto, cat_d || '/foto.jpg'), 'lectura', null),
            ('Pescador A', a, 'Asignarse un catamarán', 'rechazo', format(asignar, cat_o, a), 'cambio', null),
            ('Pescador A', a, 'Publicar un aviso', 'rechazo', format(avisar, 'todos', null), 'cambio', null),
            ('Pescador A', a, 'Leer los avisos publicados', 'rechazo', 'select * from public.aviso', 'lectura', null),
            ('Pescador A', a, 'Crear un aviso directo en la tabla', 'rechazo', 'insert into public.aviso (titulo, mensaje, destino) values (''Falso'', ''Aviso falso'', ''todos'')', 'cambio', null),
            ('Pescador A', a, 'Dar de alta una cuenta del personal', 'rechazo', format(alta, 'prueba.nueva', clave), 'cambio', null),
            ('Pescador A', a, 'Ver la ocupación de lugares', 'permitido', format('select * from public.v_lugares_ocupados where id_catamaran = %L', cat_d), 'lectura', null),

            -- Dueño de catamarán
            ('Dueño', d, 'Cambiar el precio de su catamarán', 'permitido', format('update public.catamaran set precio = 9000 where id = %L', cat_d), 'cambio', null),
            ('Dueño', d, 'Cambiar la capacidad sin ajustar los lugares (directo en la tabla)', 'rechazo', format('update public.catamaran set capacidad = 40 where id = %L', cat_d), 'cambio', null),
            ('Dueño', d, 'Dar de alta un catamarán con sus lugares', 'permitido', format(altacat, 'Prueba D2', 5), 'cambio',
                format('select count(*)::int from public.lugar l join public.catamaran c on c.id = l.id_catamaran where c.nombre = ''Prueba D2'' and c.id_propietario = %L and l.activo and l.ubicacion = public.ubicacion_lugar(l.numero, 5)', d)),
            ('Dueño', d, 'Cargar un catamarán directo en la tabla', 'rechazo', format('insert into public.catamaran (id_propietario, nombre, capacidad, precio) values (%L, ''Directo'', 2, 0)', d), 'cambio', null),
            ('Dueño', d, 'Agregar un lugar directo en la tabla', 'rechazo', format('insert into public.lugar (id_catamaran, numero) values (%L, 9)', cat_d), 'cambio', null),
            ('Dueño', d, 'Sumar lugares a su catamarán', 'permitido', format('select public.cambiar_capacidad(%L, 6)', cat_d), 'cambio',
                format('select count(*)::int from public.lugar l join public.catamaran c on c.id = l.id_catamaran where c.id = %L and c.capacidad = 6 and l.activo and l.ubicacion = public.ubicacion_lugar(l.numero, 6)', cat_d)),
            ('Dueño', d, 'Quitar un lugar sin reservas', 'permitido', format('select public.cambiar_capacidad(%L, 3)', cat_d), 'cambio',
                format('select (count(*) = 3 and bool_and(activo) and (select capacidad from public.catamaran where id = %L) = 3)::int from public.lugar where id_catamaran = %L', cat_d, cat_d)),
            ('Dueño', d, 'Quitar un lugar con reservas desde hoy', 'rechazo', format('select public.cambiar_capacidad(%L, 2)', cat_d), 'cambio', null),
            ('Dueño', d, 'Cambiar los lugares de un catamarán ajeno', 'rechazo', format('select public.cambiar_capacidad(%L, 5)', cat_o), 'cambio', null),
            ('Dueño', d, 'Ver sus gastos', 'permitido', 'select * from public.gasto', 'lectura', null),
            ('Dueño', d, 'Tener más de un catamarán', 'permitido', format(altacat, 'Prueba D3', 2), 'cambio',
                format('select count(*)::int from public.catamaran where id_propietario = %L', d)),
            ('Dueño', d, 'Avisar a los pasajeros de su salida (sin ver quiénes son)', 'permitido', format(avisar_s, cat_d, hoy + 1, 'manana'), 'cambio',
                format('select count(*)::int from public.notificacion where tipo = ''salida'' and id_usuario = %L and id_reserva = %L', a, ra1)),
            ('Dueño', d, 'Avisar sobre una salida que ya pasó', 'rechazo', format(avisar_s, cat_d, hoy - 3, 'manana'), 'cambio', null),
            ('Dueño', d, 'Avisar a los pasajeros de un catamarán ajeno', 'rechazo', format(avisar_s, cat_o, hoy + 1, 'manana'), 'cambio', null),
            ('Dueño', d, 'Ver la lista de embarque de su salida (nombre y DNI)', 'permitido', format('select 1 from public.lista_embarque(%L, %L, ''manana'') where dni = ''90000001''', cat_d, hoy + 1), 'lectura', null),
            ('Dueño', d, 'Ver en la lista de embarque el permiso de cada pasajero', 'permitido', format('select 1 from public.lista_embarque(%L, %L, ''manana'') where permiso = ''PCC-PRUEBA-A1'' and permiso_digital', cat_d, hoy + 1), 'lectura', null),
            ('Dueño', d, 'Cambiar el precio de una especie', 'rechazo', format('update public.especie set precio_permiso = 1 where id = %L', esp1), 'cambio', null),
            ('Dueño', d, 'Ver en la lista de embarque a cada pasajero (titular y acompañante)', 'permitido', format('select 1 from public.lista_embarque(%L, %L, ''manana'') where dni in (''90000002'', ''30.555.666'')', cat_d, hoy + 2), 'lectura', null),
            ('Dueño', d, 'Avisar a los pasajeros: el aviso sale hacia el teléfono', 'permitido', format(avisar_s, cat_d, hoy + 1, 'manana'), 'cambio',
                'select count(*)::int from net.http_request_queue where url like ''%/functions/v1/enviar-push'''),
            ('Dueño', d, 'Ver la lista de embarque de un catamarán ajeno', 'rechazo', format(embarque, cat_o, hoy + 1, 'manana'), 'lectura', null),
            ('Dueño', d, 'Subir una foto de su catamarán', 'permitido', format(foto, cat_d || '/foto.jpg'), 'lectura', null),
            ('Dueño', d, 'Subir una foto a un catamarán ajeno', 'rechazo', format(foto, cat_o || '/foto.jpg'), 'lectura', null),
            ('Dueño', d, 'Guardar las fotos de su catamarán', 'permitido', format('update public.catamaran set fotos = array[%L] where id = %L', cat_d || '/portada.jpg', cat_d), 'cambio', null),
            ('Dueño', d, 'Poner en su catamarán una foto de otro', 'rechazo', format('update public.catamaran set fotos = array[%L] where id = %L', cat_o || '/portada.jpg', cat_d), 'cambio', null),
            ('Dueño', d, 'Asignarse un catamarán ajeno', 'rechazo', format(asignar, cat_o, d), 'cambio', null),
            ('Dueño', d, 'Registrar un gasto de su catamarán', 'permitido', format(gastar, 'id_catamaran,', quote_literal(cat_d) || ',', hoy), 'cambio', null),
            ('Dueño', d, 'Registrar un gasto general de la flota', 'permitido', format(gastar, '', '', hoy), 'cambio', null),
            ('Dueño', d, 'Registrar un gasto en un catamarán ajeno', 'rechazo', format(gastar, 'id_catamaran,', quote_literal(cat_o) || ',', hoy), 'cambio', null),
            ('Dueño', d, 'Registrar un gasto a nombre de otro usuario', 'rechazo', format(gastar, 'id_propietario,', quote_literal(b) || ',', hoy), 'cambio', null),
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
            ('Municipio', m, 'Leer los gastos de un dueño', 'rechazo', 'select * from public.gasto', 'lectura', null),
            ('Municipio', m, 'Asignar un catamarán a un dueño', 'permitido', format(asignar, cat_o, d), 'cambio',
                format('select count(*)::int from public.catamaran where id = %L and id_propietario = %L', cat_o, d)),
            ('Municipio', m, 'Asignar un catamarán a un pescador', 'rechazo', format(asignar, cat_o, a), 'cambio', null),
            ('Municipio', m, 'Pasar un dueño a pescador', 'permitido', format('update public.usuario set rol = ''pescador'' where id = %L', d), 'cambio', null),
            ('Municipio', m, 'Ver la lista de embarque de una salida', 'permitido', format(embarque, cat_d, hoy + 1, 'manana'), 'lectura', null),
            ('Municipio', m, 'Dar de alta un catamarán sin dueño', 'permitido', format(altacat, 'Prueba M', 2), 'cambio',
                'select count(*)::int from public.catamaran where nombre = ''Prueba M'' and id_propietario is null'),
            ('Municipio', m, 'Publicar un aviso para todos (llega solo a cuentas activas del público)', 'permitido', format(avisar, 'todos', null), 'cambio',
                format('select ((count(*) filter (where id_usuario in (%L, %L, %L))) = 3 and (count(*) filter (where id_usuario in (%L, %L, %L, %L))) = 0)::int from public.notificacion where tipo = ''aviso''', a, b, d, x, m, s, mx)),
            ('Municipio', m, 'Publicar un aviso para un usuario', 'permitido', format(avisar, 'usuario', a), 'cambio',
                format('select ((count(*) filter (where id_usuario = %L)) = 1 and count(*) = 1)::int from public.notificacion where tipo = ''aviso'' and created_at = now()', a)),
            ('Municipio', m, 'Cambiar el precio de una especie', 'permitido', format('update public.especie set precio_permiso = 3000 where id = %L', esp1), 'cambio', null),
            ('Municipio', m, 'Dar de alta una especie con su precio', 'permitido', 'insert into public.especie (nombre, precio_permiso) values (''Especie Prueba Nueva'', 800)', 'cambio', null),
            ('Municipio', m, 'Desactivar una especie', 'permitido', format('update public.especie set activa = false where id = %L', esp2), 'cambio', null),
            ('Municipio', m, 'Borrar una especie (se desactiva, no se borra)', 'rechazo', format('delete from public.especie where id = %L', espx), 'cambio', null),
            ('Municipio', m, 'Poner un precio negativo', 'rechazo', format('update public.especie set precio_permiso = -1 where id = %L', esp1), 'cambio', null),
            ('Municipio', m, 'Dar de alta una cuenta del personal', 'rechazo', format(alta, 'prueba.nueva', clave), 'cambio', null),
            ('Municipio', m, 'Cambiar la contraseña del administrador del sistema', 'rechazo', format('select public.cambiar_clave_personal(%L, %L)', s, clave), 'cambio', null),

            -- Administración del sistema
            ('Administrador', s, 'Dar un rol administrativo', 'rechazo', format('update public.usuario set rol = ''admin_municipal'' where id = %L', b), 'cambio', null),
            ('Administrador', s, 'Pasar un pescador a dueño', 'permitido', format('update public.usuario set rol = ''dueno'' where id = %L', b), 'cambio', null),
            ('Administrador', s, 'Pasar un dueño a pescador', 'permitido', format('update public.usuario set rol = ''pescador'' where id = %L', d), 'cambio', null),
            ('Administrador', s, 'Asignar un catamarán a un dueño', 'permitido', format(asignar, cat_o, d), 'cambio', null),
            ('Administrador', s, 'Desactivar una cuenta del personal', 'permitido', format('update public.usuario set activo = false where id = %L', m), 'cambio', null),
            ('Administrador', s, 'Cambiar el rol de una cuenta del personal', 'rechazo', format('update public.usuario set rol = ''admin_sistema'' where id = %L', m), 'cambio', null),
            ('Administrador', s, 'Publicar un aviso para los dueños', 'permitido', format(avisar, 'dueno', null), 'cambio',
                format('select ((count(*) filter (where id_usuario = %L)) = 1 and (count(*) filter (where id_usuario in (%L, %L, %L, %L, %L, %L))) = 0)::int from public.notificacion where tipo = ''aviso'' and created_at = now()', d, a, b, x, m, s, mx)),
            ('Administrador', s, 'Dar de alta una cuenta del personal', 'permitido', format(alta, 'prueba.nueva', clave), 'cambio',
                format('select count(*)::int from public.usuario u join auth.users au on au.id = u.id join auth.identities i on i.user_id = u.id and i.provider = ''email'' where u.email = ''prueba.nueva@pescacorral.example.com'' and u.rol = ''admin_municipal'' and u.perfil_completo and au.email_confirmed_at is not null and au.confirmation_token = '''' and au.encrypted_password = crypt(%L, nullif(au.encrypted_password, ''''))', clave)),
            ('Administrador', s, 'Dar de alta con una contraseña débil', 'rechazo', format(alta, 'prueba.nueva', 'corta'), 'cambio', null),
            ('Administrador', s, 'Dar de alta un usuario que ya existe', 'rechazo', format(alta, 'pc-prueba-m', clave), 'cambio', null),
            ('Administrador', s, 'Cambiar la contraseña de una cuenta del personal', 'permitido', format('select public.cambiar_clave_personal(%L, %L)', m, clave), 'cambio',
                format('select count(*)::int from auth.users where id = %L and encrypted_password = crypt(%L, nullif(encrypted_password, ''''))', m, clave)),
            ('Administrador', s, 'Cambiar la contraseña de un pescador', 'rechazo', format('select public.cambiar_clave_personal(%L, %L)', a, clave), 'cambio', null),

            -- Cuentas desactivadas
            ('Pescador desactivado', x, 'Reservar', 'rechazo', format(reservar, cat_d, hoy + 1, 'tarde', l3, pas1), 'cambio', null),
            ('Municipio desactivado', mx, 'Ver los usuarios', 'rechazo', format('select * from public.usuario where id = %L', a), 'lectura', null),
            ('Municipio desactivado', mx, 'Enviar el reporte municipal', 'rechazo', 'select public.generar_reporte_municipal(''general'', ''manual'')', 'cambio', null),
            ('Municipio desactivado', mx, 'Asignar un catamarán', 'rechazo', format(asignar, cat_o, d), 'cambio', null),
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

-- Las fallas, si las hay, se muestran primero; el resumen va al final.
select "N°", perfil, caso, esperado, obtenido, resultado
from (
    select n as "N°", perfil, caso, esperado, obtenido, resultado
    from _pruebas_seguridad
    union all
    select null, 'Resumen', count(*) || ' casos', '',
           count(*) filter (where resultado = 'FALLA') || ' fallas',
           case when count(*) filter (where resultado = 'FALLA') = 0 then 'OK' else 'FALLA' end
    from _pruebas_seguridad
) r
order by (r.resultado = 'FALLA' and r."N°" is not null) desc, r."N°" nulls last;
