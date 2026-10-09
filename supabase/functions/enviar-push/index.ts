// ============================================================================
//  PescaCorral · Edge Function "enviar-push"
//  Manda al teléfono (Web Push) una notificación ya creada en la base: un aviso
//  del municipio, el aviso de un dueño sobre una salida o un recordatorio. La
//  llama el disparador trg_notificacion_push (pg_net) con el id de la
//  notificación. Sólo envía notificaciones recientes que todavía no se enviaron
//  y las marca como enviadas: aunque alguien la llame con otro id, no puede
//  mandar mensajes propios ni repetir uno.
//
//  Secretos (Supabase -> Edge Functions -> Secrets): VAPID_PUBLIC_KEY,
//  VAPID_PRIVATE_KEY y VAPID_CONTACTO. SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
//  los provee Supabase. Se despliega con "Verify JWT" desactivado, porque la
//  llama la base de datos, sin sesión de usuario.
// ============================================================================
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
webpush.setVapidDetails(
  Deno.env.get("VAPID_CONTACTO") ?? "https://carlitox09.github.io/PescaCorral/",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const RECIENTE_MS = 10 * 60 * 1000;   // sólo notificaciones de los últimos 10 minutos
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !UUID.test(id)) return new Response("Falta el id de la notificación", { status: 400 });

  // Se marca como enviada y se lee en la misma operación: una sola vez por notificación.
  const { data: n, error } = await supabase.from("notificacion")
    .update({ push_enviada: new Date().toISOString() })
    .eq("id", id)
    .is("push_enviada", null)
    .gte("created_at", new Date(Date.now() - RECIENTE_MS).toISOString())
    .select("id, id_usuario, id_reserva, titulo, mensaje")
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!n) return Response.json({ enviados: 0 });

  const { data: dispositivos } = await supabase.from("suscripcion_push")
    .select("id, endpoint, p256dh, auth").eq("id_usuario", n.id_usuario);
  const mensaje = JSON.stringify({
    titulo: n.titulo,
    mensaje: n.mensaje,
    etiqueta: n.id,
    ruta: n.id_reserva ? `#/comprobante/${n.id_reserva}` : "#/home",
  });

  let enviados = 0;
  await Promise.all((dispositivos ?? []).map(async (d) => {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        mensaje,
        { TTL: 6 * 3600, urgency: "high" },
      );
      enviados++;
    } catch (e) {
      const estado = (e as { statusCode?: number }).statusCode;
      // 404 o 410: el navegador dio de baja la suscripción; se borra.
      if (estado === 404 || estado === 410) await supabase.from("suscripcion_push").delete().eq("id", d.id);
      else console.error("Web Push:", estado, (e as { body?: string }).body ?? String(e));
    }
  }));
  return Response.json({ enviados });
});
