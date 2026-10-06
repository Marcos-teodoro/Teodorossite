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

## 5) Banco de dados: Supabase (Postgres) — OBRIGATÓRIO

Produtos, pedidos, clientes e endereços ficam no **Postgres do Supabase** (as fotos já ficam no Storage do mesmo projeto).
Sem `DATABASE_URL` o servidor cai num SQLite dentro do contêiner, cujo disco é **apagado a cada deploy**.

1. Supabase → **Project Settings → Database → Connection string → URI**.
2. Escolha **Session pooler** (porta 5432). O Railway não alcança a conexão direta (IPv6). Troque `[YOUR-PASSWORD]`
   pela senha do banco (Project Settings → Database → Reset database password, se não lembrar).
3. Railway → Variables → `DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres`
4. Reinicie. Na primeira subida o sistema **cria todas as tabelas sozinho**, já com RLS ligado (ninguém acessa pela API pública do
   Supabase). Confira em `/api/health`: `"database": "postgres"`.

### Restaurar o catálogo
`server/seed_catalog.json` guarda os produtos já cadastrados (fotos já no Supabase). Com o banco novo e vazio, adicione
`SEED_CATALOG=1`, reinicie **uma vez** e depois **remova** a variável. Para atualizar o arquivo com o catálogo atual:
`cd server && python scripts/export_catalog.py` (com `DATABASE_URL` apontando para o banco de onde exportar).

> Alternativa sem Supabase: um Volume do Railway montado em `/data` (o servidor detecta `RAILWAY_VOLUME_MOUNT_PATH` e grava o
> SQLite lá). Não use `/app/server` como mount path: cobriria o código.
