// public/js/register.js
// Registro en tres caminos: cuenta personal, unirse con código (estudiante o
// profesor) e inscribir una escuela nueva como director.

rrRedirectIfSignedIn();

let accountType = null;   // 'personal' | 'parent' | 'join' | 'school'
let joinInfo = null;      // { school, role } cuando el código ya se verificó
let childInfo = null;     // el estudiante al que acompaña una cuenta de familia
let selectedLevel = null;
let createdSchool = null;

const errorBox = document.getElementById('formError');
const stepTitle = document.getElementById('stepTitle');
const stepSubtitle = document.getElementById('stepSubtitle');
const stepDots = document.querySelectorAll('#steps span');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
  rrSetPose('authRobin', 'sad'); // Robin se entristece con el formulario
}
function clearError() {
  errorBox.classList.remove('visible');
  rrSetPose('authRobin', ''); // y vuelve a ser el de siempre al corregirlo
}

function setStep(id, { title, subtitle, dot }) {
  document.querySelectorAll('.step-form').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (title) stepTitle.textContent = title;
  if (subtitle) stepSubtitle.textContent = subtitle;
  stepDots.forEach((span, i) => {
    span.classList.toggle('on', i === dot);
    span.classList.toggle('done', i < dot);
  });
  clearError();
}

const STEPS = {
  type: { title: 'Crea tu cuenta', subtitle: '¿Qué tipo de cuenta necesitas?', dot: 0 },
  code: { title: 'Únete a tu escuela', subtitle: 'Escribe el código que te dio tu director', dot: 1 },
  child: { title: 'Cuenta de familia', subtitle: '¿A quién vas a acompañar?', dot: 1 },
  school: { title: 'Inscribe tu escuela', subtitle: 'Tú quedas como director de la escuela', dot: 1 },
  personalForm: { title: 'Tu cuenta personal', subtitle: 'Solo faltan tus datos', dot: 1 },
  parentForm: { title: 'Tus datos', subtitle: 'Ya casi estás dentro', dot: 2 },
  joinForm: { title: 'Tus datos', subtitle: 'Ya casi estás dentro', dot: 2 },
  codes: { title: '¡Escuela inscrita!', subtitle: 'Guarda bien estos dos códigos', dot: 2 },
  verify: { title: 'Revisa tu correo', subtitle: 'Te mandamos un código de seis cifras', dot: 2 }
};

// ---- Paso 1: tipo de cuenta -----------------------------------------------

document.querySelectorAll('.rr-choice').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.rr-choice').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    accountType = card.dataset.type;

    setTimeout(() => {
      if (accountType === 'personal') {
        document.getElementById('levelSection').style.display = 'none';
        document.getElementById('gradeFieldWrap').style.display = 'none';
        document.getElementById('ageFieldWrap').style.display = '';
        document.getElementById('age').required = true;
        document.getElementById('emailOptional').textContent = '';
        document.getElementById('email').required = true;
        setStep('step-form', STEPS.personalForm);
      } else if (accountType === 'parent') {
        setStep('step-child', STEPS.child);
        document.getElementById('childCode').focus();
      } else if (accountType === 'join') {
        setStep('step-code', STEPS.code);
        document.getElementById('joinCode').focus();
      } else {
        setStep('step-school', STEPS.school);
      }
    }, 160);
  });
});

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => setStep('step-' + btn.dataset.back, STEPS[btn.dataset.back]));
});

document.getElementById('backFromForm').addEventListener('click', () => {
  if (accountType === 'join') setStep('step-code', STEPS.code);
  else if (accountType === 'parent') setStep('step-child', STEPS.child);
  else setStep('step-type', STEPS.type);
});

// ---- Paso 2 (familia): buscar al hijo por su ID ---------------------------
// Se busca ANTES de crear la cuenta y se enseña el nombre: agregar a un
// desconocido por una letra mal puesta es de las cosas que no se pueden
// deshacer con una disculpa.

const childInput = document.getElementById('childCode');
const childResult = document.getElementById('childResult');

async function checkChild() {
  const code = childInput.value.trim().toUpperCase();
  clearError();
  if (!code) return showError('Escribe el ID de estudiante de tu hijo o hija.');

  const btn = document.getElementById('checkChild');
  btn.disabled = true;
  btn.innerHTML = rrLoadingHtml('Buscando', { size: 'inline' });
  childResult.innerHTML = '';

  try {
    const data = await rrApi(`/api/family/lookup/${encodeURIComponent(code)}`);
    childInfo = Object.assign({ studentCode: code }, data);

    childResult.innerHTML = `
      <div class="card" style="border-left:4px solid var(--rr-gold);animation:rr-pop-in .35s var(--rr-spring) both">
        <div class="pill pill-student">Estudiante</div>
        <h3 style="margin:10px 0 4px;font-size:18px">${rrEscapeHtml(data.fullName)}</h3>
        <p class="text-muted" style="margin:0;font-size:14px">
          ${rrEscapeHtml([data.schoolName, data.level, data.grade].filter(Boolean).join(' · ') || 'Sin escuela registrada')}
        </p>
        <p class="hint" style="margin:8px 0 0">¿Es esta la persona? Si no, corrige el ID y vuelve a buscar.</p>
      </div>`;

    // La cuenta de familia no tiene nivel, ni grado, ni edad: no estudia aquí.
    document.getElementById('levelSection').style.display = 'none';
    document.getElementById('gradeFieldWrap').style.display = 'none';
    document.getElementById('ageFieldWrap').style.display = 'none';
    document.getElementById('age').required = false;
    document.getElementById('emailOptional').textContent = '';
    document.getElementById('email').required = true;

    setTimeout(() => {
      setStep('step-form', {
        ...STEPS.parentForm,
        subtitle: `Vas a seguir la asistencia de ${data.fullName.split(' ')[0]}`
      });
    }, 700);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar a mi hijo';
  }
}

document.getElementById('checkChild').addEventListener('click', checkChild);
childInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkChild(); } });

// ---- Paso 2 (unirse): verificar el código ---------------------------------

const codeInput = document.getElementById('joinCode');
const codeResult = document.getElementById('codeResult');

async function checkCode() {
  const code = codeInput.value.trim().toUpperCase();
  clearError();
  if (!code) return showError('Escribe el código que te dieron.');

  const btn = document.getElementById('checkCode');
  btn.disabled = true;
  btn.innerHTML = rrLoadingHtml('Verificando', { size: 'inline' });
  codeResult.innerHTML = '';

  try {
    const data = await rrApi(`/api/join-code/${encodeURIComponent(code)}`);
    joinInfo = data;
    const isTeacher = data.role === 'teacher';

    // Un codigo nominal ya sabe para quien es y de que nivel: no tiene sentido
    // volver a preguntarlo. Lo que trae puesto se muestra, no se pide.
    const nominal = data.kind === 'nominal';

    codeResult.innerHTML = `
      <div class="card" style="border-left:4px solid var(--${isTeacher ? 'rr-blue' : 'rr-red'});animation:rr-pop-in .35s var(--rr-spring) both">
        <div class="pill ${isTeacher ? 'pill-teacher' : 'pill-student'}">${isTeacher ? 'Profesor' : 'Estudiante'}</div>
        <h3 style="margin:10px 0 4px;font-size:18px">${rrEscapeHtml(data.school.name)}</h3>
        <p class="text-muted" style="margin:0;font-size:14px">
          ${nominal && data.forName
            ? `Este código se emitió a nombre de <strong>${rrEscapeHtml(data.forName)}</strong> y sirve una sola vez.`
            : `Vas a entrar como ${isTeacher ? 'profesor' : 'estudiante'} de esta escuela.`}
        </p>
        ${data.level ? `<p class="hint" style="margin:8px 0 0">Nivel: ${rrEscapeHtml(data.level)}${data.grade ? ` · ${rrEscapeHtml(data.grade)}` : ''}</p>` : ''}
        ${data.className ? `<p class="hint" style="margin:4px 0 0">Entras directo a la clase de ${rrEscapeHtml(data.className)}.</p>` : ''}
      </div>`;

    // El nivel solo se pide a estudiantes, y solo si el codigo no lo trae ya.
    const pideNivel = !isTeacher && !data.level;
    document.getElementById('levelSection').style.display = pideNivel ? '' : 'none';
    document.getElementById('gradeFieldWrap').style.display = pideNivel ? '' : 'none';
    document.getElementById('ageFieldWrap').style.display = 'none';
    document.getElementById('age').required = false;
    document.getElementById('emailOptional').textContent = isTeacher ? '' : '(opcional)';
    document.getElementById('email').required = isTeacher;
    if (data.level) selectedLevel = data.level;
    if (nominal && data.forName) document.getElementById('fullName').value = data.forName;

    setTimeout(() => {
      setStep('step-form', {
        ...STEPS.joinForm,
        subtitle: `Te unes a ${data.school.name} como ${isTeacher ? 'profesor' : 'estudiante'}`
      });
    }, 700);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verificar código';
  }
}

document.getElementById('checkCode').addEventListener('click', checkCode);
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkCode(); } });

// ---- Nivel y grado (solo estudiantes) -------------------------------------

const GRADES_BY_LEVEL = {
  'Parvularia': ['Kínder 4', 'Kínder 5', 'Preparatoria'],
  'Primaria': ['1.º grado', '2.º grado', '3.º grado', '4.º grado', '5.º grado', '6.º grado'],
  'Secundaria': ['7.º grado', '8.º grado', '9.º grado'],
  'Bachillerato': ['1.º año', '2.º año', '3.º año'],
  'Universidad': ['1.º año', '2.º año', '3.º año', '4.º año', '5.º año', 'Posgrado']
};

document.querySelectorAll('.level-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.level-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedLevel = card.dataset.level;

    // Lo único que cambia en universidad es que no hay minijuegos. Se dice
    // aquí, al elegir, y no después de crear la cuenta.
    const aviso = document.getElementById('levelHint');
    if (aviso) {
      aviso.textContent = selectedLevel === 'Universidad'
        ? 'En universidad tienes todo lo demás igual, pero sin minijuegos: a este nivel ya no vienen al caso.'
        : 'Elige el nivel que estás cursando.';
    }

    const gradeSelect = document.getElementById('grade');
    gradeSelect.innerHTML = '<option value="">Elige tu grado…</option>';
    (GRADES_BY_LEVEL[selectedLevel] || []).forEach(grade => {
      const opt = document.createElement('option');
      opt.value = grade;
      opt.textContent = grade;
      gradeSelect.appendChild(opt);
    });
  });
});

// ---- Crear cuenta personal o de escuela (con código) ----------------------

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const isStudent = accountType === 'join' && joinInfo && joinInfo.role === 'student';
  // Si el codigo ya traia el nivel, selectedLevel viene puesto desde ahi.
  if (isStudent && !selectedLevel) return showError('Elige tu nivel escolar.');

  // La edad se revisa aquí además de en el servidor, para no hacer ir y venir
  // el formulario entero por un número mal escrito.
  const edad = Number(document.getElementById('age').value);
  if (accountType === 'personal') {
    if (!edad) return showError('Escribe tu edad.');
    if (edad < 4 || edad > 120) return showError('Esa edad no parece real. Escríbela en años.');
  }

  if (accountType === 'parent' && !childInfo) {
    return showError('Busca primero a tu hijo o hija por su ID.');
  }

  const btn = document.getElementById('registerBtn');
  btn.disabled = true;
  btn.innerHTML = rrLoadingHtml('Creando tu cuenta', { size: 'inline' });

  const MODO = { personal: 'personal', parent: 'parent' };
  const payload = {
    mode: MODO[accountType] || 'join',
    fullName: document.getElementById('fullName').value.trim(),
    email: document.getElementById('email').value.trim() || undefined,
    password: document.getElementById('password').value
  };
  if (accountType === 'personal') payload.age = edad;
  if (accountType === 'parent') payload.studentCode = childInfo.studentCode;
  if (accountType === 'join') {
    payload.code = codeInput.value.trim().toUpperCase();
    if (isStudent) {
      payload.level = selectedLevel;
      payload.grade = (joinInfo && joinInfo.grade) || document.getElementById('grade').value || undefined;
    }
  }

  try {
    const salida = await rrApi('/api/register', { method: 'POST', body: payload });

    // Cuenta personal, de familia o de dirección: la cuenta existe pero
    // todavía no es de nadie hasta que se demuestre que el correo es suyo.
    if (salida.verificar) return irAVerificar(salida);

    // Con un código de ingreso no hay que verificar nada: de esa persona ya
    // respondió la escuela que le dio el código.
    rrSetPose('authRobin', 'happy');
    btn.textContent = '¡Cuenta creada!';
    rrConfetti(document.getElementById('authRobin'));
    setTimeout(() => { window.location.href = rrDashboardFor(salida.user.role, salida.user); }, 700);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Crear cuenta';
  }
});

// ---- Inscribir la escuela --------------------------------------------------

document.getElementById('schoolForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const btn = document.getElementById('schoolBtn');
  btn.disabled = true;
  btn.innerHTML = rrLoadingHtml('Inscribiendo', { size: 'inline' });

  try {
    const salida = await rrApi('/api/register', {
      method: 'POST',
      body: {
        mode: 'school',
        schoolName: document.getElementById('schoolName').value.trim(),
        fullName: document.getElementById('sFullName').value.trim(),
        email: document.getElementById('sEmail').value.trim(),
        password: document.getElementById('sPassword').value
      }
    });

    // Los códigos de la escuela no llegan todavía: se dan al activar. Si se
    // repartieran ahora, cualquiera fabricaría una escuela con un correo
    // inventado y se llevaría unos códigos que funcionan.
    return irAVerificar(salida);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Inscribir escuela';
  }
});

document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!createdSchool) return;
    rrCopy(btn.dataset.copy === 'student' ? createdSchool.studentCode : createdSchool.teacherCode, btn);
  });
});

// ---- Activar la cuenta -----------------------------------------------------
//
// Las cuentas que alguien se hace por su cuenta —personal, de familia, y la
// del director que inscribe una escuela— nacen apagadas. Aquí se encienden,
// escribiendo el código de seis cifras que llegó al correo.
//
// Quién se está activando no se guarda en esta página: lo lleva la sesión, en
// el servidor. Por eso recargar no pierde el sitio, y por eso nadie puede
// probar códigos contra una cuenta que no sea la suya.

function irAVerificar(salida) {
  document.getElementById('verifyEmail').textContent = salida.email || 'tu correo';
  setStep('step-verify', STEPS.verify);
  document.getElementById('verifyCode').focus();
}

const verifyCode = document.getElementById('verifyCode');
const verifyResend = document.getElementById('verifyResend');
const verifyResendWait = document.getElementById('verifyResendWait');

// Solo cifras, y en cuanto hay seis se manda sola: quien pega el código desde
// el correo no tiene por qué buscar además un botón.
verifyCode.addEventListener('input', () => {
  const limpio = verifyCode.value.replace(/[^0-9]/g, '').slice(0, 6);
  if (limpio !== verifyCode.value) verifyCode.value = limpio;
  if (limpio.length === 6) document.getElementById('verifyForm').requestSubmit();
});

document.getElementById('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const btn = document.getElementById('verifyBtn');
  btn.disabled = true;
  btn.innerHTML = rrLoadingHtml('Activando', { size: 'inline' });

  try {
    const salida = await rrApi('/api/verify', { method: 'POST', body: { code: verifyCode.value } });

    rrSetPose('authRobin', 'happy');
    rrConfetti(document.getElementById('authRobin'));

    // Si quien acaba de activar es el director de una escuela recién
    // inscrita, ahora sí recibe sus dos códigos, y esa pantalla se queda
    // puesta: son dos cosas que tiene que copiar antes de seguir.
    if (salida.school) {
      createdSchool = salida.school;
      document.getElementById('createdSchoolName').textContent = salida.school.name;
      document.getElementById('revealStudentCode').textContent = salida.school.studentCode;
      document.getElementById('revealTeacherCode').textContent = salida.school.teacherCode;
      return setStep('step-codes', STEPS.codes);
    }

    btn.textContent = '¡Cuenta activada!';
    setTimeout(() => { window.location.href = rrDashboardFor(salida.user.role, salida.user); }, 700);
  } catch (err) {
    showError(err.message);
    verifyCode.select();
    btn.disabled = false;
    btn.textContent = 'Activar mi cuenta';
  }
});

verifyResend.addEventListener('click', async () => {
  clearError();
  verifyResend.disabled = true;

  try {
    const salida = await rrApi('/api/verify/resend', { method: 'POST', body: {} });
    document.getElementById('verifyEmail').textContent = salida.email || 'tu correo';
    rrToast('Te mandé otro código.', 'success');
    cuentaAtras(60);
  } catch (err) {
    showError(err.message);
    // El servidor dice cuántos segundos faltan; si los dice, se respetan.
    cuentaAtras((err.payload && err.payload.esperar) || 60);
  }
});

// El botón de reenviar se apaga un minuto. No es decoración: el servidor
// rechaza dos envíos seguidos, y un botón que parece disponible y contesta que
// no se siente roto.
function cuentaAtras(segundos) {
  let quedan = segundos;
  verifyResend.disabled = true;

  const tic = setInterval(() => {
    quedan -= 1;
    verifyResendWait.textContent = quedan > 0 ? `(espera ${quedan}s)` : '';
    if (quedan <= 0) {
      clearInterval(tic);
      verifyResend.disabled = false;
    }
  }, 1000);

  verifyResendWait.textContent = `(espera ${quedan}s)`;
}

// Si se llega aquí con una cuenta a medio activar —porque se recargó la
// página, o porque el login mandó para acá— se salta el formulario y se va
// derecho a la casilla del código. Quién es sale de la sesión.
rrApi('/api/verify')
  .then(info => irAVerificar(info))
  .catch(() => { /* nadie esperando: el registro empieza por el principio */ });
