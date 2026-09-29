# LocalPaaS — Personal Self-Hosted GitHub Deployment Server

> **Self-hosted automated local deployment platform from GitHub to Docker with zero-downtime container replacement, Traefik reverse proxy, real-time log streaming, and health checks.**

This is **NOT** a public multi-tenant SaaS or a heavy Kubernetes distribution. It is your **personal home lab / local deployment machine**.

**The core flow:**
```text
Write code → Push to GitHub → Webhook triggered → Pull repo → Build Docker image →
Start new container → Verify health check → Switch Traefik route → Mark LIVE → Stop old container
```

If a build or health check fails:
- The deployment is marked **FAILED**.
- **The previous working deployment stays LIVE and untouched!** (Zero-downtime guarantee).

---

## 1. Что делает система (What the System Does)

LocalPaaS automates the lifecycle of your web applications on your own local server, homelab machine, or VPS:
- **Instant Deployment on Push**: Listens for GitHub push webhooks and queues automated builds.
- **Zero-Downtime Releases**: Deploys the new container side-by-side with the old one, probes the health check endpoint, and only routes traffic once the new container is healthy.
- **Instant Rollback**: Reverts to any previous successful release in seconds by reusing the already-built Docker image without re-cloning or rebuilding git.
- **Dynamic Reverse Proxy**: Integrates with Traefik using Docker labels to route requests from custom domains (e.g. `http://my-app.localhost` or `https://my-app.yourdomain.com`).
- **Realtime Log Streaming**: Web-based terminal with build logs and runtime stdout/stderr logs.
- **Encrypted Secrets**: Stores environment variables encrypted with AES-256-GCM.
- **Automated Retention & Cleanup**: Keeps your last 10 deployments while strictly preserving active and rollback-ready images.

---

## 2. Архитектура (Architecture)

```text
GitHub Push Event
       │
       ▼ (Webhook HMAC-SHA256)
┌──────────────────────────────────────────────┐
│ LocalPaaS API Server (Express + TypeScript)  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ BullMQ + Redis Job Queue                     │
│ (Enforces 1 deploy per project + coalescing) │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Worker / Docker Orchestrator                 │
│ 1. Git Clone (branch filter)                 │
│ 2. Docker Build (tagged image)               │
│ 3. Docker Run (env injection, CPU/RAM caps)  │
│ 4. Health Check Probe (HTTP GET /health)     │
│ 5. Traefik Route Switch (atomic swap)        │
│ 6. Graceful Stop Old Container               │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Traefik v3 Reverse Proxy                     │
│ (Routes traffic to healthy container)        │
└──────────────────────┬───────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
[Local Mode: *.localhost]    [Public: Cloudflare Tunnel]
```

### Services in `docker-compose.yml`:
1. **`traefik`**: Traefik v3 proxy routing port 80 based on Host headers.
2. **`postgres`**: PostgreSQL 16 storing projects, deployments, logs, and encrypted secrets.
3. **`redis`**: Redis 7 powering BullMQ queues.
4. **`api`**: Fastify/Express backend managing metadata, webhooks, and REST endpoints.
5. **`worker`**: Background worker interacting with host `/var/run/docker.sock`.
6. **`web`**: Modern React 19 + Tailwind dashboard.
7. **`cloudflared`** *(optional)*: Cloudflare Tunnel for public domain access without open router ports.

---

## 3. Требования (Requirements)

- **OS**: Linux (Ubuntu 20.04+, Debian 11+, Arch), macOS, or Windows WSL2.
- **Docker**: Docker Engine 24.0+ and Docker Compose v2+.
- **RAM**: Minimum 2 GB (4 GB+ recommended for running multiple containers).
- **Disk**: 10 GB+ free disk space for Docker image cache.
- **GitHub Account**: With Personal Access Token (for auto-webhooks).

---

## 4. Установка Docker (Docker Installation)

### Ubuntu / Debian:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

Verify installation:
```bash
docker --version
docker compose version
```

---

## 5. Создание `.env` (Environment Configuration)

Copy the provided example file:
```bash
cp .env.example .env
```

Configure your secrets in `.env`:
```ini
# GitHub Credentials
GITHUB_TOKEN=ghp_yourPersonalAccessTokenHere
GITHUB_WEBHOOK_SECRET=your_random_generated_secret_string

# PostgreSQL Database
POSTGRES_USER=paas
POSTGRES_PASSWORD=generate_a_secure_database_password
POSTGRES_DB=paas
DATABASE_URL=postgresql://paas:generate_a_secure_database_password@postgres:5432/paas?schema=public

# Redis Queue
REDIS_URL=redis://redis:6379

# Cryptography (min 32 random characters for AES-256-GCM)
JWT_SECRET=c8f8b898239023471092837409182374091823740912
ENCRYPTION_KEY=super_secret_aes256_encryption_key_32_bytes_long

# Domains
TRAEFIK_DOMAIN=localhost

# Optional: Cloudflare Tunnel Token for public access
CLOUDFLARE_TUNNEL_TOKEN=

# Default limits
DEFAULT_CPU_LIMIT=1
DEFAULT_MEMORY_LIMIT=512m
MAX_DEPLOYMENTS_PER_PROJECT=10
```

---

## 6. Создание GitHub Token (GitHub Personal Access Token)

To allow LocalPaaS to inspect repositories and auto-create webhooks:
1. Log in to GitHub and go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens** (or Classic).
2. Click **Generate new token (classic)**.
3. Select the following scopes:
   - `repo` (Full control of private repositories)
   - `admin:repo_hook` (Read/write repository webhooks)
4. Click **Generate token** and copy the resulting string into `GITHUB_TOKEN=` in `.env`.

---

## 7. Настройка GitHub Webhook (Configuring GitHub Webhooks)

When you create a project in LocalPaaS, if `GITHUB_TOKEN` is set, LocalPaaS **automatically creates the webhook for you**.

### Manual Webhook Setup:
If setting up manually or using a self-hosted tunnel:
1. Open your GitHub repository in your browser.
2. Navigate to **Settings → Webhooks → Add webhook**.
3. **Payload URL**: `https://<YOUR_HOST>/api/webhooks/github` (e.g. `https://paas.example.com/api/webhooks/github` or tunnel URL).
4. **Content type**: Select `application/json`.
5. **Secret**: Enter the exact secret configured in `GITHUB_WEBHOOK_SECRET`.
6. **Which events**: Select **"Just the push event"**.
7. Click **Add webhook**.

---

## 8. Локальный режим (Local Mode: `*.localhost`)

RFC 6761 reserves `*.localhost` to resolve directly to `127.0.0.1` in all modern browsers without `/etc/hosts` modifications.
- When creating a project named `my-api`, LocalPaaS assigns `http://my-api.localhost`.
- Traefik intercepts requests on port 80 and routes them to the appropriate container.
- Simply open `http://my-api.localhost` in Chrome, Safari, or Firefox!

---

## 9. Публичный доступ через Cloudflare Tunnel (Public Mode)

To expose your applications to the internet without opening ports or configuring DDNS:
1. Create a free Cloudflare account and open the **Zero Trust Dashboard → Networks → Tunnels**.
2. Create a new tunnel named `local-paas`.
3. Add a Public Hostname rule:
   - Hostname: `*.yourdomain.com`
   - Service: `HTTP` → `traefik:80`
4. Copy the Tunnel Token provided by Cloudflare.
5. In your `.env` file, set:
   ```ini
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
   TRAEFIK_DOMAIN=yourdomain.com
   ```
6. Start with the tunnel profile:
   ```bash
   docker compose --profile tunnel up -d
   ```
Now any deployed project `my-app` is instantly available at `https://my-app.yourdomain.com` with automated SSL!

---

## 10. Создание первого проекта (Creating Your First Project)

1. Open `http://localhost:3000` in your browser.
2. Click **"Add Project"**.
3. Fill in the fields:
   - **Project Name**: e.g., `demo-node-app`
   - **GitHub Repository**: e.g., `https://github.com/your-username/demo-node-app`
   - Click **"Auto-detect stack"** (determines Dockerfile, Node.js, Python, or Static).
   - **Internal App Port**: e.g., `8080`
   - **Health Check Path**: `/health`
   - Add any needed **Environment Variables**.
   - Check **"Perform first deployment immediately after creation"**.
4. Click **"Create Project"**.

---

## 11. Первый Deployment (First Deployment)

Once created, LocalPaaS enqueues the deployment:
1. LocalPaaS clones the specified branch.
2. Builds the Docker image `local-paas/demo-node-app:<short-sha>`.
3. Starts the container on an internal bridge network with Traefik labels.
4. Performs health check probes to `GET http://container:port/health`.
5. Upon receiving `HTTP 200 OK`, updates Traefik routing and flags the project as **LIVE**.

---

## 12. Автоматический деплой (Automated Push Deployments)

After initial setup:
1. Open your code editor and make changes to your project.
2. Commit and push:
   ```bash
   git commit -am "feat: update homepage UI"
   git push origin main
   ```
3. GitHub sends a webhook payload to LocalPaaS.
4. LocalPaaS verifies the HMAC signature, confirms the branch matches, and triggers the zero-downtime deployment pipeline!

---

## 13. Логи в реальном времени (Real-Time Logs)

Click on any project's **"Logs"** button to open the terminal viewer:
- **Build Logs**: Output from `docker build` (package installations, layer caching).
- **Runtime Logs**: `stdout` and `stderr` streams from your live container.
- **Features**: Live autoscroll toggle, full-text search, stream filters, log clearing, and one-click log download.

---

## 14. Откат версии (Zero-Downtime Rollback)

If a newly deployed feature introduces a production bug:
1. Go to the project's **Deployments** tab.
2. Find any previous deployment marked **LIVE**.
3. Click the **"Rollback"** button.
4. **Zero Rebuild**: LocalPaaS starts a new container directly from the previously built image, verifies its `/health` check, switches Traefik, and drains the broken container.

---

## 15. Переменные окружения (Environment Variables)

In the **Environment** tab:
- Add key-value pairs (e.g. `DATABASE_URL`, `STRIPE_KEY`).
- Values are encrypted with **AES-256-GCM** before being written to PostgreSQL.
- Values are masked with `••••••••` in the UI with a toggle to reveal.
- Secrets are decrypted only in memory when starting the Docker container and are never printed to build logs.

---

## 16. Устранение неполадок (Troubleshooting)

### Problem: Webhook received, but deployment does not trigger
- **Check Branch**: Make sure the branch you pushed to matches the branch configured in Project Settings (e.g., `main` vs `master`).
- **Check Secret**: Verify `GITHUB_WEBHOOK_SECRET` matches the secret in GitHub Webhook settings.
- **Check Logs**: Inspect `/api/webhooks/github` response in GitHub's **Recent Deliveries** tab.

### Problem: Deployment fails with `HEALTH_CHECK_FAILED`
- **Cause**: The container did not respond with `HTTP 200` on the specified `healthPath` (default `/health`) within the timeout budget.
- **Zero-Downtime in Action**: Your previous container is kept alive!
- **Fix**: Check that your application has a `GET /health` endpoint listening on the configured internal port.

### Problem: Port 80 is already in use
- Another service (e.g. Apache or Nginx) might be occupying port 80. Stop it with:
  ```bash
  sudo systemctl stop nginx
  sudo systemctl disable nginx
  ```

---

## 17. Резервное копирование PostgreSQL (Backup & Restore)

### Create Backup:
```bash
npm run backup
# Or run manually:
./scripts/backup.sh
```
Backups are saved to `./backups/paas_backup_<timestamp>.sql`.

### Restore Backup:
```bash
./scripts/restore.sh ./backups/paas_backup_20260928_120000.sql
```

---

## 18. Безопасность и ограничения (Security & Limitations)

> **"Projects run Docker containers on the host. This system is designed for trusted repositories."**

- **Single Tenant / Personal Server**: This platform is designed for your own repositories and trusted homelab services.
- **No Privileged Containers**: LocalPaaS never runs containers with `--privileged`.
- **No Docker Socket Mounting**: User applications never have access to `/var/run/docker.sock`.
- **Resource Limits**: CPU quotas and memory limits are enforced per container to prevent runaway processes.
- **Isolated Network**: Containers communicate over a dedicated bridge network (`localpaas_network`).

---

## Quick Start (One Command)

```bash
git clone https://github.com/your-username/local-paas.git
cd local-paas
cp .env.example .env
docker compose up -d
```
Open **`http://localhost:3000`** to access your dashboard!
