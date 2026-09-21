// public/js/plans-ui.js
// La pantalla de planes de una cuenta personal.
//
// Tres planes y tres formas de pagarlos. El selector de arriba cambia los tres
// precios a la vez, porque lo que la gente compara no es "20 al mes" contra
// "68 cada 4 meses": es cuánto le sale el mes en cada caso.
//
// No hay cobro de verdad en ninguna parte del proyecto, y eso se dice en
// pantalla en vez de fingir una pasarela de pago que no existe.
//
// Los planes se comparan en PORCENTAJE contra el plan Gratis, no en cifras de
// mensajes: "1 500 % más" se entiende sin tener que saber de cuánto se partía.
// Los números exactos están publicados en /terminos#limites.

function rrMountPlans(container, { user, onChange } = {}) {
  let catalogo = null;
  let planActual = (user && user.plan) || 'free';
  let ciclo = (user && user.planCycle) || 'monthly';

  container.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  function render() {
    const { cycles, plans } = catalogo;

    container.innerHTML = `
      <div class="rr-plans-head">
        <span class="eyebrow">Planes</span>
        <h2>Robin, hasta donde lo necesites</h2>
        <p>Lo importante es gratis para siempre: tus pendientes, tus notificaciones y los siete minijuegos completos. Lo que crece con el plan es cuánto puedes hablar con Robin.</p>

        <div class="rr-cycle-switch" role="tablist">
          ${cycles.map(c => `
            <button type="button" role="tab" class="${c.id === ciclo ? 'on' : ''}" data-cycle="${c.id}">
              ${rrEscapeHtml(c.label)}
              ${c.discountPct ? `<span class="rr-cycle-off">−${c.discountPct}%</span>` : ''}
            </button>`).join('')}
        </div>
      </div>

      <div class="rr-plan-grid">
        ${plans.map((p, i) => planCard(p, i)).join('')}
      </div>

      <p class="rr-plans-note">
        No hay ningún cobro automático: al elegir un plan se activa su margen y queda anotada la elección. Puedes
        cambiarlo o volver a Gratis cuando quieras. Los porcentajes se cuentan sobre el plan Gratis; las cifras
        exactas están en los <a href="/terminos#limites">términos del servicio</a>.
      </p>`;

    container.querySelectorAll('[data-cycle]').forEach(btn => {
      btn.addEventListener('click', () => { ciclo = btn.dataset.cycle; render(); });
    });
    container.querySelectorAll('[data-choose]').forEach(btn => {
      btn.addEventListener('click', () => elegir(btn.dataset.choose, btn));
    });
  }

  function planCard(plan, i) {
    const precio = plan.prices[ciclo];
    const esActual = plan.id === planActual;
    const gratis = plan.monthly === 0;

    return `
      <article class="rr-plan accent-${plan.accent} ${plan.popular ? 'popular' : ''} ${esActual ? 'current' : ''}"
               style="animation-delay:${i * 80}ms">
        ${plan.popular ? '<span class="rr-plan-flag">El que elige casi todo el mundo</span>' : ''}
        ${esActual ? '<span class="rr-plan-flag current">Tu plan ahora</span>' : ''}

        <h3>${rrEscapeHtml(plan.name)}</h3>
        <p class="rr-plan-tag">${rrEscapeHtml(plan.tagline)}</p>
        ${plan.compare ? `<div class="rr-plan-compare">${rrEscapeHtml(plan.compare)}</div>` : ''}

        <div class="rr-plan-price">
          <strong>${gratis ? 'Gratis' : rrMoney(precio.perMonth)}</strong>
          ${gratis ? '<span>para siempre</span>' : '<span>al mes</span>'}
        </div>
        ${!gratis ? `
          <div class="rr-plan-billing">
            ${precio.months === 1
              ? `${rrMoney(precio.total)} cada mes`
              : `${rrMoney(precio.total)} ${rrEscapeHtml(precio.cycleShort)}`}
            ${precio.saves ? `<em>ahorras ${rrMoney(precio.saves)}</em>` : ''}
          </div>` : '<div class="rr-plan-billing">Sin tarjeta, sin fecha de vencimiento</div>'}

        <ul class="rr-plan-list">
          ${plan.features.map(f => `<li>${rrEscapeHtml(f)}</li>`).join('')}
        </ul>

        ${esActual
          ? '<button class="btn btn-block btn-ghost" disabled>Es el que tienes</button>'
          : `<button class="btn btn-block ${plan.popular ? 'btn-primary' : 'btn-outline'}" data-choose="${plan.id}">
               ${gratis ? 'Volver a Gratis' : `Pasar a ${rrEscapeHtml(plan.name)}`}
             </button>`}
      </article>`;
  }

  async function elegir(planId, btn) {
    // Bajar de plan se confirma: es una decisión que quita cosas.
    if (planId === 'free' && planActual !== 'free') {
      if (!confirm('¿Volver al plan Gratis? Tu margen diario con Robin vuelve al de partida. Tus pendientes, tus conversaciones y los minijuegos se quedan como están.')) return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = rrLoadingHtml('Un momento', { size: 'inline' });

    try {
      const data = await rrApi('/api/plans/choose', { method: 'POST', body: { plan: planId, cycle: ciclo } });
      planActual = data.user.plan;
      ciclo = data.user.planCycle;
      rrToast(data.message, 'success');
      if (typeof rrUpdateUsage === 'function') rrUpdateUsage(data.user.usageToday);
      if (onChange) onChange(data.user);
      render();
      if (planId !== 'free') rrConfetti(container);
    } catch (err) {
      rrToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  (async () => {
    try {
      const data = await rrApi('/api/plans/mine');
      catalogo = data.catalog;
      planActual = data.plan.id;
      ciclo = data.plan.cycle || 'monthly';
      render();
    } catch (err) {
      container.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'sad', title: 'No pude traer los planes', text: rrEscapeHtml(err.message)
      })}</div>`;
    }
  })();

  return { render };
}
