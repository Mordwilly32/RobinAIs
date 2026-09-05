// public/js/supabase-config.js
// Dónde vive tu proyecto de Supabase. Copia estos dos valores desde
// Supabase → Project Settings → API y pégalos aquí.
//
// La clave `anon` está pensada para ser pública: viaja en cada visita y es la
// que el navegador usa para identificarse. Lo que protege tus datos no es
// esconderla, sino las reglas de Row Level Security del esquema.
//
// NUNCA pegues aquí la clave `service_role`: esa se salta todas las reglas.
// Va como secreto de las Edge Functions y no debe tocar el navegador jamás.

window.RR_SUPABASE = {
  url: 'https://TU-PROYECTO.supabase.co',
  anonKey: 'PEGA-AQUI-TU-CLAVE-ANON'
};

// Dos avisos tempranos, porque los dos fallos son fáciles de cometer y difíciles
// de diagnosticar después.
(function comprobarConfiguracion() {
  const { url, anonKey } = window.RR_SUPABASE;

  if (url.includes('TU-PROYECTO') || anonKey.startsWith('PEGA-AQUI')) {
    console.error(
      '[roboRobin] Falta configurar Supabase en public/js/supabase-config.js. ' +
      'Mira la sección «Puesta en marcha» del README.'
    );
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="background:#fee2e2;color:#7f1d1d;padding:14px 18px;font:600 14px system-ui;' +
        'text-align:center">Falta configurar Supabase en <code>public/js/supabase-config.js</code>.</div>');
    });
    return;
  }

  // La clave de servicio lleva "service_role" dentro de su carga útil.
  try {
    const carga = JSON.parse(atob(anonKey.split('.')[1] || ''));
    if (carga.role && carga.role !== 'anon') {
      window.RR_SUPABASE.anonKey = '';
      throw new Error(
        `[roboRobin] La clave que pegaste es de tipo "${carga.role}", no "anon". ` +
        'La clave service_role se salta todas las reglas de seguridad y no puede ir en el navegador. ' +
        'Cámbiala ya y regenérala en Supabase, porque quedó expuesta.'
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[roboRobin]')) throw err;
    // Formato desconocido: que siga, Supabase dirá si la clave no sirve.
  }
})();
