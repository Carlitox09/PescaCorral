# PescaCorral — PWA para reservas y permisos de pesca

PescaCorral es una **aplicación web progresiva (PWA)** para la gestión de reservas de lugares en catamaranes y permisos digitales de pesca deportiva en el **Dique Cabra Corral** (Coronel Moldes, Salta). Es el prototipo tecnológico del Trabajo Final de Grado de la Licenciatura en Informática (Universidad Siglo 21).

La aplicación permite que pescadores y turistas consulten la disponibilidad de catamaranes, reserven lugares, paguen (pasarela simulada) y obtengan un permiso municipal digital con código QR. Los dueños de embarcaciones administran sus catamaranes y el Municipio cuenta con un panel de indicadores, reportes, alertas de fauna y gestión de usuarios.

**Aplicación publicada:** https://carlitox09.github.io/PescaCorral/

---

## Arquitectura (alineada con el TFG)

| Capa | Tecnología | Detalle |
| --- | --- | --- |
| Presentación | PWA en HTML5, CSS3 y JavaScript (ES Modules) | Instalable en el teléfono, service worker con caché de la interfaz, manifest. Publicada en GitHub Pages bajo HTTPS. |
| Lógica | Supabase | Auth (email + contraseña, hash, JWT, recuperación por correo), API REST generada automáticamente (PostgREST), funciones de negocio en PL/pgSQL y políticas RLS por rol. |
| Datos | PostgreSQL (gestionado por Supabase) | Esquema en `database/schema.sql`. |

No hay servidor propio ni proceso de compilación: el repositorio se sirve tal cual.

### Modos de ejecución

* **Modo Supabase** (por defecto, `config.js` con credenciales): datos reales, autenticación y RLS.
* **Modo demo** (si `config.js` queda sin credenciales): datos de ejemplo en el navegador, sin backend. Útil para probar sin conexión.

---

## Funcionalidades por historia de usuario

| HU | Funcionalidad | Dónde está |
| --- | --- | --- |
| HU-001 | Registro con validación de contraseña (8+ caracteres, mayúscula, minúscula, número, especial) | `#/registro` |
| HU-002 | Inicio de sesión; **bloqueo temporal de 15 minutos tras 3 intentos fallidos consecutivos**; recuperación de contraseña por correo | `#/login`, `#/recuperar`, `#/restablecer` |
| HU-003 | Alta y edición de catamaranes (estado, precio, capacidad, habilitación) | `#/gestion` |
| HU-004 | Disponibilidad por fecha y turno con **lugares libres por catamarán** | `#/catamaranes` |
| HU-005 | Reserva con selección visual de asientos; sin doble reserva (índice único) | `#/reserva/:id` |
| HU-006 | Permiso digital con QR, vencimiento y estado (vigente / vencido / anulado) | `#/permiso/:id` |
| HU-007 | **Pasarela de pago simulada** con escenario de rechazo y comprobante digital | modal de pago en la reserva |
| HU-008 | Reportes con gráficos, exportación CSV (Excel) y PDF | `#/reportes` |
| HU-009 | **Envío de reportes al municipio** (manual y cierre mensual automático) con registro de fecha, destinatario y origen | `#/reportes` |
| HU-010 | Historial de reservas y permisos | `#/historial` |
| HU-011 | Centro de notificaciones y **recordatorios de salida** (día previo y día de la reserva), con preferencia del usuario | campana / `#/perfil` |
| HU-012 | Gestión de roles | `#/usuarios` |
| HU-013 | Panel municipal con **filtros por rango de fechas y embarcación** | `#/admin` |
| HU-014 | Perfil de usuario | `#/perfil` |
| HU-015 | Monitoreo de fauna: permisos por especie y alertas por umbral | `#/reportes` |

---

## Estructura del proyecto

```text
PescaCorral/
├── index.html              # Punto de entrada
├── manifest.webmanifest    # Configuración de la PWA
├── service-worker.js       # Caché offline del app shell
├── config.js               # Credenciales de Supabase (anon key) y datos del municipio
├── css/styles.css
├── js/
│   ├── app.js              # Enrutador por hash, guardas de sesión y rol
│   ├── data.js             # Capa de datos: Supabase / demo (misma API)
│   ├── views.js            # Pantallas
│   ├── ui.js               # Íconos, modales, toasts, formato, reglas de contraseña
│   └── charts.js           # Gráficos SVG
├── vendor/qrcode.min.js    # Generador de QR offline
├── icons/                  # Íconos de la PWA
└── database/
    ├── schema.sql          # Esquema completo (tablas, funciones, vistas, RLS, pg_cron)
    ├── seed.sql            # Datos iniciales (especies, catamaranes, alertas)
    └── migrations/
        └── 002_seguridad_reportes_recordatorios.sql   # Para bases creadas antes de esta versión
```

---

## Puesta en marcha

### Ejecución local

Servir la carpeta con cualquier servidor estático (los módulos ES y el service worker no funcionan con `file://`):

```bash
# Python
python3 -m http.server 8080
# o Node
npx serve .
```

Abrir `http://localhost:8080`.

### Base de datos en Supabase

1. Crear un proyecto en https://supabase.com.
2. **SQL Editor → New query**: pegar y ejecutar `database/schema.sql` completo, y luego `database/seed.sql`.
3. Si la base ya existía con una versión anterior del esquema, ejecutar en cambio `database/migrations/002_seguridad_reportes_recordatorios.sql` (es idempotente). Agrega el bloqueo por intentos, la vista de ocupación, el envío de reportes y los recordatorios.
4. (Opcional) **Database → Extensions**: habilitar `pg_cron` para que el reporte mensual y los recordatorios diarios se generen sin intervención. Si no está habilitado, la app los genera al ingresar a Reportes y a la pantalla principal.

### Autenticación en Supabase

* **Authentication → Providers → Email**: habilitado. Para la demostración se puede desactivar la confirmación de correo.
* **Authentication → URL Configuration**: agregar la URL donde corre la app en *Site URL* y *Redirect URLs* (por ejemplo `https://carlitox09.github.io/PescaCorral/` y `http://localhost:8080/`). Es necesario para que el enlace de **recuperación de contraseña** vuelva a la aplicación.
* Los roles administrativos no pueden autoasignarse desde el registro. Para otorgar uno:

```sql
update public.usuario set rol = 'admin_municipal' where email = 'tu@email.com';
```

### Credenciales

`config.js` contiene la *Project URL* y la clave **anon public** (segura para el frontend: la protección real la dan las políticas RLS). Nunca publicar la clave `service_role`.

---

## Seguridad implementada

* Contraseñas almacenadas sólo como hash por Supabase Auth; sesiones con JWT.
* Reglas de complejidad de contraseña verificadas en el registro y en el restablecimiento.
* **Bloqueo temporal**: la tabla `intento_acceso` y las funciones `acceso_bloqueado` / `registrar_intento_acceso` (SECURITY DEFINER) registran los intentos fallidos por email y rechazan el ingreso durante 15 minutos a partir del tercero. La tabla no es accesible desde la API. Si las funciones no existen (migración no aplicada), la app aplica la misma política en el navegador.
* **Recuperación de contraseña** por enlace enviado al correo (`resetPasswordForEmail`); al volver, la app detecta el evento `PASSWORD_RECOVERY` y muestra la pantalla de nueva contraseña.
* **RLS**: cada perfil (pescador, dueño, administración municipal, administrador del sistema) sólo puede leer y modificar los registros que le corresponden, aun consultando la API directamente.

---

## Datos de prueba

### Cuentas del modo demo

Contraseña para todas: `Demo1234!`

| Cuenta | Rol |
| --- | --- |
| pescador@demo.com | Pescador / Turista |
| dueno@demo.com | Dueño de catamarán |
| municipio@demo.com | Administración municipal |
| admin@demo.com | Administrador del sistema |

Desde **Perfil → Reiniciar datos de demo** se restauran los datos iniciales.

### Pasarela de pago simulada

| Escenario | Dato |
| --- | --- |
| Pago aprobado | `4111 1111 1111 1111`, cualquier titular, vencimiento futuro (MM/AA), CVV de 3 dígitos |
| Pago rechazado por la entidad | cualquier número terminado en `0000` |
| Transferencia / efectivo | se registran como aprobados al confirmar |

Un pago rechazado no crea la reserva ni emite el permiso, y permite reintentar.

---

## Despliegue en GitHub Pages

Subir el contenido de la carpeta a la raíz del repositorio y, en **Settings → Pages**, elegir *Deploy from a branch* → rama `main`, carpeta `/ (root)`. El proyecto usa rutas relativas, por lo que funciona dentro de un subdirectorio. Bajo HTTPS puede instalarse como PWA desde el teléfono (*Agregar a pantalla de inicio*).

Tras cada cambio en `service-worker.js` se incrementa la constante `VERSION` para que los navegadores renueven la caché.

---

## Modelo de datos

Definido en `database/schema.sql`:

* **usuario** (extiende `auth.users`; rol), **especie**, **catamaran**, **lugar**, **reserva**, **reserva_lugar**, **permiso**, **pago**, **reporte** (con destinatario, origen y estado de envío), **notificacion** (con `id_reserva` para recordatorios), **alerta_fauna**, **intento_acceso**.
* Funciones: `crear_reserva_completa` (reserva + asientos + pago + permiso + notificación en una transacción), `anular_reserva`, `acceso_bloqueado`, `registrar_intento_acceso`, `generar_reporte_municipal`, `generar_recordatorios`, `handle_new_user` (trigger sobre `auth.users`).
* Vistas: `v_dashboard_resumen`, `v_reservas_por_dia`, `v_ocupacion_catamaran`, `v_permisos_por_especie`, `v_lugares_ocupados`.

---

## Problemas frecuentes

* **Pantalla en blanco**: la app debe servirse por `http://` o `https://`, no abrirse con doble clic.
* **Sigue en modo demo**: revisar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `config.js` y recargar con `Ctrl + Shift + R`.
* **El enlace de recuperación no vuelve a la app**: agregar la URL de la app en *Authentication → URL Configuration* de Supabase.
* **"Could not find the function…" en la consola**: falta ejecutar la migración 002; la app sigue funcionando con la política aplicada en el navegador.

---

## Autoría

Carlos Agustín Romero · Licenciatura en Informática · Universidad Siglo 21. Lugar de aplicación: Dique Cabra Corral, Municipio de Coronel Moldes, Salta.
