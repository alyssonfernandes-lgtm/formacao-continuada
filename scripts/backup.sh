#!/usr/bin/env bash
# Backup cifrado do banco. Agende diariamente (cron/systemd timer) e copie o arquivo para fora do servidor.
# Requer: pg_dump, gpg. Variáveis: DATABASE_URL, BACKUP_DIR (padrão ./backups), BACKUP_PASSPHRASE_FILE, BACKUP_KEEP_DAYS (padrão 30)
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
: "${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE (arquivo com a senha do backup, permissão 600)}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/formacao-$STAMP.dump.gpg"
pg_dump --format=custom --no-owner "$DATABASE_URL" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$BACKUP_PASSPHRASE_FILE" -o "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
find "$DIR" -name 'formacao-*.dump.gpg*' -mtime +"$KEEP" -delete
echo "Backup gerado: $OUT"
