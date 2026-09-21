# Mandar los correos de activación

roboRobin ya no deja crear una cuenta con un correo inventado: quien se apunta
por su cuenta recibe un código de seis cifras y sin escribirlo no entra.

Para que eso funcione hace falta alguien que mande el correo. **Y eso es justo
lo que los MX que ya tienes no hacen.**

---

## Lo primero, porque es lo que bloquea todo

Tu dominio tiene esto puesto, y está bien puesto:

```
MX   roborobin.site   route1/2/3.mx.cloudflare.net
TXT  roborobin.site   "v=spf1 include:_spf.mx.cloudflare.net ~all"
TXT  cf2024-1._domainkey.roborobin.site   "v=DKIM1; ..."
```

Eso es **Cloudflare Email Routing**, y sirve para **recibir**: que alguien
escriba a `hola@roborobin.site` y le llegue a tu Gmail. Comprobé que los tres
MX resuelven y que el SPF y el DKIM están publicados.

Lo que Email Routing **no** hace es mandar. No tiene salida: no hay servidor
SMTP al que conectarse ni API que llamar. Así que con esto solo, roboRobin no
puede mandar ni un código.

Hace falta un proveedor de envío. Abajo está el que recomiendo y por qué.

*(Detalle sin importancia: en lo que me pasaste, el tercer registro venía
etiquetado `Type:TXT` con el valor `route3.mx.cloudflare.net`. En el DNS de
verdad está bien, como MX con prioridad 25 — fue un desliz al copiar.)*

---

## Mientras tanto, ya funciona

Sin configurar nada, el código **se imprime en la terminal** en vez de mandarse:

```
┌─ correo que NO se mandó (no hay proveedor configurado) ─────
│ Para:   ana@ejemplo.sv
│ Asunto: 701139 es tu código de roboRobin
│     701139
└────────────────────────────────────────────────────────────
```

Así puedes probar el registro entero aquí mismo sin dar de alta nada. Lo que no
puedes es desplegar así: en el servidor nadie vería esa terminal, y el registro
quedaría roto para todo el mundo. Por eso el servidor lo avisa al arrancar si
está en producción sin proveedor.

---

## Dar de alta el envío (Resend)

Recomiendo **Resend**: 3.000 correos al mes gratis, 100 al día, y se usa con una
petición HTTPS — no añade ninguna dependencia al proyecto. Para una escuela,
3.000 al mes son muchísimos: solo se manda uno por cuenta nueva.

### 1. Crear la cuenta

[resend.com](https://resend.com) → *Sign up*. Se puede con GitHub.

### 2. Verificar el dominio

**Domains** → **Add Domain** → escribe `roborobin.site` → *Add*.

Resend te enseña tres o cuatro registros DNS. Añádelos en tu registrador **tal y
como los muestra Resend**, con una excepción importante:

> ### ⚠️ El SPF hay que fusionarlo, no añadirlo
>
> Ya tienes un SPF en `roborobin.site` para Cloudflare. **Dos registros SPF en
> el mismo nombre es un error** —los servidores que reciben lo tratan como
> configuración rota y tu correo empieza a caer en spam, incluido el de
> Cloudflare que ahora funciona.
>
> En vez de crear otro, **edita el que ya tienes** y mete dentro el `include`
> que te dé Resend. Queda un solo registro con los dos:
>
> ```
> v=spf1 include:_spf.mx.cloudflare.net include:LO_QUE_DIGA_RESEND ~all
> ```
>
> Los demás registros de Resend (su DKIM, y su MX si te lo pide) sí se añaden
> tal cual: no chocan con nada porque van en nombres distintos.

Resend va comprobando solo; pasa a *Verified* en unos minutos.

### 3. Sacar la llave

**API Keys** → **Create API Key**. Permiso *Sending access* es suficiente.
Cópiala: solo se enseña una vez.

### 4. Ponerla

En tu `.env` de aquí:

```
RESEND_API_KEY=re_...
MAIL_DESDE=roboRobin <robin@roborobin.site>
MAIL_RESPONDER_A=tu-correo-de-verdad@gmail.com
```

Y en Render → **Environment**, las mismas tres.

`MAIL_RESPONDER_A` es opcional pero conviene: es a dónde va lo que alguien
conteste al correo. Ahí es donde los MX de Cloudflare hacen su trabajo — puedes
poner `hola@roborobin.site` y que Cloudflare lo reenvíe a donde tú leas.

### 5. Comprobar

Arranca y mira la primera línea:

```
Correo: resend        ← se manda de verdad
Correo: consola       ← todavía se imprime aquí
```

Y regístrate con un correo tuyo de verdad, a ver si llega.

---

## Cómo funciona por dentro

### Quién tiene que activar

| Cómo se registró | ¿Pide código? | Por qué |
|---|---|---|
| Cuenta personal | **Sí** | Nadie responde por esa persona |
| Cuenta de familia | **Sí** | Igual |
| Inscribir una escuela | **Sí** | Si no, cualquiera fabrica escuelas con correos inventados |
| Con código de ingreso | No | De esa persona ya responde quien le dio el código, y muchos estudiantes no tienen correo |

### Las reglas

- El código son **seis cifras** sacadas de `crypto.randomInt`, no de `Math.random`.
- Vive **15 minutos**.
- **5 intentos** fallidos y hay que pedir otro.
- **1 minuto** entre reenvíos, y **5 por hora** por cuenta.
- La cuenta sin activar **se borra a las 24 horas**, y así el correo vuelve a
  quedar libre — si no, alguien que lo tecleó mal no podría volver a intentarlo
  nunca.

### El código no se guarda

En la ficha queda un HMAC-SHA256 suyo, no el número. Quien consiguiera mirar la
base de datos no podría activar cuentas ajenas con lo que ve. La llave del HMAC
es `SESSION_SECRET`; si la cambias, los códigos que estuvieran en el aire dejan
de valer, y como duran quince minutos eso no le molesta a nadie.

La comprobación usa `crypto.timingSafeEqual`, no `===`: comparar con `===`
filtraría por el tiempo de respuesta cuántas cifras van bien.

### Dos detalles que se decidieron a propósito

**Los códigos de la escuela no se dan hasta activar.** Antes, inscribir una
escuela te devolvía al momento los dos códigos de ingreso. Ahora llegan al
activar la cuenta. Si no, cualquiera con un correo inventado se llevaría unos
códigos que funcionan de verdad.

**Registrarse con un correo que ya está a medias no da error.** Te manda otro
código y te lleva a la casilla. Casi siempre es la misma persona volviendo
porque el primero no le llegó, y un error que no dice qué hacer no ayuda.

---

## Cuando algo falla

**`Correo: consola` y yo puse la llave.**
No se está leyendo el `.env`. Comprueba que se llama `.env` a secas y que la
línea es `RESEND_API_KEY=re_...` sin comillas.

**Resend contesta 403 y habla de «domain is not verified».**
El dominio todavía no pasó a *Verified*, o el `MAIL_DESDE` es de otro dominio
distinto al que verificaste.

**No llega nada y Resend dice que salió.**
Mira en spam. Si está en spam, casi siempre es el SPF: comprueba que hay **un
solo** registro SPF y que lleva dentro los dos `include`.

```bash
nslookup -type=TXT roborobin.site
```

Si salen dos líneas que empiezan por `v=spf1`, ahí está el problema: fusiónalas.

**El correo de Cloudflare dejó de llegar desde que configuré Resend.**
Lo mismo: dos SPF. Fusiónalos y vuelve.

**«La cuenta se creó, pero no pude mandarte el correo.»**
El proveedor rechazó el envío. El motivo real está en los registros del
servidor, en una línea que empieza por `[roboRobin] No se pudo mandar el código`.
La cuenta queda esperando y el código sigue valiendo: se entra por *Entrar*, con
la contraseña, y la pantalla lleva sola a la casilla del código.
