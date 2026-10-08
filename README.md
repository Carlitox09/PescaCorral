# PescaCorral: PWA para reservas y permisos de pesca

PescaCorral es una **aplicación web progresiva (PWA)** para la gestión de reservas de lugares en catamaranes y permisos digitales de pesca deportiva en el **Dique Cabra Corral** (Coronel Moldes, Salta). Es el prototipo tecnológico del Trabajo Final de Grado de la Licenciatura en Informática (Universidad Siglo 21).

La aplicación permite que pescadores y turistas consulten la disponibilidad de catamaranes, reserven lugares, paguen (pasarela simulada) y obtengan un permiso municipal digital con código QR. Los dueños de embarcaciones administran sus catamaranes y el Municipio cuenta con un panel de indicadores, reportes, alertas de fauna y gestión de usuarios.

Pescadores, turistas y dueños de catamaranes ingresan **con su cuenta de Google** (la aplicación no recibe sus contraseñas). El personal municipal y el administrador del sistema tienen **accesos propios con usuario y contraseña**: `/Municipio` y `/Admin`.

**Aplicación publicada:** https://carlitox09.github.io/PescaCorral/

---

## Arquitectura (alineada con el TFG)

| Capa | Tecnología | Detalle |
| --- | --- | --- |
| Presentación | PWA en HTML5, CSS3 y JavaScript (ES Modules) | Instalable en el teléfono, service worker con caché de la interfaz, manifest. Publicada en GitHub Pages bajo HTTPS. |
| Lógica | Supabase | Auth con proveedor Google (OAuth 2.0 / OpenID Connect, flujo PKCE, sesiones JWT), API REST generada automáticamente (PostgREST), funciones de negocio en PL/pgSQL y políticas RLS por rol. |
| Datos | PostgreSQL (gestionado por Supabase) | Esquema en `database/schema.sql`. |

No hay servidor propio ni proceso de compilación: el repositorio se sirve tal cual.

### Modos de ejecución

* **Modo Supabase** (por defecto, `config.js` con credenciales): datos reales, ingreso con Google y RLS.
* **Modo demo** (si `config.js` queda sin credenciales): datos de ejemplo en el navegador, sin backend. El ingreso con Google se simula con un selector de cuentas de ejemplo.

---

## Funcionalidades por historia de usuario

| HU | Funcionalidad | Dónde está |
| --- | --- | --- |
| HU-001 | Registro en el primer ingreso con Google: se crea la cuenta con los datos de Google y se solicitan DNI, teléfono y tipo de cuenta | `#/registro` |
| HU-002 | Inicio de sesión con Google para el público y con usuario y contraseña para el personal; mensaje de error si se cancela o las credenciales son incorrectas; redirección al ingreso sin sesión | `#/login`, `/Municipio`, `/Admin` |
| HU-003 | Alta y edición de catamaranes (estado, precio, capacidad, habilitación) | `#/gestion` |
| HU-004 | Disponibilidad por fecha y turno con **lugares libres por catamarán** (cada asiento se reserva por fecha y turno) | `#/catamaranes` |
| HU-005 | Reserva sobre el **plano del catamarán** visto desde arriba (proa, popa, babor y estribor; numeración en sentido horario desde la proa); marca los lugares propios y avisa si ya hay una reserva en el otro turno; sin doble reserva (índice único por asiento, fecha y turno) | `#/reserva/:id` |
| HU-006 | Permiso digital con QR, vencimiento y estado (vigente / vencido / anulado). En la reserva se elige **"Comprar permiso"** (diario, semanal o anual, con su tarifa) o **"Ya tengo permiso"** (se valida el número: mismo titular, no anulado y vigente para la fecha). Se comparte como imagen por WhatsApp u otras aplicaciones | `#/permiso/:id` |
| HU-007 | **Pasarela de pago simulada** (tarjeta, Mercado Pago o efectivo en la boletería) con escenario de rechazo. Al pagar se muestra el **comprobante**: número de reserva, comprobante de pago y permiso | `#/comprobante/:id` |
| HU-008 | Reportes con gráficos, exportación CSV (Excel) y PDF | `#/reportes` |
| HU-009 | **Envío de reportes al municipio** (manual y cierre mensual automático) con registro de fecha, destinatario y origen | `#/reportes` |
| HU-010 | Historial de reservas y permisos | `#/historial` |
| HU-011 | Centro de notificaciones y **recordatorios de salida** (día previo y día de la reserva), con preferencia del usuario | campana / `#/perfil` |
| HU-012 | Gestión de roles y activación o desactivación de cuentas | `#/usuarios` |
| HU-013 | Panel municipal con **filtros por rango de fechas y embarcación** y exportación PDF | `#/admin` |
| HU-014 | Perfil de usuario | `#/perfil` |
| HU-015 | Monitoreo de fauna: permisos por especie y **alertas automáticas** cuando los permisos del mes alcanzan el 80 % del umbral | `#/reportes` |

---

## Estructura del proyecto

```text
PescaCorral/
├── index.html              # Punto de entrada
├── 404.html                # Redirige /municipio y /admin en cualquier combinación de mayúsculas
├── Municipio/index.html    # /Municipio: acceso del personal municipal (#/acceso/municipio)
├── Admin/index.html        # /Admin: acceso del administrador del sistema (#/acceso/admin)
├── manifest.webmanifest    # Configuración de la PWA
├── service-worker.js       # Caché offline del app shell
├── config.js               # Credenciales de Supabase (anon key) y datos del municipio
├── css/styles.css
├── js/
│   ├── app.js              # Enrutador por hash, guardas de sesión, primer ingreso y rol
│   ├── data.js             # Capa de datos: Supabase / demo (misma API)
│   ├── views.js            # Pantallas
│   ├── ui.js               # Íconos, modales, toasts y formato
│   └── charts.js           # Gráficos SVG
├── vendor/qrcode.min.js    # Generador de QR offline
├── icons/                  # Íconos de la PWA
└── database/
    ├── schema.sql          # Esquema completo (tablas, funciones, vistas, RLS, pg_cron)
    ├── seed.sql            # Datos iniciales (especies, catamaranes, alertas)
    ├── seed_actividad_demo.sql   # Reservas, permisos y alertas para presentar el panel
    ├── verificar_base.sql  # Chequeo de sólo lectura: compara la base con schema.sql y revisa los datos
    └── migrations/         # Para bases creadas con versiones anteriores del esquema
        ├── 002_seguridad_reportes_recordatorios.sql
        ├── 003_ingreso_con_google.sql
        ├── 004_turnos_alertas_reportes.sql
        ├── 005_acceso_personal.sql
        ├── 006_permiso_propio_comprobante.sql
        ├── 007_mantenimiento_datos_al_dia.sql
        └── 008_cuentas_publicas_solo_google.sql
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
3. Si la base ya existía con una versión anterior del esquema, ejecutar en cambio las migraciones de `database/migrations/` en orden (son idempotentes): 002 a 008.
4. Para comprobar que la base coincide con el esquema y que los datos están al día, ejecutar `database/verificar_base.sql` (no modifica nada): devuelve una fila por cada diferencia, o "OK".
5. (Opcional) **Database → Extensions**: habilitar `pg_cron` para que el reporte mensual y los recordatorios diarios se generen sin intervención. Si no está habilitado, la app los genera al ingresar a Reportes y a la pantalla principal.

### Ingreso con Google

Se configura una sola vez, en dos consolas.

**En Google Cloud** (https://console.cloud.google.com):

1. Crear un proyecto.
2. **APIs y servicios → Pantalla de consentimiento de OAuth** (Google Auth Platform): tipo de usuario *Externo*, nombre de la aplicación, correo de asistencia y de contacto. Los permisos básicos (`openid`, `email`, `profile`) alcanzan.
3. En **Público**, publicar la aplicación (*En producción*) para que cualquier cuenta de Google pueda ingresar. Mientras esté *En prueba*, solo ingresan los usuarios de prueba agregados a mano.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   * Orígenes de JavaScript autorizados: `https://carlitox09.github.io` y `http://localhost:8080`.
   * URI de redireccionamiento autorizados: `https://<proyecto>.supabase.co/auth/v1/callback` (la *Project URL* de Supabase seguida de `/auth/v1/callback`).
5. Copiar el **ID de cliente** y el **secreto del cliente**.

**En Supabase**:

1. **Authentication → Sign In / Providers → Google**: habilitar y pegar el ID de cliente y el secreto.
2. **Authentication → URL Configuration**: *Site URL* `https://carlitox09.github.io/PescaCorral/`; en *Redirect URLs* agregar `https://carlitox09.github.io/PescaCorral/**` y `http://localhost:8080/**`.
3. **Authentication → Sign In / Providers → Email**: habilitar con *Confirm email* encendido, mínimo de 12 caracteres y contraseñas con minúsculas, mayúsculas, números y símbolos. Lo usa sólo el personal: el trigger `handle_new_user` rechaza cualquier alta con contraseña que no esté autorizada en `personal_autorizado`.

En el primer ingreso de cada persona, el trigger `handle_new_user` crea el perfil con el nombre, el correo y la foto de Google; la aplicación pide DNI, teléfono y tipo de cuenta antes de habilitar el resto de las pantallas.

### Acceso del personal (usuario y contraseña)

El personal municipal ingresa por `https://carlitox09.github.io/PescaCorral/Municipio` y el administrador del sistema por `.../Admin`. El usuario es un nombre corto (`municipio`, `admin`) que la aplicación traduce a `<usuario>@pescacorral.example.com`, un dominio reservado que no recibe correos (`DOMINIO_PERSONAL` en `config.js`). Cada acceso acepta sólo su rol: `/Municipio` → `admin_municipal`, `/Admin` → `admin_sistema`.

Alta de una cuenta (no hay registro abierto):

1. En el SQL Editor (la autorización vence a los 15 minutos y se usa una sola vez):
   ```sql
   insert into public.personal_autorizado (usuario, email, rol, nombre, apellido)
   values ('municipio', 'municipio@pescacorral.example.com', 'admin_municipal', 'Nombre', 'Apellido');
   ```
2. **Authentication → Users → Add user → Create new user**: ese correo, la contraseña y *Auto Confirm User* tildado. El trigger crea el perfil con el rol autorizado.

Para el administrador del sistema se repite con `'admin'`, `'admin@pescacorral.example.com'` y `'admin_sistema'`.

### Roles administrativos

Toda cuenta nueva de Google es *Pescador/Turista* (o *Dueño de catamarán*, si lo elige en el alta). Los roles administrativos no pueden autoasignarse: el trigger `proteger_perfil` impide que un usuario cambie su rol, su correo o su estado. Las cuentas del personal reciben su rol al crearse, desde `personal_autorizado`.

### Credenciales

`config.js` contiene la *Project URL* y la clave **anon public** (segura para el frontend: la protección real la dan las políticas RLS). Nunca publicar la clave `service_role` ni el secreto del cliente de Google.

---

## Seguridad implementada

* **Público con Google**: la identidad de pescadores, turistas y dueños la verifica Google (OAuth 2.0 / OpenID Connect). Contraseña, verificación en dos pasos, detección de accesos sospechosos y recuperación de la cuenta quedan a cargo de Google.
* **Personal con usuario y contraseña**: cuentas creadas sólo por la administración (`personal_autorizado` + trigger), contraseñas de al menos 12 caracteres guardadas cifradas por Supabase Auth, límite de intentos de Supabase y mensaje genérico ante credenciales incorrectas. Cada acceso admite sólo su rol.
* **Sesiones JWT** emitidas por Supabase Auth, con renovación automática. El flujo PKCE devuelve un código de un solo uso (`?code=`) que la aplicación intercambia por la sesión.
* **Primer ingreso controlado**: sin DNI y tipo de cuenta confirmados, el enrutador solo permite la pantalla de alta.
* **Protección del perfil** (trigger `proteger_perfil`): un usuario no puede cambiar su rol, su correo ni el estado de su cuenta; el tipo de cuenta se elige una sola vez.
* **Cuentas desactivadas**: la administración puede desactivar una cuenta desde `#/usuarios`; con `activo = false`, la aplicación cierra la sesión y rechaza el ingreso.
* **RLS**: cada perfil (pescador, dueño, administración municipal, administrador del sistema) solo puede leer y modificar los registros que le corresponden, aun consultando la API directamente.

---

## Datos de prueba

### Cuentas del modo demo

En modo demo, **Continuar con Google** abre un selector con las cuentas del público. *Usar otra cuenta* simula el primer ingreso de una persona nueva. El personal entra por su acceso con usuario y contraseña.

| Cuenta | Rol | Ingreso |
| --- | --- | --- |
| pescador@demo.com | Pescador / Turista | Google (simulado) |
| dueno@demo.com | Dueño de catamarán | Google (simulado) |
| `municipio` / `Municipio.2026` | Administración municipal | `/Municipio` |
| `admin` / `Admin.2026` | Administrador del sistema | `/Admin` |

Desde **Perfil → Reiniciar datos de demo** se restauran los datos iniciales.

### Actividad para presentar el panel (modo Supabase)

`database/seed_actividad_demo.sql` genera reservas de los últimos 30 días y de los próximos 3, con pagos, permisos, notificaciones y alertas de fauna del mes. Requiere que la cuenta de pescador ya haya ingresado con Google: se reemplaza su correo en la variable `v_email` y se ejecuta el archivo en el SQL Editor.

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

* **usuario** (extiende `auth.users`; rol, perfil completo, foto de Google), **especie**, **catamaran**, **lugar** (con su ubicación en el plano), **reserva** (número `RES-`, permiso que ampara la salida e importe del permiso), **reserva_lugar** (asiento por fecha y turno), **permiso**, **tarifa_permiso**, **pago** (con código de autorización), **reporte** (con destinatario, origen y estado de envío), **notificacion** (con `id_reserva` para recordatorios), **alerta_fauna**.
* Funciones: `crear_reserva_completa` (valida catamarán, asientos, fecha, turno, medio de pago y permiso propio, y crea reserva + asientos + pago + permiso nuevo + notificación en una transacción), `validar_permiso`, `ubicacion_lugar`, `actualizar_estados` (marca permisos vencidos y salidas realizadas; la llama `generar_recordatorios` a diario), `anular_reserva` (no anula un permiso que ampara otra reserva activa), `generar_reporte_municipal` (el automático resume el mes que cerró), `generar_recordatorios`, `handle_new_user` (alta del perfil con los datos de Google) y `proteger_perfil` (protección de rol, correo y estado).
* Disparador `actualizar_alerta_fauna`: al emitirse un permiso, si los permisos del mes de la especie alcanzan el 80 % del umbral, registra la alerta y avisa a la administración municipal.
* Vistas: `v_dashboard_resumen`, `v_reservas_por_dia`, `v_ocupacion_catamaran`, `v_permisos_por_especie`, `v_lugares_ocupados`.

---

## Problemas frecuentes

* **Pantalla en blanco**: la app debe servirse por `http://` o `https://`, no abrirse con doble clic.
* **Sigue en modo demo**: revisar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `config.js` y recargar con `Ctrl + Shift + R`.
* **"El ingreso con Google todavía no está habilitado"**: falta habilitar el proveedor Google en Supabase.
* **Google muestra "Error 400: redirect_uri_mismatch"**: el URI de redireccionamiento del cliente de OAuth debe ser exactamente `https://<proyecto>.supabase.co/auth/v1/callback`.
* **Después de elegir la cuenta vuelve a otra dirección**: agregar la dirección de la app en *Authentication → URL Configuration → Redirect URLs*.
* **Solo pueden ingresar algunas cuentas**: la pantalla de consentimiento de Google sigue *En prueba*; publicarla.
* **El proyecto de Supabase no responde**: en el plan gratuito se pausa tras siete días sin actividad; reactivarlo desde el panel.

---

## Autoría

Carlos Agustín Romero · Licenciatura en Informática · Universidad Siglo 21. Lugar de aplicación: Dique Cabra Corral, Municipio de Coronel Moldes, Salta.
