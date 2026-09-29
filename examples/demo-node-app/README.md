# Demo Node App for LocalPaaS

A minimal Node.js application designed to test and verify LocalPaaS zero-downtime automated deployment.

## Features
- Minimal footprint (`node:20-alpine`)
- `GET /` - Friendly HTML status screen
- `GET /health` - JSON readiness/liveness health check probe endpoint

## Quick Test Flow
1. Create a GitHub repository and push this directory's files.
2. In LocalPaaS, click **"Add Project"**.
3. Enter your repository URL and choose branch `main`.
4. Internal Port is preset to `8080`, Health check path `/health`.
5. Click **"Create Project"** with initial deployment checked.
6. LocalPaaS will automatically build the image, start the container, perform health checks, and expose it via Traefik.
7. Push an update (e.g. changing `APP_VERSION` to `1.0.1` in `Dockerfile`), and watch the automated zero-downtime deployment trigger!
