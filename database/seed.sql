-- ============================================================================
--  PescaCorral · Datos de ejemplo (seed)
--  Ejecutar DESPUÉS de schema.sql, en el SQL Editor de Supabase.
--
--  Carga catamaranes, asientos (lugar), especies y alertas de fauna.
--  No carga usuarios: las cuentas se crean desde la app (Supabase Auth) o
--  desde Authentication -> Users en el panel de Supabase. Al final de este
--  archivo hay un bloque OPCIONAL para generar reservas y permisos de demo
--  una vez que exista al menos un usuario.
-- ============================================================================

-- Limpieza de datos de ejemplo previos (no borra usuarios reales).
delete from public.alerta_fauna;
delete from public.lugar;
delete from public.catamaran;
delete from public.especie;

-- ----------------------------------------------------------------------------
-- Especies habilitadas (con umbral para alertas de presión pesquera).
-- ----------------------------------------------------------------------------
insert into public.especie (id, nombre, nombre_cientifico, umbral_permisos, descripcion) values
  ('11111111-1111-1111-1111-111111111101', 'Pejerrey', 'Odontesthes bonariensis', 400,
     'Especie principal de pesca deportiva en el Dique Cabra Corral.'),
  ('11111111-1111-1111-1111-111111111102', 'Dorado',   'Salminus brasiliensis',   150,
     'Especie de gran porte; pesca con devolución recomendada.'),
  ('11111111-1111-1111-1111-111111111103', 'Bagre',    'Rhamdia quelen',          300,
     'Captura frecuente en aguas del dique.'),
  ('11111111-1111-1111-1111-111111111104', 'Carpa',    'Cyprinus carpio',         500,
     'Especie de control poblacional.');

-- ----------------------------------------------------------------------------
-- Catamaranes (mismos datos que los prototipos del TFG).
-- ----------------------------------------------------------------------------
insert into public.catamaran (id, nombre, descripcion, capacidad, precio, habilitacion, estado) values
  ('22222222-2222-2222-2222-222222222201', 'Don Juan II', 'Catamarán techado, ideal para jornadas de día completo.', 20, 8000.00, 'HAB-CM-001', 'activa'),
  ('22222222-2222-2222-2222-222222222202', 'El Pato',     'Embarcación ágil para grupos reducidos.',                 16, 7500.00, 'HAB-CM-002', 'activa'),
  ('22222222-2222-2222-2222-222222222203', 'La Victoria', 'Amplio espacio y sombra; muy elegida por turistas.',      18, 8500.00, 'HAB-CM-003', 'activa'),
  ('22222222-2222-2222-2222-222222222204', 'Don Pescador','Servicio premium con guía de pesca incluido.',            12, 9500.00, 'HAB-CM-004', 'activa'),
  ('22222222-2222-2222-2222-222222222205', 'Lago Azul',   'Embarcación en mantenimiento programado.',                14, 7000.00, 'HAB-CM-005', 'mantenimiento');

-- ----------------------------------------------------------------------------
-- Asientos (lugar): se generan automáticamente según la capacidad de cada
-- catamarán, con ubicación alternada (babor / estribor).
-- ----------------------------------------------------------------------------
do $$
declare
    c   record;
    i   integer;
    ubi text;
begin
    for c in select id, capacidad from public.catamaran loop
        for i in 1..c.capacidad loop
            ubi := case when i % 2 = 0 then 'estribor' else 'babor' end;
            insert into public.lugar (id_catamaran, numero, ubicacion)
            values (c.id, i, ubi);
        end loop;
    end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Alertas de fauna activas (el panel municipal muestra "3 alertas").
-- ----------------------------------------------------------------------------
insert into public.alerta_fauna (id_especie, periodo, permisos_emitidos, umbral, estado) values
  ('11111111-1111-1111-1111-111111111101', '2026-05', 380, 400, 'activa'),
  ('11111111-1111-1111-1111-111111111102', '2026-05', 140, 150, 'activa'),
  ('11111111-1111-1111-1111-111111111103', '2026-05', 290, 300, 'activa');

-- ============================================================================
--  BLOQUE OPCIONAL · Reservas y permisos de demostración
--  ----------------------------------------------------------------------------
--  Para que el Panel Municipal y la pantalla de Reportes muestren números en
--  Supabase, necesitás al menos un usuario. Pasos:
--    1. Registrate desde la app (o creá un usuario en Authentication -> Users).
--    2. Copiá su UUID (columna "id" en la tabla public.usuario).
--    3. Reemplazá 'PEGAR-UUID-DE-USUARIO-AQUI' abajo y ejecutá SOLO este bloque.
-- ============================================================================
/*
do $$
declare
    v_uid     uuid := 'PEGAR-UUID-DE-USUARIO-AQUI';
    v_cat     uuid := '22222222-2222-2222-2222-222222222201'; -- Don Juan II
    v_lugares uuid[];
    d         integer;
begin
    for d in 0..6 loop
        -- Toma 2 asientos libres del catamarán para cada día simulado.
        select array_agg(l.id) into v_lugares
        from (
            select id from public.lugar
            where id_catamaran = v_cat
              and id not in (
                  select id_lugar from public.reserva_lugar
                  where fecha = (current_date - d) and estado = 'confirmada')
            order by numero
            limit 2
        ) l;

        if v_lugares is not null then
            perform public.crear_reserva_completa(
                v_cat,
                (current_date - d),
                'manana',
                v_lugares,
                'tarjeta',
                'diario',
                '11111111-1111-1111-1111-111111111101'  -- Pejerrey
            );
        end if;
    end loop;
end $$;
*/

-- ============================================================================
--  FIN DEL SEED
-- ============================================================================
