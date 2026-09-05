// public/js/login.js
rrRedirectIfSignedIn();

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('formError');
const btn = document.getElementById('loginBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  try {
    const { user } = await rrApi('/api/login', {
      method: 'POST',
      body: {
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      }
    });
    // Robin celebra antes de soltar la pantalla: la espera se siente más corta.
    rrSetPose('authRobin', 'happy');
    btn.textContent = '¡Adentro!';
    rrConfetti(document.getElementById('authRobin'));
    setTimeout(() => { window.location.href = rrDashboardFor(user.role); }, 620);
  } catch (err) {
    rrSetPose('authRobin', 'sad');
    errorBox.textContent = err.message;
    errorBox.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});
