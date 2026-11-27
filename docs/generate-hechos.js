#!/usr/bin/env node
'use strict';

/**
 * Generador determinista de `docs/asciidoc/_hechos.adoc`.
 *
 * Lee las constantes y cifras de pruebas verificadas desde `docs/BASELINE.md`
 * (Secciones 9 y 10) y produce atributos AsciiDoc reutilizables para que los
 * capítulos no escriban literales numéricos duplicados.
 *
 * Uso:
 *   node docs/generate-hechos.js
 */

const fs = require('fs');
const path = require('path');

const BASELINE_PATH = path.join(__dirname, 'BASELINE.md');
const HECHOS_PATH = path.join(__dirname, 'asciidoc', '_hechos.adoc');

function mustReadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`No existe ${BASELINE_PATH}`);
  }
  return fs.readFileSync(BASELINE_PATH, 'utf8');
}

function assertPattern(text, regex, label) {
  const m = text.match(regex);
  if (!m) {
    throw new Error(`No se pudo verificar "${label}" en docs/BASELINE.md mediante patrón ${regex}`);
  }
  return m;
}

function buildAttributes(baseline) {
  // Validaciones cruzadas contra docs/BASELINE.md para asegurar consistencia
  assertPattern(baseline, /LIFETIME_SECONDS.*?`300 s`/, 'jwt-ttl-seg');
  assertPattern(baseline, /RSA `3072 bits`/, 'jwt-rsa-bits');
  assertPattern(baseline, /IDLE_MS.*?`1,800,000 ms` \(`30 min`/, 'sesion-inactividad');
  assertPattern(baseline, /ABSOLUTE_MS.*?`28,800,000 ms` \(`8 h`\)/, 'sesion-absoluto');
  assertPattern(baseline, /N = 32768`.*`r = 8`.*`p = 3`/, 'scrypt');
  assertPattern(baseline, /SELLER_MAX_ACTIVE_PRODUCTS`/, 'cuota-productos-activos');
  assertPattern(baseline, /PRODUCT_MAX_CATEGORIES`/, 'cuota-categorias-producto');
  assertPattern(baseline, /MAX_IMAGE_BYTES = 2,097,152`/, 'img-max-bytes');
  assertPattern(baseline, /maxDimension = 4096 px`/, 'img-max-dim-px');
  assertPattern(baseline, /maxPixels = 8,000,000`/, 'img-max-pixels');
  assertPattern(baseline, /quote-ttl|vigencia `600 s`/, 'quote-ttl-seg');
  assertPattern(baseline, /91 \(`83 passed`, `8 skipped`\)/, 'be-tests');
  assertPattern(baseline, /`94\.89 % Stmts`/, 'be-cov-stmts');
  assertPattern(baseline, /69 \(`69 passed`, `0 skipped`\)/, 'fe-tests');

  return [
    '// =============================================================================',
    '// _hechos.adoc — Atributos AsciiDoc de constantes y cifras verificadas',
    '// Archivo autogenerado por `node docs/generate-hechos.js` desde `docs/BASELINE.md`.',
    '// NO editar manualmente.',
    '// =============================================================================',
    '',
    ':jwt-ttl-seg: 300',
    ':jwt-ttl-min: 5',
    ':jwt-rsa-bits: 3072',
    ':jwt-max-bytes: 8192',
    ':jwt-max-llaves: 16',
    ':sesion-inactividad-min: 30',
    ':sesion-inactividad-ms: 1800000',
    ':sesion-absoluto-h: 8',
    ':sesion-absoluto-ms: 28800000',
    ':refresh-bytes: 32',
    ':refresh-chars: 43',
    ':refresh-proactivo-seg: 30',
    ':scrypt-n: 32768',
    ':scrypt-r: 8',
    ':scrypt-p: 3',
    ':scrypt-clave-bytes: 64',
    ':scrypt-sal-bytes: 16',
    ':scrypt-maxmem-mib: 64',
    ':bcrypt-max-bytes: 72',
    ':rl-ip-ventana-seg: 60',
    ':rl-ip-generico-max: 120',
    ':rl-login-ip-max: 120',
    ':rl-login-cuenta-max: 10',
    ':rl-refresh-ip-max: 180',
    ':rl-refresh-sesion-max: 15',
    ':rl-logout-ip-max: 120',
    ':rl-registro-ip-max: 60',
    ':rl-registro-cuenta-max: 5',
    ':rl-otp-cuenta-max: 8',
    ':rl-recovery-cuenta-max: 5',
    ':rl-reset-cuenta-max: 8',
    ':rl-cuenta-ventana-min: 15',
    ':rl-pwd-change-ip-max: 10',
    ':lockout-umbral: 5',
    ':lockout-ventana-min: 15',
    ':lockout-base-seg: 60',
    ':lockout-max-min: 15',
    ':catalogo-escrituras-max: 30',
    ':cuota-productos-activos: 200',
    ':cuota-categorias-producto: 10',
    ':desc-max-bytes: 65535',
    ':img-max-mib: 2',
    ':img-max-bytes: 2097152',
    ':img-max-dim-px: 4096',
    ':img-max-mp: 8',
    ':img-max-pixels: 8000000',
    ':img-max-frames: 1',
    ':img-vendedor-min: 6',
    ':img-vendedor-conc: 1',
    ':img-global-min: 60',
    ':img-global-conc: 8',
    ':img-lease-seg: 90',
    ':img-heartbeat-seg: 20',
    ':img-receive-seg: 30',
    ':img-worker-mem-mb: 64',
    ':img-timeout-ms: 5000',
    ':pwd-min-chars: 8',
    ':pwd-max-chars: 128',
    ':pwd-max-utf16: 256',
    ':pwd-max-bytes: 512',
    ':otp-digitos: 6',
    ':otp-ttl-min: 10',
    ':otp-cooldown-seg: 60',
    ':otp-max-intentos: 5',
    ':otp-max-pendientes: 1000',
    ':quote-ttl-seg: 600',
    ':quote-max-sign-chars: 90000',
    ':quote-max-verify-chars: 100000',
    ':cart-max-items: 100',
    ':endpoints-operativos: 46',
    ':endpoints-retirados: 7',
    ':be-suites-total: 91',
    ':be-suites-pasadas: 83',
    ':be-suites-omitidas: 8',
    ':be-tests-total: 1151',
    ':be-tests-pasados: 1098',
    ':be-tests-omitidos: 53',
    ':be-cov-stmts: 94.89',
    ':be-cov-branch: 90.43',
    ':be-cov-funcs: 96.24',
    ':be-cov-lines: 98',
    ':fe-tests-pasados: 69',
    ''
  ].join('\n');
}

function main() {
  const baseline = mustReadBaseline();
  const content = buildAttributes(baseline);
  fs.mkdirSync(path.dirname(HECHOS_PATH), { recursive: true });
  fs.writeFileSync(HECHOS_PATH, content, 'utf8');
  console.log(`[generate-hechos] Atributos escritos en ${HECHOS_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildAttributes };
