# Backend - Generador de Renders

## Requisitos
- Python 3.11+
- PostgreSQL local

## Configuracion
1. Copiar `.env.example` a `.env`.
2. Ajustar `DATABASE_URL` segun tu Postgres local.
3. Crear base de datos y tablas iniciales con `scripts/init_db.sql`.

## Instalacion
```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
```

## Ejecucion
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints iniciales
- GET `/health`
- POST `/project/create`
