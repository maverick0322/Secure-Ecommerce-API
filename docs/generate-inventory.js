#!/usr/bin/env node
'use strict';

/**
 * Generador determinista de la sección de inventario para docs/BASELINE.md.
 *
 * Lee únicamente:
 *  - Sistema de archivos de backendnode/ y frontendnet/ (sin tocar .env ni .secrets/)
 *  - Metadatos Git (rev-parse, log -1, branch)
 *  - package.json / package-lock.json y *.csproj
 *  - compose*.yaml y Dockerfile
 *
 * Uso:
 *   node docs/generate-inventory.js                  # Imprime el inventario Markdown en stdout
 *   node docs/generate-inventory.js --update-baseline # Reemplaza el bloque AUTO-INVENTORY en docs/BASELINE.md
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = path.join(WORKSPACE_ROOT, 'frontendnet');
const BASELINE_PATH = path.join(__dirname, 'BASELINE.md');

const BEGIN_MARKER = '<!-- BEGIN:AUTO-INVENTORY -->';
const END_MARKER = '<!-- END:AUTO-INVENTORY -->';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.secrets', 'coverage', '.vs']);

function runGit(repoDir, args) {
  const res = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    return null;
  }
  return (res.stdout || '').trim();
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walkFiles(dirPath, predicate = () => true) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        const fullPath = path.join(current, entry.name);
        if (predicate(fullPath, entry.name)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dirPath);
  return results.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function extractCSharpTypes(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const types = [];
  const regex = /^\s*(?:public|internal|private|protected)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+)*(?:class|interface|record|enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (const line of lines) {
    const m = line.match(regex);
    if (m && !types.includes(m[1])) {
      types.push(m[1]);
    }
  }
  return types;
}

function extractJsSymbols(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const symbols = [];
  const add = (name) => {
    if (name && !symbols.includes(name) && !['module', 'exports', 'default', 'sequelize', 'DataTypes'].includes(name)) {
      symbols.push(name);
    }
  };

  // Sequelize modelName or class declarations
  const modelNameMatch = content.match(/modelName\s*:\s*['"]([A-Za-z0-9_]+)['"]/);
  if (modelNameMatch) add(modelNameMatch[1]);

  const classRegex = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m = classRegex.exec(content);
  while (m !== null) {
    add(m[1]);
    m = classRegex.exec(content);
  }

  // Top-level keys in module.exports = { ... } (respecting nested braces/parens)
  const expIdx = content.lastIndexOf('module.exports');
  if (expIdx !== -1) {
    const afterEq = content.slice(expIdx).match(/^module\.exports\s*=\s*\{/);
    if (afterEq) {
      const start = expIdx + afterEq[0].length;
      let depth = 1;
      let paren = 0;
      let tokenStart = start;
      for (let i = start; i < content.length && depth > 0; i += 1) {
        const ch = content[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const seg = content.slice(tokenStart, i).trim();
            const km = seg.match(/^(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*[:(]|$)/);
            if (km) add(km[1]);
          }
        } else if (ch === '(') paren += 1;
        else if (ch === ')') paren -= 1;
        else if (ch === ',' && depth === 1 && paren === 0) {
          const seg = content.slice(tokenStart, i).trim();
          const km = seg.match(/^(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*[:(]|$)/);
          if (km) add(km[1]);
          tokenStart = i + 1;
        }
      }
    }
  }

  // exports.foo = or module.exports.foo =
  const propExportRegex = /(?:module\.)?exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
  m = propExportRegex.exec(content);
  while (m !== null) {
    add(m[1]);
    m = propExportRegex.exec(content);
  }

  return symbols;
}

function parseComposeFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const services = [];
  let inServices = false;
  let currentService = null;
  let inPorts = false;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNum = idx + 1;
    const raw = lines[idx];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^services:\s*$/.test(raw)) {
      inServices = true;
      currentService = null;
      inPorts = false;
      continue;
    }

    if (inServices && /^[a-zA-Z0-9_-]+:\s*$/.test(raw)) {
      inServices = false;
      currentService = null;
      inPorts = false;
      continue;
    }

    if (!inServices) continue;

    const svcMatch = raw.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (svcMatch) {
      currentService = { name: svcMatch[1], line: lineNum, image: null, imageLine: null, build: false, ports: [] };
      services.push(currentService);
      inPorts = false;
      continue;
    }

    if (!currentService) continue;

    const imgMatch = raw.match(/^    image:\s*(.+?)\s*$/);
    if (imgMatch) {
      currentService.image = imgMatch[1].replace(/^['"]|['"]$/g, '');
      currentService.imageLine = lineNum;
      inPorts = false;
      continue;
    }

    if (/^    build:/.test(raw)) {
      currentService.build = true;
      inPorts = false;
      continue;
    }

    if (/^    ports:\s*$/.test(raw)) {
      inPorts = true;
      continue;
    }

    if (inPorts) {
      const portMatch = raw.match(/^      -\s*(.+?)\s*$/);
      if (portMatch) {
        currentService.ports.push({ value: portMatch[1].replace(/^['"]|['"]$/g, ''), line: lineNum });
      } else if (/^    [a-zA-Z0-9_-]+:/.test(raw)) {
        inPorts = false;
      }
    }
  }

  return services;
}

function parseDockerfileBaseImages(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const froms = [];
  lines.forEach((line, idx) => {
    const m = line.match(/^\s*FROM\s+(.+?)\s*$/i);
    if (m) froms.push({ line: idx + 1, value: m[1] });
  });
  return froms;
}

function parseCsproj(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const tfmMatch = xml.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
  const packages = [];
  const pkgRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/>/g;
  let m = pkgRegex.exec(xml);
  while (m !== null) {
    packages.push({ name: m[1], version: m[2] });
    m = pkgRegex.exec(xml);
  }
  return {
    targetFramework: tfmMatch ? tfmMatch[1] : 'NO_VERIFICABLE',
    packages
  };
}

function formatInventory() {
  const lines = [];

  // 1. Git hashes
  const beMainHash = runGit(BACKEND_ROOT, ['rev-parse', 'main']) || 'NO_VERIFICABLE';
  const beMainDate = runGit(BACKEND_ROOT, ['log', '-1', '--format=%ci', 'main']) || 'NO_VERIFICABLE';
  const beMainAuthor = runGit(BACKEND_ROOT, ['log', '-1', '--format=%an', 'main']) || 'NO_VERIFICABLE';
  const beMainSubject = runGit(BACKEND_ROOT, ['log', '-1', '--format=%s', 'main']) || 'NO_VERIFICABLE';
  const beDb6Hash = runGit(BACKEND_ROOT, ['rev-parse', 'db6e039']) || 'NO_VERIFICABLE';
  const beDb6Subject = runGit(BACKEND_ROOT, ['log', '-1', '--format=%s', 'db6e039']) || 'NO_VERIFICABLE';
  const beBranch = runGit(BACKEND_ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'NO_VERIFICABLE';

  const feMainHash = runGit(FRONTEND_ROOT, ['rev-parse', 'main']) || 'NO_VERIFICABLE';
  const feMainDate = runGit(FRONTEND_ROOT, ['log', '-1', '--format=%ci', 'main']) || 'NO_VERIFICABLE';
  const feMainAuthor = runGit(FRONTEND_ROOT, ['log', '-1', '--format=%an', 'main']) || 'NO_VERIFICABLE';
  const feMainSubject = runGit(FRONTEND_ROOT, ['log', '-1', '--format=%s', 'main']) || 'NO_VERIFICABLE';
  const feBranch = runGit(FRONTEND_ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'NO_VERIFICABLE';

  lines.push('## 1. Identificación de Repositorios y Hashes Git (`main`)');
  lines.push('');
  lines.push('| Atributo | `backendnode` | `frontendnet` |');
  lines.push('|---|---|---|');
  lines.push(`| **Rama activa actual** | \`${beBranch}\` (rebasada sobre \`main\`) | \`${feBranch}\` |`);
  lines.push(`| **Hash completo de \`main\`** | \`${beMainHash}\` | \`${feMainHash}\` |`);
  lines.push(`| **Fecha de \`main\`** | \`${beMainDate}\` | \`${feMainDate}\` |`);
  lines.push(`| **Autor de \`main\`** | ${beMainAuthor} | ${feMainAuthor} |`);
  lines.push(`| **Mensaje de \`main\`** | ${beMainSubject} | ${feMainSubject} |`);
  lines.push(`| **Hash completo de \`db6e039\` (integrado en \`main\`)** | \`${beDb6Hash}\` (${beDb6Subject}) | N/A |`);
  lines.push('');

  // 2. Compose & Dockerfile images and ports
  lines.push('## 2. Imágenes de Contenedores y Puertos (`compose.yaml`, `compose.dev.yaml`, `Dockerfile`)');
  lines.push('');
  const composeFiles = fs.readdirSync(BACKEND_ROOT)
    .filter((f) => /^compose.*\.ya?ml$/i.test(f))
    .sort();

  lines.push('| Archivo | Servicio | Imagen / Build (`archivo:línea`) | Puertos Declarados (`archivo:línea`) |');
  lines.push('|---|---|---|---|');
  for (const cf of composeFiles) {
    const services = parseComposeFile(path.join(BACKEND_ROOT, cf));
    for (const svc of services) {
      const imgCell = svc.image
        ? `\`${svc.image}\` (\`backendnode/${cf}:${svc.imageLine}\`)`
        : svc.build
          ? `Build local \`Dockerfile\` (\`backendnode/${cf}:${svc.line}\`)`
          : `*(override en \`backendnode/${cf}:${svc.line}\`)*`;
      const portsCell = svc.ports.length > 0
        ? svc.ports.map((p) => `\`${p.value}\` (\`backendnode/${cf}:${p.line}\`)`).join(', ')
        : 'Sin puertos publicados al host';
      lines.push(`| \`backendnode/${cf}\` | \`${svc.name}\` | ${imgCell} | ${portsCell} |`);
    }
  }
  const dockerFroms = parseDockerfileBaseImages(path.join(BACKEND_ROOT, 'Dockerfile'));
  if (dockerFroms.length > 0) {
    lines.push(`| \`backendnode/Dockerfile\` | \`app\` (multi-stage) | ${dockerFroms.map((f) => `\`FROM ${f.value}\` (\`backendnode/Dockerfile:${f.line}\`)`).join('; ')} | \`EXPOSE 3000\` |`);
  }
  lines.push('');

  // 3. Dependencies
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package-lock.json'), 'utf8'));
  const lockPackages = lock.packages || {};

  lines.push('## 3. Dependencias Verificadas (`package.json`, `package-lock.json` y `*.csproj`)');
  lines.push('');
  lines.push(`- **\`backendnode/package.json\` \`engines.node\`:** \`${pkg.engines?.node || 'NO_VERIFICABLE'}\``);
  lines.push(`- **Producción (\`dependencies\`):** **${Object.keys(pkg.dependencies || {}).length}** paquetes`);
  lines.push(`- **Desarrollo (\`devDependencies\`):** **${Object.keys(pkg.devDependencies || {}).length}** paquetes`);
  lines.push('');
  lines.push('| Tipo | Paquete | Versión en `backendnode/package.json` | Versión Resuelta en `backendnode/package-lock.json` |');
  lines.push('|---|---|---|---|');

  for (const [depName, depRange] of Object.entries(pkg.dependencies || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const resolved = lockPackages[`node_modules/${depName}`]?.version || 'NO_VERIFICABLE';
    lines.push(`| \`dependencies\` | \`${depName}\` | \`${depRange}\` | \`${resolved}\` |`);
  }
  for (const [depName, depRange] of Object.entries(pkg.devDependencies || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const resolved = lockPackages[`node_modules/${depName}`]?.version || 'NO_VERIFICABLE';
    lines.push(`| \`devDependencies\` | \`${depName}\` | \`${depRange}\` | \`${resolved}\` |`);
  }
  lines.push('');

  const feAppCsproj = parseCsproj(path.join(FRONTEND_ROOT, 'frontendnet.csproj'));
  const feTestCsproj = parseCsproj(path.join(FRONTEND_ROOT, 'FrontendNet.Tests', 'FrontendNet.Tests.csproj'));
  lines.push('### 3.1 Proyectos y Paquetes NuGet de `frontendnet`');
  lines.push('');
  lines.push(`- **\`frontendnet/frontendnet.csproj\`:** \`TargetFramework = ${feAppCsproj.targetFramework}\`, paquetes NuGet directos: **${feAppCsproj.packages.length}**`);
  lines.push(`- **\`frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj\`:** \`TargetFramework = ${feTestCsproj.targetFramework}\`, paquetes NuGet: ${feTestCsproj.packages.map((p) => `\`${p.name} ${p.version}\``).join(', ')}`);
  lines.push('');

  // 4. Migrations and Seeders
  const allMigrationFiles = walkFiles(path.join(BACKEND_ROOT, 'migrations'), (p) => p.endsWith('.js'));
  const realMigrations = allMigrationFiles.filter((p) => !toPosix(path.relative(BACKEND_ROOT, p)).startsWith('migrations/support/'));
  const supportMigrationFiles = allMigrationFiles.filter((p) => toPosix(path.relative(BACKEND_ROOT, p)).startsWith('migrations/support/'));
  const seederFiles = walkFiles(path.join(BACKEND_ROOT, 'seeders'), (p) => p.endsWith('.js'));

  lines.push('## 4. Migraciones y Seeders de `backendnode`');
  lines.push('');
  lines.push(`- **Migraciones ejecutables (\`backendnode/migrations/\` + \`backendnode/migrations/cutover/\`):** **${realMigrations.length}**`);
  for (const mf of realMigrations) {
    lines.push(`  - \`backendnode/${toPosix(path.relative(BACKEND_ROOT, mf))}\``);
  }
  if (supportMigrationFiles.length > 0) {
    lines.push(`- **Módulos auxiliares bajo \`backendnode/migrations/support/\` (no son migraciones):** **${supportMigrationFiles.length}**`);
    for (const sf of supportMigrationFiles) {
      lines.push(`  - \`backendnode/${toPosix(path.relative(BACKEND_ROOT, sf))}\``);
    }
  }
  lines.push(`- **Seeders (\`backendnode/seeders/\`):** **${seederFiles.length}**`);
  for (const sf of seederFiles) {
    lines.push(`  - \`backendnode/${toPosix(path.relative(BACKEND_ROOT, sf))}\``);
  }
  lines.push('');

  // 5. Inventory of backendnode source files
  lines.push('## 5. Inventario de Código de `backendnode`');
  lines.push('');
  const beGroups = [
    { label: 'Controllers (`backendnode/controllers/`)', dir: 'controllers' },
    { label: 'Middlewares (`backendnode/middlewares/`)', dir: 'middlewares' },
    { label: 'Services (`backendnode/services/`)', dir: 'services' },
    { label: 'Models (`backendnode/models/`)', dir: 'models' },
    { label: 'Routes (`backendnode/routes/`)', dir: 'routes' },
    { label: 'Validators (`backendnode/validators/`)', dir: 'validators' }
  ];

  for (const grp of beGroups) {
    const files = walkFiles(path.join(BACKEND_ROOT, grp.dir), (p) => p.endsWith('.js'));
    lines.push(`### 5.${beGroups.indexOf(grp) + 1} ${grp.label} — ${files.length} archivos`);
    lines.push('');
    lines.push('| Archivo | Símbolos / Exports Principales |');
    lines.push('|---|---|');
    for (const f of files) {
      const rel = `backendnode/${toPosix(path.relative(BACKEND_ROOT, f))}`;
      const syms = extractJsSymbols(f).slice(0, 8);
      lines.push(`| \`${rel}\` | ${syms.length > 0 ? syms.map((s) => `\`${s}\``).join(', ') : '*(router / factory)*'} |`);
    }
    lines.push('');
  }

  // 6. Inventory of frontendnet source files
  lines.push('## 6. Inventario de Código de `frontendnet`');
  lines.push('');
  const feGroups = [
    { label: 'Controllers (`frontendnet/Controllers/`)', dir: 'Controllers' },
    { label: 'Middlewares (`frontendnet/Middlewares/`)', dir: 'Middlewares' },
    { label: 'Services (`frontendnet/Services/`)', dir: 'Services' },
    { label: 'Models (`frontendnet/Models/`)', dir: 'Models' },
    { label: 'Helpers (`frontendnet/Helpers/`)', dir: 'Helpers' },
    { label: 'Validation (`frontendnet/Validation/`)', dir: 'Validation' },
    { label: 'Extensions (`frontendnet/Extensions/`)', dir: 'Extensions' },
    { label: 'ViewComponents (`frontendnet/ViewComponents/`)', dir: 'ViewComponents' }
  ];

  for (const grp of feGroups) {
    const files = walkFiles(path.join(FRONTEND_ROOT, grp.dir), (p) => p.endsWith('.cs'));
    lines.push(`### 6.${feGroups.indexOf(grp) + 1} ${grp.label} — ${files.length} archivos`);
    lines.push('');
    lines.push('| Archivo | Clases / Interfaces / Tipos C# |');
    lines.push('|---|---|');
    for (const f of files) {
      const rel = `frontendnet/${toPosix(path.relative(FRONTEND_ROOT, f))}`;
      const types = extractCSharpTypes(f);
      lines.push(`| \`${rel}\` | ${types.length > 0 ? types.map((t) => `\`${t}\``).join(', ') : '*(sin tipo declarado)*'} |`);
    }
    lines.push('');
  }

  // Views in frontendnet
  const feViews = walkFiles(path.join(FRONTEND_ROOT, 'Views'), (p) => p.endsWith('.cshtml'));
  const viewsByDir = new Map();
  for (const vf of feViews) {
    const rel = toPosix(path.relative(path.join(FRONTEND_ROOT, 'Views'), vf));
    const folder = path.posix.dirname(rel) === '.' ? '(raíz Views)' : path.posix.dirname(rel);
    if (!viewsByDir.has(folder)) viewsByDir.set(folder, []);
    viewsByDir.get(folder).push(path.posix.basename(rel));
  }

  lines.push(`### 6.9 Views (\`frontendnet/Views/\`) — ${feViews.length} vistas Razor (\`.cshtml\`)`);
  lines.push('');
  lines.push('| Carpeta | Cantidad | Archivos `.cshtml` |');
  lines.push('|---|---:|---|');
  for (const [folder, items] of [...viewsByDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| \`frontendnet/Views/${folder === '(raíz Views)' ? '' : `${folder}/`}\` | ${items.length} | ${items.map((i) => `\`${i}\``).join(', ')} |`);
  }
  lines.push('');

  // Tests in frontendnet
  const feTests = walkFiles(path.join(FRONTEND_ROOT, 'FrontendNet.Tests'), (p) => p.endsWith('.cs'));
  lines.push(`### 6.10 Pruebas de \`frontendnet\` (\`frontendnet/FrontendNet.Tests/\`) — ${feTests.length} archivos \`.cs\``);
  lines.push('');
  lines.push('| Archivo | Clases de Prueba / Soporte |');
  lines.push('|---|---|');
  for (const tf of feTests) {
    const rel = `frontendnet/${toPosix(path.relative(FRONTEND_ROOT, tf))}`;
    const types = extractCSharpTypes(tf);
    lines.push(`| \`${rel}\` | ${types.map((t) => `\`${t}\``).join(', ')} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function updateBaseline(inventoryMarkdown) {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`No existe ${BASELINE_PATH}`);
  }
  const current = fs.readFileSync(BASELINE_PATH, 'utf8');
  const startIdx = current.indexOf(BEGIN_MARKER);
  const endIdx = current.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`No se encontraron los marcadores ${BEGIN_MARKER} y ${END_MARKER} en ${BASELINE_PATH}`);
  }
  const updated =
    current.slice(0, startIdx + BEGIN_MARKER.length) +
    '\n' +
    inventoryMarkdown.trimEnd() +
    '\n' +
    current.slice(endIdx);
  fs.writeFileSync(BASELINE_PATH, updated, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const md = formatInventory();
  if (args.includes('--update-baseline')) {
    updateBaseline(md);
    console.log(`Inventario actualizado en ${BASELINE_PATH}`);
  } else {
    process.stdout.write(md);
  }
}

if (require.main === module) {
  main();
}

module.exports = { formatInventory, updateBaseline };
