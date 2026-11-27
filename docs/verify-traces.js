#!/usr/bin/env node
'use strict';

/**
 * Verificador automático de trazabilidad documental (docs/verify-traces.js).
 *
 * Extrae y comprueba contra el código fuente real de backendnode/ y frontendnet/:
 *  1. Rutas citadas en:
 *     - docs/BASELINE.md
 *     - docs/diagrams/PLAN_DIAGRAMAS.md
 *     - docs/asciidoc/*.adoc
 *     - Cabeceras `' TRACE: ruta1; ruta2; ...` de docs/diagrams/*.puml
 *       (excluyendo _skin.puml y _muestra.puml).
 *  2. Toda clase o método citado entre comillas invertidas (`...`) en
 *     docs/BASELINE.md, docs/diagrams/PLAN_DIAGRAMAS.md y docs/asciidoc/*.adoc.
 *
 * Sale con código 1 y lista todos los faltantes si encuentra al menos uno;
 * sale con código 0 si pasa con 0 faltantes.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = path.join(WORKSPACE_ROOT, 'frontendnet');
const ASCIIDOC_DIR = path.join(__dirname, 'asciidoc');
const DIAGRAMS_DIR = path.join(__dirname, 'diagrams');

const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.cs', '.json', '.yaml', '.yml', '.csproj', '.cshtml', '.sql']);

const NON_CODE_TERMS = new Set([
  'Node', 'Express', 'Sequelize', 'MySQL', 'Redis', 'Cloudinary', 'Gmail', 'Docker', 'PlantUML',
  'OpenJDK', 'Temurin', 'VSTest', 'SonarCloud', 'SonarQube', 'Cloudflare', 'Turnstile', 'Swagger', 'OpenAPI',
  'Kestrel', 'Razor', 'NuGet', 'GitHub', 'Actions', 'Windows', 'Linux', 'PowerShell', 'UTF', 'AsciiDoctor',
  'PascalCase', 'camelCase', 'kebab-case', 'Bearer', 'Basic', 'SameSite', 'HttpOnly', 'SecurePolicy', 'Always',
  'Lax', 'Strict', 'Development', 'Production', 'Conflict', 'Unauthorized', 'Forbidden', 'Gone',
  'BadRequest', 'NotFound', 'TooManyRequests', 'InternalServerError', 'RequestTimeout',
  'Content-Type', 'Authorization', 'Cache-Control', 'Retry-After', 'X-Request-Id',
  'TargetFramework', 'PackageReference', 'SequelizeMeta', 'All files', 'HEAD', 'main',
  'Single', 'Source', 'Truth', 'Model', 'View', 'Controller', 'Services', 'Models', 'Controllers',
  'Middlewares', 'Helpers', 'Validation', 'Extensions', 'ViewComponents', 'Views', 'Routes',
  'Validators', 'Dockerfile', 'Sharp', 'Multer', 'Helmet', 'Cors', 'Dotenv', 'Jest', 'Supertest',
  'JsonWebToken', 'Bcrypt', 'Scrypt', 'Hmac', 'Sha256', 'Base64Url', 'Rsa', 'Uuid', 'BigInt',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'Date', 'Buffer', 'Error', 'Map', 'Set',
  'Decimal', 'Integer', 'Float', 'Double', 'Guid', 'TimeSpan', 'DateTime', 'Task', 'IActionResult',
  'HttpContext', 'HttpResponseMessage', 'HttpRequestMessage', 'DelegatingHandler', 'SemaphoreSlim',
  'ConcurrentDictionary', 'ClaimTypes', 'IHostEnvironment', 'Attribute', 'Exception', 'Enum',
  'CommonJS', 'DataAnnotations', 'TempData', 'ModelState', 'ViewBag', 'IFormFile',
  'Visitante', 'UsuarioAutenticado', 'Comprador', 'Vendedor', 'Administrador',
  'startuml', 'enduml', 'include', 'extend', 'actor', 'usecase', 'class', 'interface', 'enum',
  'component', 'node', 'artifact', 'database', 'participant', 'boundary', 'control', 'entity',
  'table', 'alt', 'opt', 'loop', 'break', 'ref', 'skinparam', 'defaultFontName', 'AttributeFontName',
  'Segoe UI', 'Cascadia Mono', 'Liberation Sans', 'Helvetica Neue', 'Arial', 'Consolas',
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'ESCAPE', 'LIKE', 'NULL', 'NOT NULL',
  'DECIMAL', 'VARCHAR', 'CHAR', 'TEXT', 'INT', 'BIGINT', 'UNSIGNED', 'DATETIME', 'ENUM', 'JSON',
  'PK', 'FK', 'UK', 'IDX', 'UNIQUE', 'GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'HEAD',
  'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ACTIVE', 'DISABLED', 'PREPARING', 'SHIPPED',
  'DELIVERED', 'CANCELED', 'ADMIN', 'BUYER', 'SELLER', 'PENDIENTE', 'PLANIFICADO', 'NO_VERIFICABLE'
]);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) return [pattern];
  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index + match[0].length);
  const parts = match[1].split(',');
  const expanded = [];
  for (const part of parts) {
    for (const sub of expandBraces(`${prefix}${part.trim()}${suffix}`)) {
      expanded.push(sub);
    }
  }
  return expanded;
}

function globToRegex(globPosix) {
  let re = '^';
  let i = 0;
  while (i < globPosix.length) {
    const ch = globPosix[i];
    if (ch === '*' && globPosix[i + 1] === '*') {
      if (globPosix[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      re += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (/[.+^$()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re);
}

function listAllRepoFiles(rootDir, repoPrefix) {
  const results = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj' || entry.name === '.secrets' || entry.name === 'dist') {
          continue;
        }
        walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        const rel = `${repoPrefix}/${toPosix(path.relative(rootDir, path.join(current, entry.name)))}`;
        results.push({ rel, fullPath: path.join(current, entry.name) });
      }
    }
  }
  walk(rootDir);
  return results;
}

function loadCodeCorpus(allFiles) {
  const chunks = [];
  for (const f of allFiles) {
    if (f.rel.startsWith('backendnode/docs/')) continue;
    const ext = path.extname(f.fullPath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext) && path.basename(f.fullPath) !== 'Dockerfile') continue;
    try {
      chunks.push(fs.readFileSync(f.fullPath, 'utf8'));
    } catch (_) {
      // ignore
    }
  }
  return chunks.join('\n');
}

function extractPathsFromText(docLabel, content) {
  const lines = content.split(/\r?\n/);
  const found = [];
  const pathRegex = /\b((?:backendnode|frontendnet)\/(?:[A-Za-z0-9_.*\/-]|\{[A-Za-z0-9_.*\/,\s-]+\})+(?::\d+(?:-\d+)?)?)/g;

  lines.forEach((line, idx) => {
    const sanitized = line.replace(/file:\/\/\/[^)\s]+/g, '');
    let m = pathRegex.exec(sanitized);
    while (m !== null) {
      const raw = m[1].replace(/[.,;:'")]+$/, '');
      found.push({ doc: docLabel, line: idx + 1, raw });
      m = pathRegex.exec(sanitized);
    }
  });
  return found;
}

function extractTraceHeaderPaths(pumlName, content) {
  const lines = content.split(/\r?\n/);
  const found = [];
  let hasTraceHeader = false;

  lines.forEach((line, idx) => {
    const m = line.match(/^\s*'\s*TRACE:\s*(.+)$/);
    if (!m) return;
    hasTraceHeader = true;
    const parts = m[1].split(';').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      found.push({ doc: pumlName, line: idx + 1, raw: part });
    }
  });

  return { hasTraceHeader, paths: found };
}

function extractSymbolsFromDoc(docLabel, content) {
  const lines = content.split(/\r?\n/);
  const found = [];
  let inCodeFence = false;

  lines.forEach((line, idx) => {
    if (/^\s*(?:```|----)/.test(line)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

    const tickRegex = /`([^`]+)`/g;
    let m = tickRegex.exec(line);
    while (m !== null) {
      const token = m[1].trim();
      m = tickRegex.exec(line);

      if (!token) continue;
      if (
        token.includes('/') ||
        token.includes('\\') ||
        token.includes(' ') ||
        token.includes('{') ||
        token.includes('}') ||
        token.startsWith('--') ||
        token.startsWith('.') ||
        token.startsWith('^') ||
        token.startsWith('>') ||
        token.startsWith('<') ||
        token.startsWith('$') ||
        token.startsWith('«') ||
        /^[0-9a-f]{7,40}$/i.test(token) ||
        /^\d+(\.\d+)*$/.test(token) ||
        /^[A-Z][A-Z0-9_-]+$/.test(token) ||
        /\.(js|cs|md|adoc|puml|svg|png|json|yaml|yml|csproj|cshtml|sql|jar|txt|log)$/i.test(token) ||
        /:/.test(token)
      ) {
        continue;
      }

      const memberMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?$/);
      if (memberMatch) {
        const [, left, right] = memberMatch;
        if (!NON_CODE_TERMS.has(left) && /^[A-Z]/.test(left)) {
          found.push({ doc: docLabel, line: idx + 1, symbol: left, raw: token });
        }
        if (!NON_CODE_TERMS.has(right)) {
          found.push({ doc: docLabel, line: idx + 1, symbol: right, raw: token });
        }
        continue;
      }

      const callMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\([^)]*\)$/);
      if (callMatch) {
        const fn = callMatch[1];
        if (!NON_CODE_TERMS.has(fn)) {
          found.push({ doc: docLabel, line: idx + 1, symbol: fn, raw: token });
        }
        continue;
      }

      if (/^[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*$/.test(token) && !NON_CODE_TERMS.has(token)) {
        const hasTwoHumps = /[a-z][A-Z]/.test(token) || /^I[A-Z][a-z]/.test(token);
        const isKnownSingleModel = /^(User|Admin|Buyer|Seller|Category|Product|Cart|Order|Address|Login|Roles|Audit|Account)$/.test(token);
        if (hasTwoHumps || isKnownSingleModel) {
          found.push({ doc: docLabel, line: idx + 1, symbol: token, raw: token });
        }
        continue;
      }

      if (/^[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(token) && !NON_CODE_TERMS.has(token)) {
        found.push({ doc: docLabel, line: idx + 1, symbol: token, raw: token });
      }
    }
  });

  return found;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDefaultTargets({ requireDiagramTraceHeaders = true } = {}) {
  const docs = [
    path.join(__dirname, 'BASELINE.md'),
    path.join(DIAGRAMS_DIR, 'PLAN_DIAGRAMAS.md')
  ];

  if (fs.existsSync(ASCIIDOC_DIR)) {
    const adocs = fs.readdirSync(ASCIIDOC_DIR)
      .filter((f) => f.endsWith('.adoc'))
      .sort()
      .map((f) => path.join(ASCIIDOC_DIR, f));
    docs.push(...adocs);
  }

  const pumlFiles = [];
  if (fs.existsSync(DIAGRAMS_DIR)) {
    const pmls = fs.readdirSync(DIAGRAMS_DIR)
      .filter((f) => f.endsWith('.puml') && !f.startsWith('_'))
      .sort()
      .map((f) => path.join(DIAGRAMS_DIR, f));
    pumlFiles.push(...pmls);
  }

  return { docs, pumlFiles, requireDiagramTraceHeaders };
}

function runVerification(options = {}) {
  const { docs, pumlFiles, requireDiagramTraceHeaders } = getDefaultTargets(options);
  const allFiles = [
    ...listAllRepoFiles(BACKEND_ROOT, 'backendnode'),
    ...listAllRepoFiles(FRONTEND_ROOT, 'frontendnet')
  ];
  const corpus = loadCodeCorpus(allFiles);

  const missingPaths = [];
  const missingSymbols = [];
  const missingTraceHeaders = [];
  let checkedPaths = 0;
  let checkedSymbols = 0;

  function validatePathEntry(entry) {
    let lineRange = null;
    let pathWithoutLine = entry.raw;
    const lineMatch = entry.raw.match(/:(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      lineRange = { start: Number(lineMatch[1]), end: lineMatch[2] ? Number(lineMatch[2]) : Number(lineMatch[1]) };
      pathWithoutLine = entry.raw.slice(0, lineMatch.index);
    }

    const expandedList = expandBraces(pathWithoutLine);
    for (const candidate of expandedList) {
      checkedPaths += 1;
      const normalized = candidate.replace(/\/+$/, '');
      if (normalized.includes('*') || normalized.includes('?')) {
        const re = globToRegex(normalized);
        if (!allFiles.some((f) => re.test(f.rel))) {
          missingPaths.push({
            doc: entry.doc,
            line: entry.line,
            item: candidate,
            reason: 'El comodín no coincide con ningún archivo real'
          });
        }
        continue;
      }

      const absPath = normalized.startsWith('backendnode/')
        ? path.join(BACKEND_ROOT, normalized.slice('backendnode/'.length))
        : path.join(FRONTEND_ROOT, normalized.slice('frontendnet/'.length));

      if (!fs.existsSync(absPath)) {
        missingPaths.push({
          doc: entry.doc,
          line: entry.line,
          item: candidate,
          reason: 'Ruta no existe en el repositorio'
        });
        continue;
      }

      if (lineRange && fs.statSync(absPath).isFile()) {
        const totalLines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/).length;
        if (lineRange.start > totalLines) {
          missingPaths.push({
            doc: entry.doc,
            line: entry.line,
            item: `${candidate}:${lineRange.start}`,
            reason: `Línea ${lineRange.start} excede el total del archivo (${totalLines} líneas)`
          });
        }
      }
    }
  }

  for (const docPath of docs) {
    if (!fs.existsSync(docPath)) {
      missingPaths.push({ doc: path.basename(docPath), line: 0, item: docPath, reason: 'Documento no existe' });
      continue;
    }
    const content = fs.readFileSync(docPath, 'utf8');
    const docLabel = path.basename(docPath);

    for (const p of extractPathsFromText(docLabel, content)) {
      validatePathEntry(p);
    }

    const seenInDoc = new Set();
    for (const s of extractSymbolsFromDoc(docLabel, content)) {
      const key = `${s.doc}:${s.symbol}`;
      if (seenInDoc.has(key)) continue;
      seenInDoc.add(key);
      checkedSymbols += 1;
      const symRegex = new RegExp(`\\b${escapeRegExp(s.symbol)}\\b`);
      if (!symRegex.test(corpus)) {
        missingSymbols.push({
          doc: s.doc,
          line: s.line,
          item: s.symbol,
          raw: s.raw,
          reason: 'Símbolo no encontrado en el código fuente de backendnode/ ni frontendnet/'
        });
      }
    }
  }

  for (const pumlPath of pumlFiles) {
    const pumlName = path.basename(pumlPath);
    const content = fs.readFileSync(pumlPath, 'utf8');
    const { hasTraceHeader, paths } = extractTraceHeaderPaths(pumlName, content);
    if (requireDiagramTraceHeaders && !hasTraceHeader) {
      missingTraceHeaders.push({ doc: pumlName, reason: 'Falta cabecera obligatoria `\' TRACE: ...`' });
    }
    for (const p of paths) {
      validatePathEntry(p);
    }
  }

  return {
    checkedDocs: docs.length,
    checkedDiagrams: pumlFiles.length,
    checkedPaths,
    checkedSymbols,
    missingPaths,
    missingSymbols,
    missingTraceHeaders
  };
}

function main() {
  const skipDiagramTraces = process.argv.includes('--skip-diagram-headers');
  const result = runVerification({ requireDiagramTraceHeaders: !skipDiagramTraces });
  const totalMissing =
    result.missingPaths.length +
    result.missingSymbols.length +
    result.missingTraceHeaders.length;

  console.log(
    `[verify-traces] Docs: ${result.checkedDocs} | Diagramas (.puml): ${result.checkedDiagrams} | ` +
    `Rutas comprobadas: ${result.checkedPaths} | Símbolos comprobados: ${result.checkedSymbols}`
  );
  console.log(`[verify-traces] Faltantes totales: ${totalMissing}`);

  for (const m of result.missingTraceHeaders) {
    console.error(`  [TRACE HEADER] ${m.doc}: ${m.reason}`);
  }
  for (const m of result.missingPaths) {
    console.error(`  [RUTA] ${m.doc}:${m.line} -> ${m.item} (${m.reason})`);
  }
  for (const m of result.missingSymbols) {
    console.error(`  [SÍMBOLO] ${m.doc}:${m.line} -> ${m.item} (en \`${m.raw}\`: ${m.reason})`);
  }

  if (totalMissing > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('[verify-traces] OK: 0 rutas faltantes, 0 símbolos faltantes y cabeceras TRACE válidas.');
}

if (require.main === module) {
  main();
}

module.exports = { runVerification, expandBraces };
