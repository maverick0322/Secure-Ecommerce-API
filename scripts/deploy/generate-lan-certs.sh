#!/usr/bin/env bash
set -euo pipefail

# Genera una CA interna y certificados SAN para el despliegue distribuido en 3 VMs:
#   VM 1: tienda.lan      (Apache 2 HTTPS + frontendnet)
#   VM 2: api.tienda.lan  (Apache 2 HTTPS + backendnode)
#   VM 3: db.tienda.lan   (MySQL 8.4 TLS obligatorio)

OUT_DIR="./lan-certs"
DAYS=90

while getopts "o:d:" opt; do
  case "$opt" in
    o) OUT_DIR="$OPTARG" ;;
    d) DAYS="$OPTARG" ;;
    *)
      echo "Uso: $0 [-o directorio_salida] [-d dias_validez]" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

CA_KEY="$OUT_DIR/team-ca.key"
CA_CRT="$OUT_DIR/team-ca.crt"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CRT" ]]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
    -keyout "$CA_KEY" \
    -out "$CA_CRT" \
    -subj "/CN=Secure-Ecommerce-Team-CA/O=UV-Programacion-Segura" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 "$CA_KEY"
  chmod 644 "$CA_CRT"
fi

issue_cert() {
  local host="$1"
  local key="$OUT_DIR/$host.key"
  local csr="$OUT_DIR/$host.csr"
  local crt="$OUT_DIR/$host.crt"
  local ext="$OUT_DIR/$host.ext"

  openssl req -newkey rsa:2048 -nodes \
    -keyout "$key" \
    -out "$csr" \
    -subj "/CN=$host/O=UV-Programacion-Segura"

  cat > "$ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$host
EOF

  openssl x509 -req -sha256 -days "$DAYS" \
    -in "$csr" \
    -CA "$CA_CRT" \
    -CAkey "$CA_KEY" \
    -CAcreateserial \
    -out "$crt" \
    -extfile "$ext"

  rm -f "$csr" "$ext"
  chmod 600 "$key"
  chmod 644 "$crt"
}

issue_cert "tienda.lan"
issue_cert "api.tienda.lan"
issue_cert "db.tienda.lan"

BUNDLE="$OUT_DIR/ca-bundle.crt"
if [[ -f /etc/ssl/certs/ca-certificates.crt ]]; then
  cat /etc/ssl/certs/ca-certificates.crt "$CA_CRT" > "$BUNDLE"
else
  cp "$CA_CRT" "$BUNDLE"
fi
chmod 644 "$BUNDLE"

echo "Certificados generados en: $OUT_DIR"
echo "  - CA:          $CA_CRT"
echo "  - Bundle VM 1: $BUNDLE"
echo "  - VM 1 / 2 / 3: tienda.lan, api.tienda.lan, db.tienda.lan"
