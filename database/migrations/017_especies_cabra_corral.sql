-- ============================================================================
--  PescaCorral · Migración 017: especies habilitadas en el Cabra Corral
--  Idempotente. Ejecutar en Supabase -> SQL Editor (después de la 016).
--
--  Deja las especies que el reglamento provincial de pesca deportiva habilita
--  en el embalse Cabra Corral (Res. 567/2026 de la Secretaría de Ambiente y
--  Desarrollo Sustentable de Salta, art. 26.3), con su nombre científico, su
--  cupo y su medida mínima: pejerrey, bagre blanco, bocacha y mojarras.
--    - "Bagre" pasa a "Bagre blanco" (Pimelodus albicans) y "Dentudo" a
--      "Bocacha" (Oligosarcus jenynsii, que es la bocacha; el dentudo del
--      reglamento es otra especie). Conservan su precio, su umbral y sus permisos.
--    - Se agrega "Mojarras".
--    - Las demás (dorado, carpa y cualquier otra) se borran. Si ya tienen
--      permisos emitidos no se pueden borrar sin perder ese historial: quedan
--      deshabilitadas, y la aplicación deja de ofrecerlas.
--  Los precios los sigue fijando el municipio desde la aplicación.
--
--  Después de ejecutarla: pruebas_seguridad.sql (161 casos, 0 fallas) y
--  verificar_base.sql (OK).
-- ============================================================================

do $$
declare
    e record;
begin
    -- Nombres anteriores: se renombran si la especie nueva todavía no existe.
    if not exists (select 1 from public.especie where nombre = 'Bagre blanco') then
        update public.especie set nombre = 'Bagre blanco' where nombre = 'Bagre';
    end if;
    if not exists (select 1 from public.especie where nombre = 'Bocacha') then
        update public.especie set nombre = 'Bocacha' where nombre = 'Dentudo';
    end if;

    -- Las cuatro especies del reglamento (las que faltan se agregan con el precio de ejemplo).
    insert into public.especie (nombre, nombre_cientifico, precio_permiso, umbral_permisos, descripcion) values
        ('Pejerrey',     'Odontesthes bonariensis',              2000, 400, null),
        ('Bagre blanco', 'Pimelodus albicans',                   1500, 150, null),
        ('Bocacha',      'Oligosarcus jenynsii y O. bolivianus', 1000, 300, null),
        ('Mojarras',     'Astyanax sp. y Bryconamericus sp.',    1000, 300, null)
    on conflict (nombre) do nothing;

    update public.especie as x set nombre_cientifico = v.cientifico, descripcion = v.descripcion, activa = true
    from (values
        ('Pejerrey',     'Odontesthes bonariensis',              'Cupo: 20 por pescador y excursión. Medida mínima: 21 cm.'),
        ('Bagre blanco', 'Pimelodus albicans',                   'También llamado moncholo. Cupo: 5 por pescador y excursión. Medida mínima: 35 cm.'),
        ('Bocacha',      'Oligosarcus jenynsii y O. bolivianus', 'Cupo: 10 por pescador y excursión. Sin medida mínima.'),
        ('Mojarras',     'Astyanax sp. y Bryconamericus sp.',    'Cupo: 15 por pescador y excursión. Sin medida mínima.')
    ) as v (nombre, cientifico, descripcion)
    where x.nombre = v.nombre;

    -- Las demás: se borran (sus alertas también); con permisos emitidos, se deshabilitan.
    for e in select id, nombre from public.especie
             where nombre not in ('Pejerrey', 'Bagre blanco', 'Bocacha', 'Mojarras') loop
        if exists (select 1 from public.permiso_especie where id_especie = e.id) then
            update public.especie set activa = false where id = e.id;
            raise notice 'Especie % deshabilitada: tiene permisos emitidos', e.nombre;
        else
            delete from public.especie where id = e.id;
        end if;
    end loop;
end $$;

select 'Migración 017 aplicada' as resultado,
       string_agg(nombre || case when activa then '' else ' (deshabilitada, con permisos emitidos)' end, ', ' order by nombre) as especies
from public.especie;
