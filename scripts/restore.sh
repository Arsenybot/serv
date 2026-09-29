#!/usr/bin/env bash
set -e

# LocalPaaS Database Restore Script
if [ -z "$1" ]; then
  echo "Usage: ./scripts/restore.sh <path-to-sql-file>"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file ${BACKUP_FILE} does not exist."
  exit 1
fi

POSTGRES_USER=${POSTGRES_USER:-paas}
POSTGRES_DB=${POSTGRES_DB:-paas}
CONTAINER_NAME=${CONTAINER_NAME:-localpaas_postgres}

echo "===> Restoring LocalPaaS Database from ${BACKUP_FILE}..."

if command -v docker >/dev/null 2>&1 && docker ps | grep -q "${CONTAINER_NAME}"; then
  docker exec -i "${CONTAINER_NAME}" psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "${BACKUP_FILE}"
elif command -v psql >/dev/null 2>&1; then
  psql "${DATABASE_URL}" < "${BACKUP_FILE}"
else
  echo "Error: No docker container or psql client available."
  exit 1
fi

echo "===> Database restored successfully."
