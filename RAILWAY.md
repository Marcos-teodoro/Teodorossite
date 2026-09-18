# Teodora no Railway

## 1) Novo projeto
1. [railway.app](https://railway.app) → New Project → Deploy from GitHub  
2. Repo: `Marcos-teodoro/Teodorossite`  
3. Root do serviço: pasta do repositório (não só `server`)

## 2) Start Command
```bash
cd server && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## 3) Variáveis (Settings → Variables)

Substitua pelo seu domínio Railway (já provisionado):

```
BASE_URL=https://teodorossite-production.up.railway.app
FRONTEND_URL=https://teodorossite-production.up.railway.app

JWT_SECRET=troque-por-uma-string-longa
ADMIN_EMAIL=admin@gmail.com
ADMIN_PASSWORD=sua-senha-forte
ADMIN_USER_ID=fa162d9e-8c93-4a6a-994d-c41c7a0e31d5

MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_SANDBOX=false

CEPCERTO_BASE_URL=https://cepcerto.com
CEPCERTO_POSTAGE_TOKEN=
CEPCERTO_CONSUMPTION_KEY=
CEPCERTO_ORIGIN_CEP=01310100

# Galeria de fotos (Supabase Storage)
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
```

Railway injeta `PORT=8080` sozinho — **não** fixe 3001 no Start Command. Use:

```bash
cd server && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## 4) URLs
- Loja: https://teodorossite-production.up.railway.app/
- Admin: https://teodorossite-production.up.railway.app/admin/
- Health: https://teodorossite-production.up.railway.app/api/health

## 5) Volume (importante)
SQLite e fotos ficam no disco do container. Em Settings → Volumes, monte um volume em `/app/server` (ou o path onde roda o app) para não perder banco/uploads a cada redeploy. Sem volume, o catálogo volta ao seed no restart.
