-- ============================================================================
--  PescaCorral · Datos de ejemplo (seed)
--  Ejecutar DESPUÉS de schema.sql, en el SQL Editor de Supabase.
--
--  Carga catamaranes, asientos (lugar) y especies. Las alertas de fauna no se
--  cargan: las genera el disparador actualizar_alerta_fauna con los permisos reales.
--  No carga usuarios: las cuentas se crean desde la app (Supabase Auth) o
--  desde Authentication -> Users en el panel de Supabase. Las reservas y
--  los permisos los generan los usuarios desde la aplicación.
-- ============================================================================

-- Limpieza de datos de ejemplo previos (no borra usuarios reales).
delete from public.alerta_fauna;
delete from public.lugar;
delete from public.catamaran;
delete from public.especie;

-- ----------------------------------------------------------------------------
-- Especies habilitadas en el embalse Cabra Corral por el reglamento provincial
-- de pesca deportiva (Res. 567/2026 de la Secretaría de Ambiente y Desarrollo
-- Sustentable de Salta, art. 26.3), con su cupo y medida mínima. El dorado no
-- se incluye: en toda la provincia sólo se pesca con devolución (art. 18).
-- Cada especie lleva su precio en el permiso de pesca (el permiso suma las
-- especies elegidas) y el umbral para las alertas de presión pesquera. Los
-- precios los cambia el municipio desde la aplicación.
-- ----------------------------------------------------------------------------
insert into public.especie (id, nombre, nombre_cientifico, precio_permiso, umbral_permisos, descripcion) values
  ('11111111-1111-1111-1111-111111111101', 'Pejerrey',     'Odontesthes bonariensis',              2000, 400,
     'Cupo: 20 por pescador y excursión. Medida mínima: 21 cm.'),
  ('11111111-1111-1111-1111-111111111103', 'Bagre blanco', 'Pimelodus albicans',                   1500, 150,
     'También llamado moncholo. Cupo: 5 por pescador y excursión. Medida mínima: 35 cm.'),
  ('11111111-1111-1111-1111-111111111105', 'Bocacha',      'Oligosarcus jenynsii y O. bolivianus', 1000, 300,
     'Cupo: 10 por pescador y excursión. Sin medida mínima.'),
  ('11111111-1111-1111-1111-111111111106', 'Mojarras',     'Astyanax sp. y Bryconamericus sp.',    1000, 300,
     'Cupo: 15 por pescador y excursión. Sin medida mínima.');

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
