// public/js/login.js
rrRedirectIfSignedIn();

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('formError');
const btn = document.getElementById('loginBtn');
const passInput = document.getElementById('password');

// Ver lo que se está escribiendo. Sin esto, una contraseña mal tecleada en un
// teléfono se confunde con una contraseña equivocada, y el mensaje de error
// es el mismo para las dos cosas.
const eye = document.getElementById('togglePw');
if (eye) {
  eye.addEventListener('click', () => {
    const viendo = passInput.type === 'text';
    passInput.type = viendo ? 'password' : 'text';
    eye.classList.toggle('on', !viendo);
    eye.textContent = viendo ? '👁' : '🙈';
    eye.setAttribute('aria-label', viendo ? 'Ver la contraseña' : 'Ocultar la contraseña');
    passInput.focus();
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('visible');
  btn.disabled = true;
  // El botón se convierte en la espera. Es donde está mirando quien acaba de
  // pulsarlo, así que es donde tiene que aparecer que algo está pasando.
  btn.innerHTML = rrLoadingHtml('Entrando', { size: 'inline' });

  try {
    const { user } = await rrApi('/api/login', {
      method: 'POST',
      body: {
        email: document.getElementById('email').value.trim(),
        password: passInput.value
      }
    });
    // Robin celebra antes de soltar la pantalla: la espera se siente más corta.
    rrSetPose('authRobin', 'happy');
    btn.textContent = '¡Adentro!';
    rrConfetti(document.getElementById('authRobin'));
    setTimeout(() => { window.location.href = rrDashboardFor(user.role, user); }, 620);
  } catch (err) {
    rrSetPose('authRobin', 'sad');
    errorBox.textContent = err.message;
    errorBox.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});
