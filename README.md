# BookWise

Aplicación de recomendación de libros con sistema de usuarios y sincronización en la nube.

## 🚀 Despliegue Rápido

- **Frontend (Vercel)**: Ver [DEPLOY.md](DEPLOY.md) para instrucciones detalladas
- **Backend (Render)**: Ver [DEPLOY.md](DEPLOY.md) para instrucciones detalladas

## Configuración del proyecto

### 1. Clonar y configurar entornos

```bash
git clone https://github.com/tu-usuario/BookWise.git
cd BookWise
```

**Para desarrollo local**: Copia las plantillas y edita con tus credenciales:

```bash
cd frontend/src/environments
cp environment.ts.template environment.ts
cp environment.prod.ts.template environment.prod.ts
# Edita ambos archivos con tus claves de Supabase
```

**Para Vercel (producción)**: Las variables se configuran en el dashboard de Vercel (ver [DEPLOY.md](DEPLOY.md)).

### 2. Backend (Flask)

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Crear archivo .env con:
# GEMINI_API_KEY=tu_clave_de_gemini
# FRONTEND_URL=http://localhost:4200

python app.py
```

### 3. Frontend (Angular)

```bash
cd frontend
npm install
npm start
```

La app estará en `http://localhost:4200`

## 🛠️ Stack Tecnológico

- **Frontend**: Angular 21, Angular Material, Supabase Auth
- **Backend**: Python Flask, Google Gemini AI, OpenLibrary API
- **Database**: Supabase PostgreSQL
- **Deploy**: Vercel (frontend), Render (backend)

## 📁 Estructura del proyecto

```
BookWise/
├── backend/                 # API Flask
│   ├── render.yaml         # Config de Render
│   ├── Procfile            # Comando de inicio
│   ├── requirements.txt    # Dependencias
│   └── app.py              # App principal
├── frontend/               # App Angular
│   ├── vercel.json        # Config de Vercel
│   └── src/
│       └── environments/   # Configuración (ignorado)
├── DEPLOY.md              # Guía de despliegue completa
└── README.md              # Esta guía
```

## 🔐 Seguridad

- Las claves de API nunca deben commitearse
- Los archivos en `/frontend/src/environments/` están en `.gitignore`
- Usa siempre las plantillas `.template.ts` como referencia
- Si expones una clave accidentalmente, rótala inmediatamente en Supabase Dashboard

## 📖 Documentación

- [DEPLOY.md](DEPLOY.md) - Guía completa de despliegue en Vercel y Render
