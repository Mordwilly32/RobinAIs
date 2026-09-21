# Poner roboRobin en roborobin.site

Todo lo que había que tocar en el código ya está. Lo que queda son clics en tres
paneles: el de Render, el de tu registrador de dominios, y el de GitHub si
quieres que la demostración también tenga dirección propia.

Antes de empezar, el sitio tiene que estar desplegado y contestando en su
dirección `.onrender.com` — ver [`docs/supabase.md`](supabase.md). Un dominio
apuntando a un servicio que todavía no existe solo da errores confusos.

---

## Qué va a dónde

| Dirección | Qué contesta | Dónde se configura |
|---|---|---|
| `roborobin.site` | **La aplicación de verdad** | Render |
| `www.roborobin.site` | 301 a `roborobin.site` | Render + `RR_DOMINIO` |
| `demo.roborobin.site` | La demostración sin servidor (opcional) | GitHub Pages |

La aplicación va en el dominio a secas porque es lo que la gente va a teclear.
La demostración, si la quieres, en un subdominio: son dos cosas distintas y
conviene que se note.

---

## 1. Decirle a Render cuál es tu dominio

1. Panel de Render → tu servicio `roborobin` → **Settings** → **Custom Domains**.
2. **Add Custom Domain** → escribe `roborobin.site` → *Save*.
3. Otra vez **Add Custom Domain** → `www.roborobin.site` → *Save*.

Render te muestra entonces, para cada uno, **el registro DNS exacto que hay que
crear**. Déjalo abierto: esos valores son los del paso siguiente, y son de tu
servicio — no los copies de ninguna guía de internet, ni de esta.

Normalmente serán de esta forma:

- `roborobin.site` → un registro **A** a una dirección IP, o un **ALIAS/ANAME**
  si tu registrador lo soporta.
- `www.roborobin.site` → un **CNAME** a `roborobin-xxxx.onrender.com`.

## 2. Crear esos registros donde compraste el dominio

Entra a tu registrador (Namecheap, Porkbun, GoDaddy, Hostinger…) y busca la
sección de DNS. Según el sitio se llama **DNS**, **Advanced DNS**, **Zona DNS**
o **Administrar registros**.

Crea los dos registros que te dio Render:

| Tipo | Nombre / Host | Valor | TTL |
|---|---|---|---|
| A *(o ALIAS)* | `@` | *lo que diga Render* | automático |
| CNAME | `www` | *lo que diga Render* | automático |

Tres cosas que salen mal a menudo:

- **El `@`** significa "el dominio pelado". Algunos paneles lo escriben como
  `@`, otros lo dejan en blanco, otros quieren `roborobin.site` completo. Mira
  cómo están escritos los registros que ya hay.
- **Si ya existe un registro A o CNAME para `@`** —muchos registradores ponen
  uno apuntando a su propia página de "dominio aparcado"— **bórralo**. Dos
  registros peleando por la misma dirección es el problema más común, y se ve
  como un sitio que a veces carga y a veces no.
- **No pongas `http://` ni barras** en el valor. Solo el nombre o la IP.

Guarda. El DNS tarda en repartirse: normalmente minutos, a veces unas horas. En
Render los dominios van pasando de *Pending* a *Verified* solos, y el
certificado de HTTPS lo saca él sin que hagas nada.

## 3. Encender el redirect al dominio bueno

Cuando Render diga **Verified** en los dos, y solo entonces:

Render → tu servicio → **Environment** → añade:

```
RR_DOMINIO = roborobin.site
```

Guarda. El servicio se reinicia solo.

A partir de ahí, `www.roborobin.site` y la vieja `roborobin-xxxx.onrender.com`
contestan un 301 al dominio bueno. Eso importa más de lo que parece: la cookie
de sesión pertenece al dominio por el que entraste, así que sin este redirect
alguien puede entrar por `www`, volver más tarde por el dominio pelado, y
aparecer desconectado sin entender por qué.

> **No la pongas antes de tiempo.** Si `RR_DOMINIO` apunta a un dominio que
> todavía no resuelve, el sitio se redirige a sí mismo hacia un sitio que no
> contesta, y te quedas sin poder entrar ni por la dirección de Render.
> Si te pasa: borra la variable desde el panel de Render y vuelve en un minuto.

## 4. La demostración en un subdominio (opcional)

Si quieres `demo.roborobin.site` apuntando a la versión de GitHub Pages:

1. En tu registrador, un registro más:

   | Tipo | Nombre | Valor |
   |---|---|---|
   | CNAME | `demo` | `mordwilly32.github.io` |

   Sin barra al final y sin el nombre del repositorio: solo eso.

2. En GitHub: repositorio `RobinAIs` → **Settings** → **Secrets and variables**
   → **Actions** → pestaña **Variables** → **New repository variable**:

   ```
   Nombre:  RR_PAGES_DOMINIO
   Valor:   demo.roborobin.site
   ```

3. **Settings → Pages → Custom domain** → escribe `demo.roborobin.site` → *Save*,
   y marca **Enforce HTTPS** cuando se deje (tarda un rato en dejarse: GitHub
   tiene que sacar el certificado primero).

4. Lanza una publicación nueva: **Actions** → *Publicar la demostración en
   GitHub Pages* → **Run workflow**.

El paso 2 no es decorativo. GitHub Pages lee el dominio de un archivo `CNAME`
dentro de lo que se publica, y aquí lo que se publica es `gh-pages/`, que se
rehace entero en cada build. Sin esa variable, la siguiente publicación se
llevaría el dominio por delante.

---

## Comprobar que quedó

```bash
curl -sI https://roborobin.site        | head -1     # 200
curl -sI https://www.roborobin.site    | head -1     # 301
curl -s  https://roborobin.site/health               # {"ok":true,...}
```

Y a ojo: entra a `https://roborobin.site`, crea una sesión, cierra la pestaña,
vuelve a abrirla. Si sigues dentro, la cookie está bien.

---

## Cuando algo falla

**«No se puede acceder a este sitio» / DNS_PROBE_FINISHED_NXDOMAIN.**
El DNS todavía no se repartió, o el registro quedó mal escrito. Comprueba a qué
apunta de verdad:

```bash
nslookup roborobin.site
nslookup www.roborobin.site
```

**Render se queda en *Pending* horas.**
Casi siempre es un registro viejo que sigue ahí. Borra cualquier A, CNAME o
ALIAS de `@` que no sea el de Render — incluidos los de "aparcado" que pone el
registrador por su cuenta.

**Aviso de certificado, o «la conexión no es privada».**
El certificado tarda unos minutos después de que el DNS resuelva. Si pasada una
hora sigue, en Render hay un botón para volver a verificar el dominio.

**Entro y me saca al momento.**
Es la cookie: estás entrando por un dominio y volviendo por otro. Es justo lo
que arregla `RR_DOMINIO` del paso 3.

**Me redirige en bucle.**
`RR_DOMINIO` está mal escrito, o tiene `https://` o una barra al final. Va el
nombre pelado: `roborobin.site`.

**El correo del dominio dejó de funcionar.**
Si el dominio tenía correo, borraste un registro MX por error al limpiar. Los MX
no tienen nada que ver con la web: vuelve a ponerlos como estaban.
