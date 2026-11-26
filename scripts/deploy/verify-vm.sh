#!/usr/bin/env bash
set -uo pipefail

# Verificación de despliegue en VM 2 (backend + Redis TLS + Apache) y VM 3 (MySQL TLS).
# Emite únicamente líneas PASS/FAIL sin imprimir secretos ni valores de .env.

ROLE="${1:-}"
if [[ "$ROLE" != "vm2" && "$ROLE" != "vm3" ]]; then
  echo "Uso: $0 <vm2|vm3>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
SECRETS_DIR="$REPO_ROOT/.secrets"
SYSTEM_CA="/usr/local/share/ca-certificates/team-ca.crt"

PASS_COUNT=0
FAIL_COUNT=0

record_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS | %s\n' "$1"
}

record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'FAIL | %s\n' "$1"
}

check_cmd() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    record_pass "$label"
  else
    record_fail "$label"
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); gsub(/^[ \t"]+|[ \t"\r]+$/, ""); print; exit }' "$file"
}

check_perm() {
  local label="$1"
  local target="$2"
  local expected="$3"
  if [[ ! -e "$target" ]]; then
    record_fail "$label"
    return
  fi
  local mode
  mode="$(stat -c '%a' "$target" 2>/dev/null || echo "")"
  if [[ "$mode" == "$expected" ]]; then
    record_pass "$label"
  else
    record_fail "$label"
  fi
}

check_common() {
  if [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo no)" == "yes" ]]; then
    record_pass "timedatectl_ntp_synchronized"
  else
    record_fail "timedatectl_ntp_synchronized"
  fi

  if grep -qE '[[:space:]]tienda\.lan([[:space:]]|$)' /etc/hosts \
    && grep -qE '[[:space:]]api\.tienda\.lan([[:space:]]|$)' /etc/hosts \
    && grep -qE '[[:space:]]db\.tienda\.lan([[:space:]]|$)' /etc/hosts; then
    record_pass "etc_hosts_entries"
  else
    record_fail "etc_hosts_entries"
  fi

  if [[ -f "$SYSTEM_CA" ]] && openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt "$SYSTEM_CA" >/dev/null 2>&1; then
    record_pass "system_ca_installed"
  else
    record_fail "system_ca_installed"
  fi

  check_perm "perm_env_600" "$ENV_FILE" "600"
  check_perm "perm_secrets_dir_700" "$SECRETS_DIR" "700"
}

check_vm3() {
  local db_bind ip_vm2 ss_out ufw_out ipt_out
  db_bind="$(read_env_value "DB_BIND_ADDRESS" "$ENV_FILE" || true)"
  ip_vm2="$(read_env_value "IP_VM2" "$ENV_FILE" || true)"

  if [[ -n "$db_bind" && "$db_bind" != "0.0.0.0" && "$db_bind" != "127.0.0.1" ]]; then
    record_pass "env_db_bind_address_lan"
  else
    record_fail "env_db_bind_address_lan"
  fi

  if [[ -n "$ip_vm2" && "$ip_vm2" != "0.0.0.0" && "$ip_vm2" != "127.0.0.1" ]]; then
    record_pass "env_ip_vm2_configured"
  else
    record_fail "env_ip_vm2_configured"
  fi

  check_perm "perm_db_root_password_600" "$SECRETS_DIR/db/root-password" "600"
  check_perm "perm_db_server_key_600" "$SECRETS_DIR/db/server.key" "600"
  check_perm "perm_db_ca_crt_644" "$SECRETS_DIR/db/ca.crt" "644"
  check_perm "perm_db_server_crt_644" "$SECRETS_DIR/db/server.crt" "644"

  ss_out="$(ss -tulpn 2>/dev/null || true)"
  if [[ -n "$db_bind" ]] && echo "$ss_out" | grep -qF "${db_bind}:3306" \
    && ! echo "$ss_out" | grep -qE '(0\.0\.0\.0|\[::\]|\*):3306([[:space:]]|$)'; then
    record_pass "listening_mysql_3306_bound"
  else
    record_fail "listening_mysql_3306_bound"
  fi

  ufw_out="$(ufw status 2>/dev/null || sudo -n ufw status 2>/dev/null || true)"
  if [[ -n "$ip_vm2" ]] && echo "$ufw_out" | grep -q "Status: active" \
    && echo "$ufw_out" | grep -qF "3306/tcp" && echo "$ufw_out" | grep -qF "$ip_vm2"; then
    record_pass "ufw_active_mysql_rule"
  else
    record_fail "ufw_active_mysql_rule"
  fi

  ipt_out="$(iptables -S DOCKER-USER 2>/dev/null || sudo -n iptables -S DOCKER-USER 2>/dev/null || true)"
  if [[ -n "$ip_vm2" ]] \
    && echo "$ipt_out" | grep -qE -- "-s ${ip_vm2}(/32)? .*--ctorigdstport 3306 .*-j RETURN" \
    && echo "$ipt_out" | grep -qE -- "--ctorigdstport 3306 .*-j DROP"; then
    record_pass "docker_user_iptables_3306_restricted"
  else
    record_fail "docker_user_iptables_3306_restricted"
  fi

  if [[ "$(docker inspect -f '{{.State.Health.Status}}' ecommerce_db 2>/dev/null || echo none)" == "healthy" ]]; then
    record_pass "container_mysql_healthy"
  else
    record_fail "container_mysql_healthy"
  fi

  if [[ -n "$db_bind" ]]; then
    check_cmd "tls_local_mysql_3306" openssl s_client -starttls mysql -connect "${db_bind}:3306" -servername db.tienda.lan -CAfile "$SECRETS_DIR/db/ca.crt" -verify_return_error </dev/null
  else
    record_fail "tls_local_mysql_3306"
  fi
}

check_vm2() {
  local ip_vm1 ip_vm3 trust_proxy resolved_db ss_out ufw_out redis_cid
  ip_vm1="$(read_env_value "IP_VM1" "$ENV_FILE" || true)"
  ip_vm3="$(read_env_value "IP_VM3" "$ENV_FILE" || true)"
  trust_proxy="$(read_env_value "TRUST_PROXY" "$ENV_FILE" || true)"

  if [[ -n "$ip_vm1" && -n "$ip_vm3" && "$ip_vm1" != "127.0.0.1" && "$ip_vm3" != "127.0.0.1" ]]; then
    record_pass "env_peer_ips_configured"
  else
    record_fail "env_peer_ips_configured"
  fi

  if [[ -n "$trust_proxy" && "${trust_proxy,,}" != "true" && "$trust_proxy" != "*" ]]; then
    record_pass "env_trust_proxy_explicit"
  else
    record_fail "env_trust_proxy_explicit"
  fi

  check_perm "perm_db_app_password_600" "$SECRETS_DIR/db/app-password" "600"
  check_perm "perm_db_ca_crt_644" "$SECRETS_DIR/db/ca.crt" "644"
  check_perm "perm_auth_jwt_secret_600" "$SECRETS_DIR/auth/jwt-secret" "600"
  check_perm "perm_auth_cred_key_600" "$SECRETS_DIR/auth/credential-version.key" "600"
  check_perm "perm_auth_private_key_600" "$SECRETS_DIR/auth/access-private.pem" "600"
  check_perm "perm_redis_app_pass_600" "$SECRETS_DIR/redis/app-password" "600"
  check_perm "perm_redis_health_pass_600" "$SECRETS_DIR/redis/health-password" "600"
  check_perm "perm_redis_acl_600" "$SECRETS_DIR/redis/users.acl" "600"
  check_perm "perm_redis_server_key_600" "$SECRETS_DIR/redis/server.key" "600"
  check_perm "perm_redis_ca_644" "$SECRETS_DIR/redis/ca.crt" "644"
  check_perm "perm_redis_server_crt_644" "$SECRETS_DIR/redis/server.crt" "644"

  if [[ -n "$ip_vm3" ]] && resolved_db="$(docker exec ecommerce_api getent hosts db.tienda.lan 2>/dev/null | awk '{print $1}' | head -n1)" && [[ "$resolved_db" == "$ip_vm3" ]]; then
    record_pass "container_extra_hosts_db"
  else
    record_fail "container_extra_hosts_db"
  fi

  ss_out="$(ss -tulpn 2>/dev/null || true)"
  if echo "$ss_out" | grep -qE '127\.0\.0\.1:3000([[:space:]]|$)' \
    && ! echo "$ss_out" | grep -qE '(0\.0\.0\.0|\[::\]|\*):3000([[:space:]]|$)' \
    && echo "$ss_out" | grep -qE ':443([[:space:]]|$)' \
    && ! echo "$ss_out" | grep -qE ':6379([[:space:]]|$)'; then
    record_pass "listening_ports_bound"
  else
    record_fail "listening_ports_bound"
  fi

  ufw_out="$(ufw status 2>/dev/null || sudo -n ufw status 2>/dev/null || true)"
  if [[ -n "$ip_vm1" ]] && echo "$ufw_out" | grep -q "Status: active" \
    && echo "$ufw_out" | grep -qF "443/tcp" && echo "$ufw_out" | grep -qF "$ip_vm1"; then
    record_pass "ufw_active_api_443_rule"
  else
    record_fail "ufw_active_api_443_rule"
  fi

  if [[ "$(docker inspect -f '{{.State.Health.Status}}' ecommerce_api 2>/dev/null || echo none)" == "healthy" ]]; then
    record_pass "container_api_healthy"
  else
    record_fail "container_api_healthy"
  fi

  redis_cid="$(docker compose -f "$REPO_ROOT/compose.vm2-backend.yaml" ps -q redis 2>/dev/null || true)"
  if [[ -n "$redis_cid" ]] && [[ "$(docker inspect -f '{{.State.Health.Status}}' "$redis_cid" 2>/dev/null || echo none)" == "healthy" ]]; then
    record_pass "container_redis_healthy"
  else
    record_fail "container_redis_healthy"
  fi

  check_cmd "tls_local_api_tienda_lan" openssl s_client -connect api.tienda.lan:443 -servername api.tienda.lan -CAfile /etc/ssl/certs/ca-certificates.crt -verify_return_error </dev/null
  check_cmd "tls_next_hop_db_tienda_lan" openssl s_client -starttls mysql -connect db.tienda.lan:3306 -servername db.tienda.lan -CAfile "$SECRETS_DIR/db/ca.crt" -verify_return_error </dev/null
}

check_common
if [[ "$ROLE" == "vm3" ]]; then
  check_vm3
else
  check_vm2
fi

printf 'SUMMARY | PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
