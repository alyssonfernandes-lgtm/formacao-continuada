#!/usr/bin/env bash
# Restauração de backup em um banco VAZIO (teste em homologação antes de usar em produção).
# Uso: DATABASE_URL=postgres://.../formacao_restaurado BACKUP_PASSPHRASE_FILE=... ./scripts/restore.sh backups/formacao-AAAAMMDD-HHMMSS.dump.gpg
set -euo pipefail
FILE="${1:?informe o arquivo .dump.gpg}"
: "${DATABASE_URL:?defina DATABASE_URL do banco de destino}"
: "${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE}"
[ -f "$FILE.sha256" ] && sha256sum -c "$FILE.sha256"
gpg --batch --decrypt --passphrase-file "$BACKUP_PASSPHRASE_FILE" "$FILE" | pg_restore --no-owner --exit-on-error -d "$DATABASE_URL"
echo "Restauração concluída. Use as MESMAS chaves DATA_ENCRYPTION_KEY e CPF_HMAC_KEY da origem."
