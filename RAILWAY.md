# Teodora no Railway

## 1) Novo projeto
1. [railway.app](https://railway.app) → New Project → Deploy from GitHub  
2. Repo: `Marcos-teodoro/Teodorossite`  
3. Root do serviço: pasta do repositório (não só `server`)

O deploy usa **Dockerfile** (Python 3.11).

## 2) Start Command
```bash
cd server && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## 3) Variáveis (Settings → Variables)

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

# CepCerto — no Railway só o token (secret). CEPs/remetente = Admin → CepCerto
CEPCERTO_BASE_URL=https://cepcerto.com
CEPCERTO_POSTAGE_TOKEN=
CEPCERTO_CONSUMPTION_KEY=
CEPCERTO_ORIGIN_CEP=01310100

# Galeria de fotos (Supabase Storage)
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
```

### CepCerto no admin (sem redeploy)
No painel **Admin → CepCerto** você cadastra:
- Remetente (nome, CPF/CNPJ, telefone…)
- **CEP de origem por tipo de frete** (PAC, SEDEX, Jadlog, Loggi…)
- Saldo, crédito PIX, gastos com etiquetas
- Em **Pedidos → Detalhes**: gerar / cancelar etiqueta (grava custo e margem vs frete pago pelo cliente)

O cliente paga o frete **junto no total** do Mercado Pago. A etiqueta debita a **carteira CepCerto da loja**.

## 4) URLs
- Loja: https://teodorossite-production.up.railway.app/
- Admin: https://teodorossite-production.up.railway.app/admin/
- Health: https://teodorossite-production.up.railway.app/api/health

## 5) Volume (OBRIGATÓRIO — sem ele os dados somem a cada deploy)

O banco é SQLite dentro do contêiner. O disco do Railway é **apagado a cada deploy**: produtos, pedidos e clientes
cadastrados são perdidos. Para guardar os dados:

1. Railway → seu serviço → **Settings → Volumes → New Volume**.
2. **Mount path:** `/data` (não use `/app/server`, que cobriria o código do site).
3. Pronto: ao detectar o volume (`RAILWAY_VOLUME_MOUNT_PATH`), o servidor grava o banco em `/data/teodora.db`.
   Confira em `/api/health`: `"persistentStorage": true`.

As fotos dos produtos ficam no Supabase Storage, então sobrevivem mesmo sem volume.

### Restaurar o catálogo depois de perder os dados
O arquivo `server/seed_catalog.json` guarda os produtos cadastrados (com as fotos já no Supabase).
Com o volume criado e o banco vazio, adicione a variável `SEED_CATALOG=1`, reinicie o serviço uma vez e
**remova** a variável depois. Para atualizar o arquivo com o catálogo atual (rodando local):
`cd server && python scripts/export_catalog.py`.
