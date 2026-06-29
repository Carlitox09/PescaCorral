# PescaCorral — PWA para reservas y permisos de pesca

PescaCorral es una aplicación web progresiva orientada a la gestión de reservas y permisos de pesca deportiva en el **Dique Cabra Corral**, ubicado en Coronel Moldes, Salta.

El sistema permite que pescadores y turistas puedan consultar catamaranes disponibles, reservar lugares, realizar un pago simulado y obtener un permiso municipal digital con código QR. También contempla el uso por parte de los dueños de embarcaciones, quienes pueden administrar sus catamaranes, y del Municipio, que cuenta con un panel para consultar información general sobre reservas, permisos, ingresos y actividad pesquera.

Este repositorio forma parte del desarrollo del Trabajo Final de Grado y contiene dos componentes principales:

1. Una **PWA** desarrollada con HTML, CSS y JavaScript vanilla, sin frameworks ni procesos de compilación.
2. Una **base de datos relacional** preparada para PostgreSQL / Supabase, ubicada en la carpeta `database/`.

La aplicación puede ejecutarse en **modo demo**, utilizando datos de ejemplo almacenados en el navegador. Si se cargan las credenciales de Supabase en el archivo `config.js`, la aplicación pasa a trabajar con una base de datos real, autenticación de usuarios y políticas de seguridad por filas.

---

## Funcionalidades principales

### Pescador / turista

* Registro e inicio de sesión.
* Búsqueda de catamaranes por fecha y turno.
* Selección visual de asientos disponibles.
* Generación de reserva.
* Pago simulado.
* Emisión de permiso digital con código QR.
* Consulta de historial de reservas y permisos.
* Recepción de notificaciones.

### Dueño de catamarán

* Alta y edición de embarcaciones.
* Configuración de estado, precio, capacidad y habilitación.
* Consulta de información vinculada a sus catamaranes.

### Administración municipal

* Panel con indicadores generales.
* Consulta de reservas, permisos e ingresos.
* Gráficos de reservas por día y permisos por especie.
* Visualización de ocupación por catamarán.
* Gestión de usuarios y roles.
* Exportación de reportes en PDF y CSV.
* Monitoreo de fauna mediante alertas por umbrales de permisos.

### Características PWA

* Instalación en dispositivos móviles.
* Funcionamiento offline mediante service worker.
* Íconos y configuración para instalación.
* Compatible con despliegue en GitHub Pages.

---

## Estructura del proyecto

```text
pescacorral/
├── index.html              # Punto de entrada de la aplicación
├── manifest.webmanifest    # Configuración de la PWA
├── service-worker.js       # Caché offline
├── config.js               # Configuración de Supabase
├── css/
│   └── styles.css          # Estilos generales de la aplicación
├── js/
│   ├── app.js              # Enrutamiento y arranque de la app
│   ├── data.js             # Capa de datos: demo localStorage / Supabase
│   ├── views.js            # Renderizado de pantallas
│   ├── ui.js               # Funciones de interfaz, modales, toasts e íconos
│   └── charts.js           # Gráficos SVG
├── vendor/
│   └── qrcode.min.js       # Generador de códigos QR offline
├── icons/                  # Íconos de la PWA
└── database/
    ├── schema.sql          # Esquema relacional, funciones, vistas y RLS
    └── seed.sql            # Datos iniciales
```

---

## Ejecución rápida en modo demo

Para probar la aplicación no es necesario configurar un backend. En este modo se utilizan datos de ejemplo guardados en el navegador.

Se recomienda ejecutarla desde un servidor local, ya que el service worker y los módulos JavaScript pueden presentar problemas si se abre directamente el archivo `index.html`.

```bash
cd pescacorral
python3 -m http.server 8080
```

Luego abrir en el navegador:

```text
http://localhost:8080
```

No se recomienda abrir el proyecto con doble clic sobre `index.html`, porque el protocolo `file://` puede bloquear algunas funciones de la aplicación.

---

## Cuentas demo

La aplicación incluye usuarios de prueba. La contraseña para todas las cuentas es:

```text
Demo1234!
```

| Cuenta                                          | Rol                       |
| ----------------------------------------------- | ------------------------- |
| [pescador@demo.com](mailto:pescador@demo.com)   | Pescador / Turista        |
| [dueno@demo.com](mailto:dueno@demo.com)         | Dueño de catamarán        |
| [municipio@demo.com](mailto:municipio@demo.com) | Administración municipal  |
| [admin@demo.com](mailto:admin@demo.com)         | Administrador del sistema |

Desde la sección **Perfil → Reiniciar datos de demo** se pueden restaurar los datos iniciales.

---

## Despliegue en GitHub Pages

Para publicar la aplicación en GitHub Pages, se debe crear un repositorio y subir el contenido de la carpeta del proyecto a la raíz.

```bash
cd pescacorral
git init
git add .
git commit -m "PescaCorral PWA"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/pescacorral.git
git push -u origin main
```

Luego, desde GitHub:

1. Entrar al repositorio.
2. Ir a **Settings → Pages**.
3. En **Build and deployment**, seleccionar **Deploy from a branch**.
4. Elegir la rama **main** y la carpeta **/ (root)**.
5. Guardar los cambios.

La aplicación quedará publicada en una URL similar a:

```text
https://TU_USUARIO.github.io/pescacorral/
```

El proyecto utiliza rutas relativas, por lo que puede funcionar correctamente aunque GitHub Pages lo publique dentro de un subdirectorio.

Al estar publicado bajo HTTPS, también puede instalarse como PWA desde un teléfono celular mediante la opción **Agregar a pantalla de inicio**.

---

## Conexión con Supabase

La aplicación puede trabajar con Supabase para guardar datos reales en PostgreSQL, usar autenticación y aplicar reglas de seguridad mediante RLS.

### 1. Crear el proyecto en Supabase

1. Ingresar a Supabase.
2. Crear un nuevo proyecto.
3. Definir nombre, contraseña de base de datos y región.

### 2. Crear la base de datos

Desde el panel de Supabase:

1. Ir a **SQL Editor → New query**.
2. Pegar el contenido completo de `database/schema.sql`.
3. Ejecutar la consulta.
4. Crear una nueva consulta.
5. Pegar el contenido de `database/seed.sql`.
6. Ejecutar nuevamente.

El archivo `schema.sql` crea las tablas, funciones, vistas y políticas de seguridad. También incluye la función `crear_reserva_completa`, que registra la reserva, los asientos, el pago y el permiso en una única operación. Además, se utiliza un trigger sobre `auth.users` para crear automáticamente el perfil del usuario registrado dentro de la tabla `usuario`.

El archivo `seed.sql` carga datos iniciales, como especies y catamaranes de ejemplo.

### 3. Configurar autenticación

Para facilitar la demostración del sistema, se puede desactivar la confirmación por correo electrónico:

1. Ir a **Authentication → Providers → Email**.
2. Verificar que el proveedor Email esté habilitado.
3. Desactivar la opción de confirmación de email si se desea que el usuario pueda iniciar sesión inmediatamente luego de registrarse.

En un entorno de producción, se recomienda mantener la confirmación de email activada.

### 4. Cargar credenciales

Desde Supabase:

1. Ir a **Project Settings → API**.
2. Copiar el **Project URL**.
3. Copiar la clave **anon public**.
4. Abrir el archivo `config.js`.
5. Completar los valores correspondientes.

```js
window.PESCACORRAL_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  MUNICIPIO: "Municipio de Coronel Moldes",
  LUGAR: "Dique Cabra Corral",
};
```

Después de modificar `config.js`, se deben subir los cambios al repositorio:

```bash
git add config.js
git commit -m "Configurar Supabase"
git push
```

Una vez desplegado el cambio, la aplicación dejará de usar el modo demo y comenzará a trabajar con Supabase.

La clave `anon public` puede usarse en el frontend, ya que está pensada para clientes públicos. La protección de los datos depende de las políticas RLS definidas en la base de datos. No debe publicarse la clave `service_role`.

---

## Crear un usuario administrador

Por seguridad, los usuarios registrados desde la aplicación no pueden asignarse roles administrativos por sí mismos.

Los roles administrativos deben asignarse manualmente desde Supabase o desde otro usuario administrador ya existente.

Para asignar el rol de administrador municipal a un usuario registrado, se puede ejecutar la siguiente consulta en el SQL Editor:

```sql
update public.usuario
set rol = 'admin_municipal'
where email = 'tu@email.com';
```

También puede utilizarse el panel de usuarios de la aplicación, siempre que ya exista un usuario con permisos administrativos.

---

## Modelo de datos

El modelo relacional se encuentra definido en `database/schema.sql`. Las entidades principales son:

* **usuario**: almacena los datos del usuario y su rol dentro del sistema.
* **catamaran**: representa cada embarcación habilitada.
* **lugar**: representa los asientos o lugares disponibles dentro de cada catamarán.
* **reserva**: registra la reserva realizada por un usuario para una fecha, turno y catamarán.
* **reserva_lugar**: vincula la reserva con los asientos seleccionados.
* **permiso**: almacena el permiso digital emitido, su numeración, vencimiento y código QR.
* **pago**: registra el pago asociado a una reserva.
* **especie**: contiene las especies utilizadas para el control de actividad pesquera.
* **alerta_fauna**: permite registrar alertas relacionadas con la presión sobre especies.
* **notificacion**: almacena avisos para los usuarios.
* **reporte**: guarda reportes generados desde el panel municipal.

Entre las reglas principales del modelo se incluye la prevención de doble reserva de un mismo asiento en una misma fecha y turno, la emisión de permisos asociados a reservas y el aislamiento de datos según el rol del usuario mediante RLS.

---

## Historias de usuario contempladas

El sistema cubre las principales funcionalidades previstas para el prototipo:

* Registro e inicio de sesión.
* Gestión de roles.
* Alta y edición de catamaranes.
* Búsqueda de disponibilidad.
* Reserva de lugares.
* Generación de permiso digital.
* Pago simulado.
* Consulta de historial.
* Notificaciones.
* Panel municipal.
* Reportes.
* Monitoreo de fauna.

---

## Tecnologías utilizadas

* **HTML5**
* **CSS3**
* **JavaScript ES Modules**
* **Web App Manifest**
* **Service Worker**
* **Supabase**
* **PostgreSQL**
* **Row Level Security**
* **qrcode-generator**
* **SVG para gráficos**

La propuesta original del TFG contemplaba una arquitectura con Flutter, Node.js/Express y PostgreSQL. Para esta implementación se adaptó el mismo modelo de datos y las mismas reglas de negocio a una PWA con Supabase, lo que permite publicar el prototipo de forma gratuita en GitHub Pages y mantener una base de datos relacional.

---

## Problemas frecuentes

### La pantalla queda en blanco

Verificar que la aplicación se esté ejecutando mediante `http://` o `https://`. No se recomienda abrir el archivo directamente con `file://`.

### La app sigue en modo demo después de configurar Supabase

Revisar que `SUPABASE_URL` y `SUPABASE_ANON_KEY` estén completos en `config.js`. También puede ser necesario forzar la recarga del navegador con `Ctrl + Shift + R`, ya que el service worker puede conservar archivos anteriores en caché.

### El registro no inicia sesión automáticamente

Esto puede ocurrir si Supabase tiene activada la confirmación por correo electrónico. Se puede desactivar para la demostración o confirmar el correo antes de iniciar sesión.

### Quiero restaurar los datos de ejemplo

Ingresar a **Perfil → Reiniciar datos de demo**.

---

## Autoría y contexto

Proyecto desarrollado como parte del Trabajo Final de Grado, orientado a la digitalización de reservas y permisos de pesca deportiva en el Dique Cabra Corral.

Lugar de aplicación: **Dique Cabra Corral — Municipio de Coronel Moldes, Salta**.
