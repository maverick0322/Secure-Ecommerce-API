#!/usr/bin/env node
'use strict';

/**
 * Verificador automático de trazabilidad documental (docs/verify-traces.js).
 *
 * Extrae de docs/BASELINE.md y docs/diagrams/PLAN_DIAGRAMAS.md:
 *  1. Toda ruta citada que empiece por `backendnode/` o `frontendnet/`
 *     (con expansión de llaves `{a,b}` y comodines `*` / `**`, y validación opcional de `:línea`).
 *  2. Toda clase o método citado entre comillas invertidas (`...`).
 *
 * Comprueba que cada archivo/comodín existe en el sistema de archivos real y que cada
 * símbolo (clase o método) aparece en el código fuente de backendnode/ o frontendnet/.
 *
 * Sale con código 1 y lista todos los faltantes si encuentra al menos uno; código 0 si pasa con 0 faltantes.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = path.join(WORKSPACE_ROOT, 'frontendnet');

const DEFAULT_DOCS = [
  path.join(__dirname, 'BASELINE.md'),
  path.join(__dirname, 'diagrams', 'PLAN_DIAGRAMAS.md')
];

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.secrets', 'coverage', 'docs', '.vs']);
const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.cs', '.json', '.yaml', '.yml', '.csproj', '.cshtml', '.sql']);

// Tokens entre comillas invertidas que son términos de estándar/protocolo/herramienta y NO símbolos de clase/método del repo
const NON_CODE_TERMS = new Set([
  // Frameworks, runtimes, tools, protocols, standards
  'Node', 'Express', 'Sequelize', 'MySQL', 'Redis', 'Cloudinary', 'Gmail', 'Docker', 'PlantUML',
  'OpenJDK', 'Temurin', 'VSTest', 'SonarCloud', 'Cloudflare', 'Turnstile', 'Swagger', 'OpenAPI',
  'Kestrel', 'Razor', 'NuGet', 'GitHub', 'Actions', 'Windows', 'Linux', 'PowerShell', 'UTF',
  'PascalCase', 'camelCase', 'Bearer', 'Basic', 'SameSite', 'HttpOnly', 'SecurePolicy', 'Always',
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
  'ConcurrentDictionary', 'ClaimTypes', 'IHostEnvironment', 'Attribute', 'Exception',
  // Domain actor names / Spanish prose terms in diagrams
  'Visitante', 'UsuarioAutenticado', 'Comprador', 'Vendedor', 'Administrador',
  // UML / PlantUML keywords
  'startuml', 'enduml', 'include', 'extend', 'actor', 'usecase', 'class', 'interface', 'enum',
  'component', 'node', 'artifact', 'database', 'participant', 'boundary', 'control', 'entity',
  'table', 'alt', 'opt', 'loop', 'break', 'ref', 'skinparam', 'defaultFontName', 'AttributeFontName',
  'Segoe UI', 'Cascadia Mono', 'Liberation Sans', 'Helvetica Neue', 'Arial', 'Consolas',
  // Generic SQL / JSON / HTTP concepts
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'ESCAPE', 'LIKE', 'NULL', 'NOT NULL',
  'DECIMAL', 'VARCHAR', 'CHAR', 'TEXT', 'INT', 'BIGINT', 'UNSIGNED', 'DATETIME', 'ENUM', 'JSON',
  'PK', 'FK', 'UK', 'IDX', 'UNIQUE', 'GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'HEAD'
]);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Expande llaves `{a,b,c}` de forma recursiva en una ruta.
 */
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
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj' || entry.name === '.secrets') {
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
      // ignore unreadable
    }
  }
  return chunks.join('\n');
}

function extractPathsFromDoc(docPath) {
  const lines = fs.readFileSync(docPath, 'utf8').split(/\r?\n/);
  const found = [];
  // Matches backendnode/... or frontendnet/... including {a,b} and * and optional :line or :line-line
  const pathRegex = /\b((?:backendnode|frontendnet)\/(?:[A-Za-z0-9_.*\/-]|\{[A-Za-z0-9_.*\/,\s-]+\})+(?::\d+(?:-\d+)?)?)/g;

  lines.forEach((line, idx) => {
    // Skip file:/// URIs since those are markdown links already pointing to paths
    const sanitized = line.replace(/file:\/\/\/[^)\s]+/g, '');
    let m = pathRegex.exec(sanitized);
    while (m !== null) {
      let raw = m[1].replace(/[.,;:'")]+$/, '');
      // Skip explicit non-existent or negative-statement examples if followed by "(no existe)"
      found.push({ doc: path.basename(docPath), line: idx + 1, raw });
      m = pathRegex.exec(sanitized);
    }
  });
  return found;
}

function extractSymbolsFromDoc(docPath) {
  const lines = fs.readFileSync(docPath, 'utf8').split(/\r?\n/);
  const found = [];
  let inCodeFence = false;

  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) {
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
      // Ignore paths, URLs, HTTP routes, commands, env vars, hashes, dates, versions, numbers, file names
      if (
        token.includes('/') ||
        token.includes('\\') ||
        token.includes(' ') ||
        token.startsWith('--') ||
        token.startsWith('.') ||
        token.startsWith('^') ||
        token.startsWith('>') ||
        token.startsWith('<') ||
        token.startsWith('$') ||
        token.startsWith('«') ||
        /^[0-9a-f]{7,40}$/i.test(token) ||
        /^\d+(\.\d+)*$/.test(token) ||
        /^[A-Z][A-Z0-9_]+$/.test(token) ||
        /\.(js|cs|md|puml|svg|png|json|yaml|yml|csproj|cshtml|sql|jar|txt|log)$/i.test(token) ||
        /:/.test(token)
      ) {
        continue;
      }

      // Case A: Class.method or obj.method()
      const memberMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?$/);
      if (memberMatch) {
        const [, left, right] = memberMatch;
        if (!NON_CODE_TERMS.has(left) && /^[A-Z]/.test(left)) {
          found.push({ doc: path.basename(docPath), line: idx + 1, symbol: left, raw: token });
        }
        if (!NON_CODE_TERMS.has(right)) {
          found.push({ doc: path.basename(docPath), line: idx + 1, symbol: right, raw: token });
        }
        continue;
      }

      // Case B: methodCall()
      const callMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\([^)]*\)$/);
      if (callMatch) {
        const fn = callMatch[1];
        if (!NON_CODE_TERMS.has(fn)) {
          found.push({ doc: path.basename(docPath), line: idx + 1, symbol: fn, raw: token });
        }
        continue;
      }

      // Case C: PascalCase class/interface/enum name (e.g. OrdersController, SessionTokenManager, UserAddress)
      if (/^[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*$/.test(token) && !NON_CODE_TERMS.has(token)) {
        // Require at least two humps OR a known code suffix so plain capitalized Spanish words aren't misread
        const hasTwoHumps = /[a-z][A-Z]/.test(token) || /^I[A-Z][a-z]/.test(token);
        const isKnownSingleModel = /^(User|Admin|Buyer|Seller|Category|Product|Cart|Order|Address|Login|Roles|Audit|Account)$/.test(token);
        if (hasTwoHumps || isKnownSingleModel) {
          found.push({ doc: path.basename(docPath), line: idx + 1, symbol: token, raw: token });
        }
        continue;
      }

      // Case D: camelCase method/function/property identifier with at least one uppercase letter
      if (/^[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(token) && !NON_CODE_TERMS.has(token)) {
        found.push({ doc: path.basename(docPath), line: idx + 1, symbol: token, raw: token });
      }
    }
  });

  return found;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runVerification(docPaths = DEFAULT_DOCS) {
  const allFiles = [
    ...listAllRepoFiles(BACKEND_ROOT, 'backendnode'),
    ...listAllRepoFiles(FRONTEND_ROOT, 'frontendnet')
  ];
  const fileMap = new Map(allFiles.map((f) => [f.rel, f.fullPath]));
  const corpus = loadCodeCorpus(allFiles);

  const missingPaths = [];
  const missingSymbols = [];
  let checkedPaths = 0;
  let checkedSymbols = 0;

  for (const docPath of docPaths) {
    if (!fs.existsSync(docPath)) {
      missingPaths.push({ doc: path.basename(docPath), line: 0, item: docPath, reason: 'Documento no existe' });
      continue;
    }

    // 1. Verify paths
    const extractedPaths = extractPathsFromDoc(docPath);
    for (const entry of extractedPaths) {
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
          const matched = allFiles.some((f) => re.test(f.rel));
          if (!matched) {
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

    // 2. Verify symbols
    const extractedSymbols = extractSymbolsFromDoc(docPath);
    const seenInDoc = new Set();
    for (const entry of extractedSymbols) {
      const key = `${entry.doc}:${entry.symbol}`;
      if (seenInDoc.has(key)) continue;
      seenInDoc.add(key);
      checkedSymbols += 1;

      const symRegex = new RegExp(`\\b${escapeRegExp(entry.symbol)}\\b`);
      if (!symRegex.test(corpus)) {
        missingSymbols.push({
          doc: entry.doc,
          line: entry.line,
          item: entry.symbol,
          raw: entry.raw,
          reason: 'Símbolo no encontrado en el código fuente de backendnode/ ni frontendnet/'
        });
      }
    }
  }

  return {
    checkedPaths,
    checkedSymbols,
    missingPaths,
    missingSymbols
  };
}

function main() {
  const result = runVerification(DEFAULT_DOCS);
  const totalMissing = result.missingPaths.length + result.missingSymbols.length;

  console.log(`[verify-traces] Documentos verificados: ${DEFAULT_DOCS.map((d) => path.relative(BACKEND_ROOT, d)).join(', ')}`);
  console.log(`[verify-traces] Rutas comprobadas: ${result.checkedPaths} | Símbolos comprobados: ${result.checkedSymbols}`);
  console.log(`[verify-traces] Faltantes totales: ${totalMissing}`);

  if (result.missingPaths.length > 0) {
    console.error('\n--- RUTAS FALTANTES ---');
    for (const m of result.missingPaths) {
      console.error(`  [RUTA] ${m.doc}:${m.line} -> ${m.item} (${m.reason})`);
    }
  }

  if (result.missingSymbols.length > 0) {
    console.error('\n--- SÍMBOLOS FALTANTES ---');
    for (const m of result.missingSymbols) {
      console.error(`  [SÍMBOLO] ${m.doc}:${m.line} -> ${m.item} (en \`${m.raw}\`: ${m.reason})`);
    }
  }

  if (totalMissing > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('[verify-traces] OK: 0 rutas faltantes y 0 símbolos faltantes.');
}

if (require.main === module) {
  main();
}

module.exports = { runVerification, expandBraces };
