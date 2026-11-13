'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
class SecureConfigFileError extends Error {
  constructor(code) { super('Invalid protected configuration file.'); this.code = code; }
}
const requireSafe = (condition, code = 'CONFIG_PATH_INVALID') => { if (!condition) throw new SecureConfigFileError(code); };
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function explicitAbsolute(value) {
  if (process.platform === 'win32') return /^[A-Za-z]:[\\/]/.test(value);
  return value.startsWith('/') && !value.startsWith('//');
}
function clean(value) {
  requireSafe(typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.trim() === value);
  requireSafe(!/[\u0000-\u001f\u007f]/.test(value) && !value.startsWith('\\\\') && !value.startsWith('//'));
  requireSafe(!value.split(/[\\/]/).includes('..'));
  // Refuse URLs, Windows drive-relative paths, alternate data streams and
  // foreign-platform absolute paths rather than interpreting them as local.
  requireSafe(!value.includes(':') || (process.platform === 'win32' && /^[A-Za-z]:[\\/][^:]*$/.test(value)));
  return value;
}
function allowedRoots(env) {
  const roots = [path.join(PROJECT_ROOT, '.secrets')];
  if (process.platform !== 'win32') roots.push('/run/secrets', '/run/redis-state', '/run/auth/public-keys');
  if (env.AUTH_CONFIG_ALLOWED_ROOTS) {
    let extra; try { extra = JSON.parse(env.AUTH_CONFIG_ALLOWED_ROOTS); } catch { throw new SecureConfigFileError('CONFIG_ROOTS_INVALID'); }
    requireSafe(Array.isArray(extra) && extra.length <= 16, 'CONFIG_ROOTS_INVALID');
    for (const value of extra) { clean(value); requireSafe(explicitAbsolute(value), 'CONFIG_ROOTS_INVALID'); roots.push(path.resolve(value)); }
  }
  return roots;
}
function noLinks(target, missingLeaf) {
  const parsed = path.parse(target);
  let current = parsed.root;
  const parts = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (missingLeaf && index === parts.length - 1 && error.code === 'ENOENT') return;
      throw new SecureConfigFileError('CONFIG_FILE_UNAVAILABLE');
    }
    requireSafe(!stat.isSymbolicLink(), 'CONFIG_SYMLINK_REJECTED');
    if (index < parts.length - 1) requireSafe(stat.isDirectory(), 'CONFIG_PATH_INVALID');
  }
}
function resolveConfigPath(location, env = process.env, { allowMissingLeaf = false } = {}) {
  clean(location);
  const absolute = explicitAbsolute(location);
  requireSafe(absolute || (!path.isAbsolute(location) && !location.startsWith('\\')));
  const target = absolute ? path.resolve(location) : path.resolve(PROJECT_ROOT, location.replaceAll('\\', '/'));
  // A relative path can never use an external allowlist entry to escape the
  // project's private directory. Absolute managed mounts must be explicit.
  const roots = absolute ? allowedRoots(env) : [path.join(PROJECT_ROOT, '.secrets')];
  requireSafe(roots.some(root => contained(root, target)), 'CONFIG_PATH_NOT_ALLOWED');
  noLinks(target, allowMissingLeaf);
  return target;
}
function readConfigFile(location, maxBytes, env = process.env, encoding = 'utf8') {
  const target = resolveConfigPath(location, env);
  const before = fs.statSync(target);
  requireSafe(before.isFile() && before.size > 0 && before.size <= maxBytes, 'CONFIG_FILE_SIZE_INVALID');
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    requireSafe(opened.isFile() && before.dev === opened.dev && before.ino === opened.ino &&
      before.size === opened.size && before.mtimeMs === opened.mtimeMs, 'CONFIG_FILE_CHANGED');
    const contents = fs.readFileSync(descriptor, encoding);
    requireSafe(Buffer.byteLength(contents) <= maxBytes, 'CONFIG_FILE_SIZE_INVALID');
    // Verify both the opened descriptor and the path after reading. A swapped
    // parent or leaf must not redirect a read to a different inode.
    resolveConfigPath(location, env);
    const after = fs.statSync(target), final = fs.fstatSync(descriptor);
    for (const stat of [after, final]) requireSafe(stat.isFile() && opened.dev === stat.dev && opened.ino === stat.ino &&
      opened.size === stat.size && opened.mtimeMs === stat.mtimeMs, 'CONFIG_FILE_CHANGED');
    return contents;
  } finally { fs.closeSync(descriptor); }
}
module.exports = { PROJECT_ROOT, resolveConfigPath, readConfigFile, SecureConfigFileError };
