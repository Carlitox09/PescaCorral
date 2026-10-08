-- ============================================================================
--  PescaCorral · Datos de ejemplo (seed)
--  Ejecutar DESPUÉS de schema.sql, en el SQL Editor de Supabase.
--
--  Carga catamaranes, asientos (lugar) y especies. Las alertas de fauna no se
--  cargan: las genera el disparador actualizar_alerta_fauna con los permisos reales.
--  No carga usuarios: las cuentas se crean desde la app (Supabase Auth) o
--  desde Authentication -> Users en el panel de Supabase. Para generar
--  reservas y permisos de demostración, ver seed_actividad_demo.sql.
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
-- catamarán, con su ubicación en el plano (ver ubicacion_lugar en schema.sql).
-- ----------------------------------------------------------------------------
do $$
declare
    c   record;
    i   integer;
    ubi text;
begin
    for c in select id, capacidad from public.catamaran loop
        for i in 1..c.capacidad loop
            ubi := public.ubicacion_lugar(i, c.capacidad);
            insert into public.lugar (id_catamaran, numero, ubicacion)
            values (c.id, i, ubi);
        end loop;
    end loop;
end $$;

-- ============================================================================
--  FIN DEL SEED
-- ============================================================================
