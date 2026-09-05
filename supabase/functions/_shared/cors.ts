// supabase/functions/_shared/cors.ts
// El sitio se sirve desde otro dominio que las funciones, así que el navegador
// pide permiso antes de cada llamada. SITIO_PERMITIDO acota quién puede pedir;
// déjalo en '*' solo mientras pruebas en local.

const ORIGEN = Deno.env.get('SITIO_PERMITIDO') ?? '*';

export const cors = {
  'Access-Control-Allow-Origin': ORIGEN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: cors }) : null;
}
