/* ============================================================================
 *  PescaCorral · Configuración
 * ----------------------------------------------------------------------------
 *  Pegá acá las credenciales de tu proyecto Supabase.
 *  Las encontrás en:  Supabase  ->  Project Settings  ->  API
 *
 *    SUPABASE_URL       =  "Project URL"        (https://xxxx.supabase.co)
 *    SUPABASE_ANON_KEY  =  "anon public" key
 *
 *  IMPORTANTE
 *  - La clave "anon public" es segura de exponer en el front-end: la seguridad
 *    real la imponen las políticas RLS de la base de datos (ver database/schema.sql).
 *  - NUNCA pegues acá la clave "service_role".
 *
 *  Si dejás los valores vacíos, la app arranca en MODO DEMO (datos de ejemplo
 *  guardados en el navegador), ideal para probar o presentar sin backend.
 * ========================================================================== */
window.PESCACORRAL_CONFIG = {
  SUPABASE_URL: "https://xllcpqjhvlzqfvfrrbld.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_gNn1CsfPKQQnD7r0HRnphw__dybd1b_",

  // Marca municipal mostrada en la app.
  MUNICIPIO: "Municipio de Coronel Moldes",
  LUGAR: "Dique Cabra Corral",
};
