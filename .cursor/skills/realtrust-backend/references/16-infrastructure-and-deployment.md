# realtrust ai — Infrastructure and Deployment Specification

This document specifies the infrastructure architecture and deployment strategy for realtrust ai.

---

## 1. Deployment philosophy

1. **Local-to-production parity**: Local development environment MUST mirror production architecture.
2. **Infrastructure as Code**: All AWS resources MUST be defined in Terraform.
3. **Multi-region by design**: Architecture MUST support multi-region deployment from day one.
4. **Compliance-first**: Infrastructure MUST support SOC 2 and FINRA requirements.

---

## 2. Technology stack summary

| Layer | Technology | Local | AWS |
|-------|------------|-------|-----|
| Web Framework | FastAPI 0.110+ | Docker | ECS Fargate |
| WebSocket Gateway | FastAPI WebSocket | Docker | ECS Fargate |
| Database | PostgreSQL 16 + pgvector + PostGIS | Docker (postgis/postgis) | Aurora Global Database |
| Cache | Redis 7+ | Docker | ElastiCache Global Datastore |
| Message Bus | Apache Kafka | Docker (Confluent) | MSK Serverless |
| Schema Registry | Confluent Schema Registry | Docker | ECS Fargate (Confluent Schema Registry) |
| Object Storage | MinIO | Docker | S3 with CRR |
| Job Queue | ARQ | Redis | Redis |
| DNS/Failover | N/A | N/A | Route 53 |
| Secrets | .env file | dotenv | Secrets Manager |
| Observability | OpenTelemetry | OTel Collector + Jaeger/Prometheus | ADOT Collector + X-Ray/CloudWatch |
| Container Registry | ECR | N/A | ECR |
| Edge Protection | WAF | N/A | AWS WAF (attached to ALB) |
| TLS Certificates | ACM | Local dev certs | ACM |
| IaC | N/A | N/A | Terraform |

---

## 3. Local development environment

### 3.1 Docker Compose configuration

```yaml
version: "3.9"
services:
  api:
    build: 
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - REDIS_URL=redis://redis:6379
      - KAFKA_BOOTSTRAP_SERVERS=kafka:9092
      - SCHEMA_REGISTRY_URL=http://schema-registry:8081
      - S3_ENDPOINT_URL=http://minio:9000
      - AWS_ACCESS_KEY_ID=minioadmin
      - AWS_SECRET_ACCESS_KEY=minioadmin
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - db
      - redis
      - kafka
      - minio
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  websocket-gateway:
    build:
      context: .
      dockerfile: Dockerfile.websocket
    ports:
      - "8001:8001"
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - db
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: realtrust
      POSTGRES_PASSWORD: realtrust
      POSTGRES_DB: realtrust
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-extensions.sql:/docker-entrypoint-initdb.d/01-extensions.sql
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"

  schema-registry:
    image: confluentinc/cp-schema-registry:7.5.0
    depends_on:
      - kafka
    ports:
      - "8081:8081"
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: kafka:9092

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data

  outbox-worker:
    build: .
    command: python -m src.workers.outbox_worker
    depends_on:
      - db
      - kafka
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - KAFKA_BOOTSTRAP_SERVERS=kafka:9092

  ai-worker:
    build: .
    command: python -m src.workers.ai_task_worker
    depends_on:
      - db
      - redis
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - REDIS_URL=redis://redis:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}

  document-processor:
    build:
      context: .
      dockerfile: Dockerfile.processor
    command: python -m src.workers.document_processor
    depends_on:
      - db
      - redis
      - minio
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - REDIS_URL=redis://redis:6379
      - S3_ENDPOINT_URL=http://minio:9000
      - OPENAI_API_KEY=${OPENAI_API_KEY}

  image-processor:
    build:
      context: .
      dockerfile: Dockerfile.processor
    command: python -m src.workers.image_processor
    depends_on:
      - db
      - redis
      - minio
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - REDIS_URL=redis://redis:6379
      - S3_ENDPOINT_URL=http://minio:9000
      - OPENAI_API_KEY=${OPENAI_API_KEY}

  match-computer:
    build: .
    command: python -m src.workers.match_computer
    depends_on:
      - db
      - redis
    environment:
      - DATABASE_URL=postgresql+asyncpg://realtrust:realtrust@db:5432/realtrust
      - REDIS_URL=redis://redis:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}

volumes:
  postgres_data:
  minio_data:
```

### 3.2 Database initialization

```sql
-- scripts/init-extensions.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "postgis";
```

### 3.3 Document processor Dockerfile

```dockerfile
# Dockerfile.processor
FROM python:3.12-slim

# Install Tesseract OCR and dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-eng \
    libtesseract-dev \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync

COPY src/ ./src/
```

### 3.4 WebSocket gateway Dockerfile

```dockerfile
# Dockerfile.websocket
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync

COPY src/ ./src/

EXPOSE 8001
CMD ["uvicorn", "src.websocket.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

---

## 4. AWS production architecture

### 4.1 Multi-region overview

```
                    ┌─────────────────────────────────────┐
                    │         Route 53 (DNS)              │
                    │    Health Checks + Failover         │
                    └─────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
    ┌───────────────────────────┐   ┌───────────────────────────┐
    │      US-EAST-1 (Primary)  │   │    US-WEST-2 (Secondary)  │
    │  ┌─────────────────────┐  │   │  ┌─────────────────────┐  │
    │  │   ALB + ECS Fargate │  │   │  │   ALB + ECS Fargate │  │
    │  └─────────────────────┘  │   │  └─────────────────────┘  │
    │            │              │   │            │              │
    │  ┌─────────────────────┐  │   │  ┌─────────────────────┐  │
    │  │  Aurora Global DB   │◀─┼───┼─▶│  Aurora Read Replica│  │
    │  │     (Writer)        │  │   │  │   (Auto-promote)    │  │
    │  └─────────────────────┘  │   │  └─────────────────────┘  │
    │            │              │   │            │              │
    │  ┌─────────────────────┐  │   │  ┌─────────────────────┐  │
    │  │   MSK Kafka         │  │   │  │   MSK Kafka         │  │
    │  │   (Active)          │  │   │  │   (Standby)         │  │
    │  └─────────────────────┘  │   │  └─────────────────────┘  │
    │            │              │   │            │              │
    │  ┌─────────────────────┐  │   │  ┌─────────────────────┐  │
    │  │   S3 Documents      │◀─┼───┼─▶│   S3 Replica        │  │
    │  └─────────────────────┘  │   │  └─────────────────────┘  │
    └───────────────────────────┘   └───────────────────────────┘
```

### 4.2 Service mapping

| Component | AWS Service | Configuration |
|-----------|-------------|---------------|
| Database | Aurora Global Database | PostgreSQL 16, db.r6g.large |
| Cache | ElastiCache Global Datastore | Redis 7, cache.r6g.large |
| Message Bus | MSK Serverless | Active cluster in primary; standby in secondary |
| Schema Registry | ECS Fargate | Confluent Schema Registry (JSON Schema) |
| Object Storage | S3 | Versioning, CRR, Object Lock |
| Compute | ECS Fargate | Auto-scaling task definitions |
| Load Balancer | Application Load Balancer | HTTPS, WAF |
| DNS | Route 53 | Health checks, failover routing |
| Auth | Cognito | User pools, JWT |
| Secrets | Secrets Manager | Automatic rotation |
| Encryption | KMS | CMK with rotation |

### 4.3 VPC architecture

```
VPC: 10.0.0.0/16
├── Public Subnets (ALB, NAT)
│   ├── us-east-1a: 10.0.1.0/24
│   ├── us-east-1b: 10.0.2.0/24
│   └── us-east-1c: 10.0.3.0/24
├── Private Subnets (ECS, Workers)
│   ├── us-east-1a: 10.0.10.0/24
│   ├── us-east-1b: 10.0.11.0/24
│   └── us-east-1c: 10.0.12.0/24
└── Data Subnets (Aurora, ElastiCache)
    ├── us-east-1a: 10.0.20.0/24
    ├── us-east-1b: 10.0.21.0/24
    └── us-east-1c: 10.0.22.0/24
```

---

## 5. ECS task definitions

### 5.1 API service

```json
{
  "family": "realtrust-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "${ECR_REPO}/realtrust-api:${VERSION}",
      "portMappings": [
        {"containerPort": 8000, "protocol": "tcp"}
      ],
      "environment": [
        {"name": "ENV", "value": "production"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/realtrust-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

### 5.2 Worker services

Each worker (outbox, AI, document-processor) has a similar task definition with:
- Appropriate CPU/memory allocation
- Service-specific environment variables
- Health checks appropriate to worker type

---

## 6. S3 bucket configuration

### 6.1 Document storage bucket

```hcl
resource "aws_s3_bucket" "documents" {
  bucket = "realtrust-documents-${var.environment}"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.documents.arn
    }
  }
}
```

### 6.2 Compliance bucket (FINRA WORM)

```hcl
resource "aws_s3_bucket" "compliance" {
  bucket = "realtrust-compliance-${var.environment}"
  
  object_lock_configuration {
    object_lock_enabled = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "compliance" {
  bucket = aws_s3_bucket.compliance.id

  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = 6
    }
  }
}
```

### 6.3 Cross-Region Replication

```hcl
resource "aws_s3_bucket_replication_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  role   = aws_iam_role.replication.arn

  rule {
    id     = "documents-replication"
    status = "Enabled"

    destination {
      bucket        = aws_s3_bucket.documents_replica.arn
      storage_class = "STANDARD"
      
      encryption_configuration {
        replica_kms_key_id = aws_kms_key.documents_replica.arn
      }
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
  }
}
```

---

## 7. Environment variables

### 7.1 Required variables

| Variable | Description | Local | Production |
|----------|-------------|-------|------------|
| `DATABASE_URL` | PostgreSQL connection string | `.env` | Secrets Manager |
| `REDIS_URL` | Redis connection string | `.env` | Secrets Manager |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker addresses | `.env` | MSK endpoint |
| `SCHEMA_REGISTRY_URL` | Schema Registry URL | `.env` | ECS/ALB internal endpoint |
| `S3_ENDPOINT_URL` | S3/MinIO endpoint | `.env` | (not set for AWS) |
| `S3_BUCKET_DOCUMENTS` | Document bucket name | `.env` | SSM Parameter |
| `OPENAI_API_KEY` | OpenAI API key | `.env` | Secrets Manager |
| `COGNITO_USER_POOL_ID` | Cognito pool ID | `.env` | SSM Parameter |
| `COGNITO_CLIENT_ID` | Cognito client ID | `.env` | SSM Parameter |

### 7.3 Observability variables (required)

| Variable | Description | Local | Production |
|----------|-------------|-------|------------|
| `OTEL_SERVICE_NAME` | Service name | `.env` | ECS env |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel Collector endpoint | `.env` | ADOT Collector service |
| `OTEL_RESOURCE_ATTRIBUTES` | Service metadata | `.env` | ECS env |

### 7.2 Optional variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging verbosity | `INFO` |
| `WORKERS_COUNT` | Uvicorn workers | `4` |
| `DB_POOL_SIZE` | Connection pool size | `10` |
| `EMBEDDING_MODEL` | Embedding model ID | `text-embedding-3-small` |
| `LLM_MODEL` | LLM model ID | `gpt-4o` |

---

## 8. Health check endpoints

### 8.1 API health

```
GET /health

Response:
{
  "status": "healthy",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "kafka": "ok"
  }
}
```

### 8.2 Worker health

Workers expose health via Redis key updates or dedicated health endpoints.

---

## 9. Scaling policies

### 9.1 API service

```hcl
resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
```

### 9.2 Scaling limits

| Service | Min | Max | Target CPU |
|---------|-----|-----|------------|
| API | 2 | 20 | 70% |
| Outbox Worker | 1 | 2 | 80% |
| AI Worker | 2 | 10 | 70% |
| Document Processor | 1 | 5 | 80% |

---

## 10. Graceful shutdown

All services MUST handle SIGTERM gracefully:

1. Stop accepting new requests/jobs
2. Complete in-flight work (with timeout)
3. Close database connections
4. Exit cleanly

ECS deregistration delay: 30 seconds

---

## 11. Deployment pipeline

### 11.1 CI/CD stages

1. **Build**: Build Docker images, run unit tests
2. **Test**: Run integration tests against test environment
3. **Staging**: Deploy to staging, run smoke tests
4. **Production**: Blue-green deployment to production

Required gates (MUST):

- proof suite (`11-testing-and-proof-suite.md`) must pass for any DB/RLS/state-machine change
- container image vulnerability scan must pass
- Terraform plan must be reviewed/approved for production applies

### 11.2 Deployment strategy

- **API**: Rolling update (blue-green)
- **Workers**: Rolling update with drain time
- **Database migrations**: Run before API deployment

### 11.3 Rollback

- Automatic rollback on health check failures
- Manual rollback via previous task definition

---

## 12. Cost estimate

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| Aurora Global Database | db.r6g.large, 2 regions, 100GB | $800-1,200 |
| MSK Serverless | 2 regions, moderate throughput | $300-600 |
| ElastiCache Global | cache.r6g.large, 2 regions | $400-600 |
| ECS Fargate | 4 services × 2 regions | $400-800 |
| S3 | 500GB with CRR | $50-100 |
| Route 53 | Health checks + DNS | $50-100 |
| KMS | CMK with rotation | $10-20 |
| Secrets Manager | 20 secrets | $10-20 |
| **Total Estimate** | | **$2,000-3,500/month** |

*Note: Costs scale with usage. Production workloads may vary significantly.*
