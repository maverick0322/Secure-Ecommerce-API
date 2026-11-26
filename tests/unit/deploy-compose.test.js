'use strict';
const fs = require('node:fs');
const yaml = require('js-yaml');

describe('3-VM distributed compose definitions (VM 2 backend and VM 3 database)', () => {
  it('enforces MySQL 8.4 TLS transport, non-root secrets and host hardening in compose.vm3-db.yaml', () => {
    const vm3 = yaml.load(fs.readFileSync('compose.vm3-db.yaml', 'utf8'));

    expect(Object.keys(vm3.services)).toEqual(['db']);
    expect(vm3.services.db.image).toBe('mysql:8.4');
    expect(vm3.services.db.ports).toEqual(['${DB_BIND_ADDRESS:-127.0.0.1}:${DB_PORT:-3306}:3306']);
    expect(vm3.services.db.command).toContain('--authentication-policy=caching_sha2_password,,');
    expect(vm3.services.db.command).toContain('--require_secure_transport=ON');
    expect(vm3.services.db.command).toContain('--ssl-ca=/run/secrets/db_ca');
    expect(vm3.services.db.environment.MYSQL_ROOT_PASSWORD_FILE).toBe('/run/secrets/db_root_password');
    expect(vm3.services.db.environment.MYSQL_ROOT_PASSWORD).toBeUndefined();
    expect(vm3.services.db.read_only).toBe(true);
    expect(vm3.services.db.security_opt).toContain('no-new-privileges:true');
    expect(vm3.services.db.cap_drop).toEqual(['ALL']);
    expect(vm3.services.db.secrets).toEqual(['db_root_password', 'db_ca', 'db_server_cert', 'db_server_key']);
  });

  it('isolates VM 2 backend API and TLS Redis without a local db container in compose.vm2-backend.yaml', () => {
    const vm2 = yaml.load(fs.readFileSync('compose.vm2-backend.yaml', 'utf8'));

    expect(Object.keys(vm2.services).sort()).toEqual(['app', 'redis']);
    expect(vm2.services.db).toBeUndefined();
    expect(vm2.services.app.ports).toEqual(['${APP_BIND_ADDRESS:-127.0.0.1}:${SERVER_PORT:-3000}:3000']);
    expect(vm2.services.app.depends_on).toEqual({
      redis: { condition: 'service_healthy', required: true }
    });
    expect(vm2.services.app.environment).toEqual(expect.arrayContaining([
      'DB_HOST=${DOCKER_DB_HOST:-db.tienda.lan}',
      'DB_SSL=${DB_SSL:-true}',
      'DB_SSL_CA_PATH=/run/secrets/db_ca',
      'TRUST_PROXY=${TRUST_PROXY:-true}',
      'DB_PASSWORD_FILE=/run/secrets/db_password',
      'JWT_SECRET_FILE=/run/secrets/jwt_secret'
    ]));
    expect(vm2.services.app.secrets).toContain('db_ca');
    expect(vm2.services.app.read_only).toBe(true);
    expect(vm2.services.app.security_opt).toContain('no-new-privileges:true');
    expect(vm2.services.app.cap_drop).toEqual(['ALL']);
    expect(vm2.services.redis.image).toBe('redis:8.2');
    expect(vm2.services.redis.ports).toBeUndefined();
    expect(vm2.services.redis.networks).toEqual(['backend_internal']);
    expect(vm2.networks.backend_internal.internal).toBe(true);
  });
});
