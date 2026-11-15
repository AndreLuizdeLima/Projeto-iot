#!/bin/sh
set -eu

# O bind mount é somente leitura. Copiar os hashes/ACLs para arquivos privados
# evita depender de UID/GID do checkout Linux/macOS e não inclui senhas na imagem.
mkdir -p /tmp/mosquitto-auth
cp /mosquitto/config/passwords /tmp/mosquitto-auth/passwords
cp /mosquitto/config/acl /tmp/mosquitto-auth/acl
chown -R 1883:1883 /tmp/mosquitto-auth
chmod 0700 /tmp/mosquitto-auth
chmod 0600 /tmp/mosquitto-auth/passwords /tmp/mosquitto-auth/acl
chown 1883:1883 /mosquitto/data

exec mosquitto -c "${1:-/mosquitto/config/mosquitto.conf}"
