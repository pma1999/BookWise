# Guía de Despliegue - BookWise

## Orden de Despliegue

**IMPORTANTE**: Despliega primero el backend, luego el frontend.

1. **Backend (Render)** → Obtienes URL del backend
2. **Frontend (Vercel)** → Configuras URL del backend en variables de entorno
3. **Conectar** → Configuras FRONTEND_URL en Render con la URL de Vercel

---

## Despliegue Backend (Render) - PRIMERO

### Paso 1: Crear cuenta y conectar

1. Ve a [Render.com](https://render.com) y crea una cuenta (o inicia sesión)
2. Click en **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Selecciona el repositorio `BookWise`

### Paso 2: Configurar el servicio

Render detectará automáticamente el archivo `render.yaml`. Verifica:

| Setting | Value |
|---------|-------|
| **Name** | `bookwise-backend` |
| **Runtime** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `gunicorn app:app --bind 0.0.0.0:$PORT` |
| **Root Directory** | `backend` |

### Paso 3: Variables de entorno

En el dashboard de Render, ve a **Environment** y añade:

```
GEMINI_API_KEY=tu_clave_de_gemini_aqui
FRONTEND_URL=          # Dejar vacío por ahora (la actualizaremos después)
```

> **Nota**: Necesitas una API key de Google Gemini. Consíguela en [Google AI Studio](https://aistudio.google.com/app/apikey)

### Paso 4: Desplegar

Click en **"Create Web Service"** y espera a que se despliegue.

**Anota la URL que te da Render**, será algo como:
```
https://bookwise-backend.onrender.com
```

La necesitarás para configurar el frontend en Vercel.

---

## Despliegue Frontend (Vercel)

### Paso 1: Commit y push

Asegúrate de que todo esté commiteado (excepto los archivos de environment que están en .gitignore):

```bash
git add .
git commit -m "Prepare for deployment"
git push
```

### Paso 2: Crear cuenta y conectar

1. Ve a [Vercel.com](https://vercel.com) y crea una cuenta (o inicia sesión)
2. Click en **"Add New Project"**
3. Importa tu repositorio de GitHub
4. Selecciona el repositorio `BookWise`

### Paso 3: Configurar el build

Vercel detectará automáticamente Angular. Configura:

| Setting | Value |
|---------|-------|
| **Framework Preset** | `Angular` |
| **Root Directory** | `frontend` ⚠️ **IMPORTANTE** |
| **Build Command** | `npm run build:prod` |
| **Output Directory** | `dist/frontend/browser` |

### Paso 4: Variables de entorno (OBLIGATORIO)

⚠️ **IMPORTANTE**: Como los archivos `environment.ts` están en `.gitignore`, **DEBES** configurar las variables en Vercel:

Ve a **Settings** → **Environment Variables** y añade:

```
NG_APP_SUPABASE_URL=https://ullvzzjmogjzfnnlqpoz.supabase.co
NG_APP_SUPABASE_KEY=sb_publishable_XhzqEmSXoLKRG-N2sgB4Qw_qdnCmaZH
NG_APP_API_URL=https://bookwise-backend.onrender.com
```

**Notas:**
- `NG_APP_API_URL`: URL de tu backend en Render (la que obtuviste en el paso anterior)
- Asegúrate de añadir estas variables a **Production** y opcionalmente a **Preview**

### Paso 5: Desplegar

Click en **"Deploy"** y espera a que termine.

Anota la URL de Vercel, será algo como:
`https://bookwise-xxx.vercel.app`

---

## Conectar Frontend y Backend - ULTIMO PASO

Una vez que tengas ambos desplegados, debes conectarlos:

### Actualizar CORS en Render

1. Ve al dashboard de Render → tu servicio `bookwise-backend` → **Environment**
2. Actualiza la variable `FRONTEND_URL` con la URL de tu frontend en Vercel:

```
FRONTEND_URL=https://bookwise-xxx.vercel.app
```

3. El servicio se reiniciará automáticamente

### Verificar conexión

1. Abre tu frontend en Vercel
2. Intenta hacer una búsqueda de libros
3. Si funciona, ¡todo está conectado!

### URLs de Preview (Opcional)

Si quieres que el backend acepte URLs de preview de Vercel (deploys de PRs):

```
FRONTEND_URL=https://bookwise-xxx.vercel.app,https://bookwise-git-*.vercel.app
```

> Nota: El wildcard `*` permite cualquier subdominio de preview.

---

## URLs de Preview (Opcional)

Si quieres que el backend acepte URLs de preview de Vercel (deploys de PRs):

En Render, modifica `FRONTEND_URL` para incluir múltiples orígenes:

```
FRONTEND_URL=https://bookwise-xxx.vercel.app, https://bookwise-git-*.vercel.app
```

> Nota: El wildcard `*` permite cualquier subdominio de preview.

---

## Troubleshooting

### Error "Network Error" en el frontend

- Verifica que `apiUrl` en `environment.prod.ts` sea correcta
- Verifica que `FRONTEND_URL` en Render incluya tu URL de Vercel
- En Render, ve a **Logs** para ver errores del backend

### Error 401/403 en peticiones

- Verifica que la clave `GEMINI_API_KEY` esté configurada en Render
- Verifica que `FRONTEND_URL` no tenga `/` al final

### El backend no arranca

- Verifica que `gunicorn` esté en `requirements.txt`
- En Render, ve a **Settings** → **Build Command** y asegúrate que sea: `pip install -r requirements.txt`

### Cambios no se reflejan

- Frontend: Vercel redeploya automáticamente con cada push
- Backend: En Render, ve a **Manual Deploy** → **Deploy latest commit**

### Error "NG_APP_SUPABASE_URL is not set" en el build de Vercel

Verifica que:
1. Las variables de entorno estén configuradas en Vercel Dashboard → Settings → Environment Variables
2. Los nombres sean exactos: `NG_APP_SUPABASE_URL`, `NG_APP_SUPABASE_KEY`, `NG_APP_API_URL`
3. Estén marcadas para Production (y Preview si usas deploys de preview)
4. Hayas hecho redeploy después de añadir las variables

### Variables de entorno no aparecen en la app

Si el build funciona pero la app no conecta a Supabase:
1. Revisa los logs del build en Vercel buscando "Environment files generated"
2. Verifica que las variables no estén vacías en el log
3. Si están vacías, revisa que estén correctamente configuradas en el dashboard

---

## Estructura de archivos importantes

```
BookWise/
├── backend/
│   ├── render.yaml          # Config de Render
│   ├── Procfile             # Comando de inicio
│   ├── requirements.txt     # Dependencias + gunicorn
│   └── app.py               # App Flask con CORS
├── frontend/
│   ├── vercel.json          # Config de Vercel
│   ├── scripts/
│   │   └── set-env.js       # Genera environment.ts desde vars de Vercel
│   └── src/environments/
│       └── environment.ts.template  # Plantilla de referencia
└── DEPLOY.md                # Esta guía
```

---

## Comandos útiles

### Test local con producción

```bash
# Terminal 1 - Backend
cd backend
source venv/bin/activate  # Windows: venv\Scripts\activate
python app.py

# Terminal 2 - Frontend
cd frontend
ng serve --configuration=production
```

### Verificar build antes de desplegar

```bash
cd frontend
npm run build
```

Si no hay errores, el build en Vercel funcionará.

---

## ✅ Checklist Pre-Deploy

Antes de empezar, asegúrate de tener:

### Cuentas necesarias
- [ ] Cuenta en [Render.com](https://render.com)
- [ ] Cuenta en [Vercel.com](https://vercel.com)
- [ ] Cuenta en [Google AI Studio](https://aistudio.google.com/app/apikey) (para Gemini API key)
- [ ] Código subido a GitHub (con `.gitignore` correcto)

### Backend (Render)
- [ ] `render.yaml` configurado
- [ ] `Procfile` con gunicorn
- [ ] `requirements.txt` con gunicorn
- [ ] API Key de Gemini obtenida

### Frontend (Vercel)
- [ ] `vercel.json` configurado
- [ ] Script `scripts/set-env.js` creado
- [ ] `package.json` con scripts actualizados
- [ ] Credenciales de Supabase a mano

---

## 📝 Resumen de URLs y Variables

| Servicio | Variable | Valor / Dónde obtener |
|----------|----------|----------------------|
| **Supabase** | `NG_APP_SUPABASE_URL` | `https://ullvzzjmogjzfnnlqpoz.supabase.co` |
| **Supabase** | `NG_APP_SUPABASE_KEY` | `sb_publishable_XhzqEmSXoLKRG-N2sgB4Qw_qdnCmaZH` |
| **Gemini** | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| **Render** | `FRONTEND_URL` | URL de Vercel (ej: `https://bookwise-xxx.vercel.app`) |
| **Vercel** | `NG_APP_API_URL` | URL de Render (ej: `https://bookwise-backend.onrender.com`) |
