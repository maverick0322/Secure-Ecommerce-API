#!/usr/bin/env node
'use strict';

/**
 * Pipeline reproducible de validación y renderizado de diagramas PlantUML (.puml -> .svg / .png).
 *
 * Características:
 * 1. Fija la versión exacta de PlantUML a 1.2024.8 desde Maven Central y verifica su
 *    integridad criptográfica mediante hash SHA-256 antes de ejecutarlo.
 * 2. Resuelve directivas locales `!include _skin.puml` fijando el directorio de inclusión
 *    en `docs/diagrams/` y excluyendo archivos parciales que comienzan con `_` en corridas por lote.
 * 3. Soporta `--format svg|png|both` (PNG renderizado a 200 dpi mediante `-Sdpi=200`).
 * 4. Soporta archivos `.puml` con uno o múltiples bloques `@startuml [nombre] ... @enduml`
 *    (como `_muestra.puml`), validando y renderizando cada bloque individualmente.
 * 5. Falla con código de salida distinto de cero (exit 1) ante cualquier error de sintaxis
 *    en los archivos `.puml`, fallo de ejecución de Java/PlantUML o ausencia de salida válida.
 *
 * Uso:
 *   node docs/generate-diagrams.js                           # Valida sintaxis y genera SVGs en docs/asciidoc/assets/
 *   node docs/generate-diagrams.js --format svg|png|both     # Genera en formato SVG, PNG (200 dpi) o ambos
 *   node docs/generate-diagrams.js --check-only              # Solo valida sintaxis de todos los .puml (no escribe archivos)
 *   node docs/generate-diagrams.js --file <archivo>          # Procesa únicamente un archivo .puml específico
 *   node docs/generate-diagrams.js --out-dir <ruta>          # Define un directorio de salida alternativo
 *   node docs/generate-diagrams.js --help                    # Muestra esta ayuda
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLANTUML_VERSION = '1.2024.8';
const PLANTUML_JAR_URL = `https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar`;
const PLANTUML_JAR_SHA256 = '2e1f42a9879cd25236b5725ca7db25cb9996e8e37a0a1440b2eb559f259c54aa';
const PNG_DPI = 200;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_FORMATS = new Set(['svg', 'png', 'both']);

const DEFAULT_DIAGRAMS_DIR = path.join(__dirname, 'diagrams');
const DEFAULT_ASSETS_DIR = path.join(__dirname, 'asciidoc', 'assets');
const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'secure-ecommerce-plantuml');

function printHelp() {
  console.log(`
Uso: node docs/generate-diagrams.js [opciones]

Opciones:
  --check-only            Valida la sintaxis de los archivos .puml sin escribir archivos de salida.
  --format <svg|png|both> Formato de salida a generar (por defecto: svg; PNG se renderiza a ${PNG_DPI} dpi).
  --file <nombre.puml>    Procesa únicamente el archivo .puml indicado (relativo a docs/diagrams/).
  --out-dir <ruta>        Directorio destino para los archivos generados (por defecto: docs/asciidoc/assets/).
  --help, -h              Muestra esta ayuda y termina.

Variables de entorno opcionales:
  PLANTUML_JAR_PATH       Ruta personalizada para almacenar/leer plantuml-${PLANTUML_VERSION}.jar.
`.trim());
}

function parseArgs(argv) {
  const options = {
    checkOnly: false,
    format: 'svg',
    singleFile: null,
    outDir: DEFAULT_ASSETS_DIR,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check-only' || arg === '--dry-run') {
      options.checkOnly = true;
    } else if (arg === '--format') {
      const next = (argv[i + 1] || '').toLowerCase();
      if (!VALID_FORMATS.has(next)) {
        throw new Error('La opción --format requiere uno de los valores: svg, png, both.');
      }
      options.format = next;
      i += 1;
    } else if (arg.startsWith('--format=')) {
      const val = arg.slice('--format='.length).toLowerCase();
      if (!VALID_FORMATS.has(val)) {
        throw new Error('La opción --format requiere uno de los valores: svg, png, both.');
      }
      options.format = val;
    } else if (arg === '--file') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('La opción --file requiere el nombre de un archivo .puml.');
      }
      options.singleFile = next;
      i += 1;
    } else if (arg === '--out-dir') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('La opción --out-dir requiere una ruta de directorio.');
      }
      options.outDir = path.resolve(next);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Opción no reconocida: ${arg}. Use --help para ver las opciones disponibles.`);
    }
  }

  return options;
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tempPath = `${destPath}.tmp-${process.pid}`;
    const fileStream = fs.createWriteStream(tempPath);

    const request = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fileStream.close(() => {
          fs.rmSync(tempPath, { force: true });
          downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        });
        return;
      }

      if (res.statusCode !== 200) {
        fileStream.close(() => {
          fs.rmSync(tempPath, { force: true });
          reject(new Error(`Fallo al descargar PlantUML ${PLANTUML_VERSION} desde ${url}: HTTP ${res.statusCode}`));
        });
        return;
      }

      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => {
          fs.renameSync(tempPath, destPath);
          resolve(destPath);
        });
      });
    });

    request.on('error', (err) => {
      fileStream.close(() => {
        fs.rmSync(tempPath, { force: true });
        reject(err);
      });
    });
  });
}

async function ensurePinnedPlantUmlJar() {
  const candidatePaths = [
    process.env.PLANTUML_JAR_PATH,
    path.join(DEFAULT_CACHE_DIR, `plantuml-${PLANTUML_VERSION}.jar`),
    path.join(os.tmpdir(), `plantuml-${PLANTUML_VERSION}.jar`)
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const actualSha = computeFileSha256(candidate);
      if (actualSha === PLANTUML_JAR_SHA256) {
        return candidate;
      }
      fs.rmSync(candidate, { force: true });
    }
  }

  const targetJarPath = candidatePaths[0];
  console.log(`Descargando PlantUML v${PLANTUML_VERSION} fijado desde Maven Central...`);
  await downloadFile(PLANTUML_JAR_URL, targetJarPath);

  const downloadedSha = computeFileSha256(targetJarPath);
  if (downloadedSha !== PLANTUML_JAR_SHA256) {
    fs.rmSync(targetJarPath, { force: true });
    throw new Error(
      `Verificación SHA-256 fallida para plantuml-${PLANTUML_VERSION}.jar. ` +
      `Esperado: ${PLANTUML_JAR_SHA256}, obtenido: ${downloadedSha}`
    );
  }

  return targetJarPath;
}

function verifyJavaAvailable() {
  const res = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    throw new Error(
      'No se encontró un entorno de ejecución Java ("java") en el PATH. ' +
      'Instale Java JRE/JDK (8+) para ejecutar PlantUML de forma reproducible.'
    );
  }
}

function resolveDiagramFiles(diagramsDir, singleFile) {
  if (!fs.existsSync(diagramsDir)) {
    throw new Error(`No existe el directorio de diagramas: ${diagramsDir}`);
  }

  if (singleFile) {
    const fileName = path.basename(singleFile);
    const fullPath = path.join(diagramsDir, fileName);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`No existe el archivo de diagrama solicitado: ${fullPath}`);
    }
    return [fileName];
  }

  return fs.readdirSync(diagramsDir)
    .filter((file) => file.endsWith('.puml') && !file.startsWith('_'))
    .sort();
}

/**
 * Extrae uno o varios bloques `@startuml [id] ... @enduml` de un archivo `.puml`.
 */
function extractDiagramBlocks(content, fileName) {
  const defaultBaseName = fileName.replace(/\.puml$/i, '');
  const blockRegex = /@startuml(?:[ \t]+([^\r\n]+))?\r?\n([\s\S]*?)@enduml/g;
  const rawBlocks = [];
  let match = blockRegex.exec(content);

  while (match !== null) {
    const declaredName = (match[1] || '').trim().replace(/\.(svg|png|puml)$/i, '');
    rawBlocks.push({
      declaredName,
      source: match[0]
    });
    match = blockRegex.exec(content);
  }

  if (rawBlocks.length === 0) {
    return [];
  }

  if (rawBlocks.length === 1) {
    return [
      {
        baseName: rawBlocks[0].declaredName || defaultBaseName,
        source: rawBlocks[0].source
      }
    ];
  }

  return rawBlocks.map((block, index) => ({
    baseName: block.declaredName || `${defaultBaseName}_${String(index + 1).padStart(2, '0')}`,
    source: block.source
  }));
}

function renderBlockSvgBuffer(jarPath, diagramsDir, blockSource) {
  const args = [
    '-Djava.awt.headless=true',
    `-Dplantuml.include.path=${diagramsDir}`,
    '-jar',
    jarPath,
    '-charset',
    'UTF-8',
    '-tsvg',
    '-failfast2',
    '-pipe'
  ];

  const res = spawnSync('java', args, {
    cwd: diagramsDir,
    input: blockSource,
    encoding: 'utf8',
    maxBuffer: 25 * 1024 * 1024
  });

  if (res.error) {
    return { ok: false, details: res.error.message };
  }

  const svgOutput = res.stdout || '';
  if (res.status !== 0 || !svgOutput.includes('<svg') || svgOutput.includes('>Syntax Error?</text>')) {
    const errText = (res.stderr || '').trim();
    return {
      ok: false,
      details: errText || `PlantUML detectó un error de sintaxis (código ${res.status})`
    };
  }

  return { ok: true, svgContent: svgOutput };
}

function renderBlockPngBuffer(jarPath, diagramsDir, blockSource, dpi = PNG_DPI) {
  const args = [
    '-Djava.awt.headless=true',
    `-Dplantuml.include.path=${diagramsDir}`,
    '-jar',
    jarPath,
    '-charset',
    'UTF-8',
    '-tpng',
    `-Sdpi=${dpi}`,
    '-failfast2',
    '-pipe'
  ];

  const res = spawnSync('java', args, {
    cwd: diagramsDir,
    input: Buffer.from(blockSource, 'utf8'),
    maxBuffer: 40 * 1024 * 1024
  });

  if (res.error) {
    return { ok: false, details: res.error.message };
  }

  const pngBuffer = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '');
  const hasPngSignature =
    pngBuffer.length > 24 && pngBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

  if (res.status !== 0 || !hasPngSignature) {
    const errText = Buffer.isBuffer(res.stderr)
      ? res.stderr.toString('utf8').trim()
      : String(res.stderr || '').trim();
    return {
      ok: false,
      details: errText || `PlantUML falló al generar PNG a ${dpi} dpi (código ${res.status})`
    };
  }

  return { ok: true, pngBuffer };
}

function checkDiagramSyntax(jarPath, diagramsDir, fileName) {
  const fullPath = path.join(diagramsDir, fileName);
  const content = fs.readFileSync(fullPath, 'utf8');

  if (!content.includes('@startuml') || !content.includes('@enduml')) {
    return {
      ok: false,
      details: 'El archivo debe contener los delimitadores @startuml y @enduml.'
    };
  }

  const blocks = extractDiagramBlocks(content, fileName);
  if (blocks.length === 0) {
    return {
      ok: false,
      details: 'No se encontraron bloques @startuml ... @enduml válidos.'
    };
  }

  const renderedBlocks = [];
  for (const block of blocks) {
    const svgCheck = renderBlockSvgBuffer(jarPath, diagramsDir, block.source);
    if (!svgCheck.ok) {
      return {
        ok: false,
        details: `[bloque ${block.baseName}] ${svgCheck.details}`
      };
    }
    renderedBlocks.push({
      baseName: block.baseName,
      source: block.source,
      svgContent: svgCheck.svgContent
    });
  }

  return {
    ok: true,
    svgContent: renderedBlocks[0].svgContent,
    blocks: renderedBlocks
  };
}

function renderDiagramOutputs(jarPath, diagramsDir, outDir, fileName, format = 'svg', precheckedSyntax = null) {
  const check = precheckedSyntax || checkDiagramSyntax(jarPath, diagramsDir, fileName);
  if (!check.ok) {
    return check;
  }

  const wantSvg = format === 'svg' || format === 'both';
  const wantPng = format === 'png' || format === 'both';
  fs.mkdirSync(outDir, { recursive: true });

  const outputs = [];
  for (const block of check.blocks) {
    if (wantSvg) {
      const svgPath = path.join(outDir, `${block.baseName}.svg`);
      fs.writeFileSync(svgPath, block.svgContent, 'utf8');
      outputs.push({ format: 'SVG', baseName: block.baseName, outputPath: svgPath });
    }

    if (wantPng) {
      const pngRes = renderBlockPngBuffer(jarPath, diagramsDir, block.source, PNG_DPI);
      if (!pngRes.ok) {
        return {
          ok: false,
          details: `[bloque ${block.baseName}] ${pngRes.details}`
        };
      }
      const pngPath = path.join(outDir, `${block.baseName}.png`);
      fs.writeFileSync(pngPath, pngRes.pngBuffer);
      outputs.push({ format: `PNG (${PNG_DPI} dpi)`, baseName: block.baseName, outputPath: pngPath });
    }
  }

  return {
    ok: true,
    svgPath: outputs.find((o) => o.format === 'SVG')?.outputPath || null,
    outputs
  };
}

function renderDiagramSvg(jarPath, diagramsDir, outDir, fileName, precheckedSvgContent = null) {
  const prechecked = precheckedSvgContent
    ? {
        ok: true,
        svgContent: precheckedSvgContent,
        blocks: [{ baseName: fileName.replace(/\.puml$/i, ''), source: '', svgContent: precheckedSvgContent }]
      }
    : null;
  return renderDiagramOutputs(jarPath, diagramsDir, outDir, fileName, 'svg', prechecked);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  verifyJavaAvailable();
  const jarPath = await ensurePinnedPlantUmlJar();
  const files = resolveDiagramFiles(DEFAULT_DIAGRAMS_DIR, options.singleFile);

  if (files.length === 0) {
    throw new Error(`No se encontraron archivos .puml en ${DEFAULT_DIAGRAMS_DIR}`);
  }

  console.log(
    `[PlantUML v${PLANTUML_VERSION} | SHA-256 verificado] ` +
    `${options.checkOnly ? 'Validando sintaxis de' : `Renderizando (--format ${options.format})`} ${files.length} archivo(s) .puml...`
  );

  const failures = [];
  let totalOutputs = 0;

  for (const file of files) {
    const syntaxResult = checkDiagramSyntax(jarPath, DEFAULT_DIAGRAMS_DIR, file);
    if (!syntaxResult.ok) {
      console.error(`  [ERROR SINTAXIS] ${file}: ${syntaxResult.details}`);
      failures.push({ file, reason: syntaxResult.details });
      continue;
    }

    if (options.checkOnly) {
      console.log(`  [OK SINTAXIS] ${file}`);
      continue;
    }

    const renderResult = renderDiagramOutputs(
      jarPath,
      DEFAULT_DIAGRAMS_DIR,
      options.outDir,
      file,
      options.format,
      syntaxResult
    );
    if (!renderResult.ok) {
      console.error(`  [ERROR RENDER] ${file}: ${renderResult.details}`);
      failures.push({ file, reason: renderResult.details });
      continue;
    }

    for (const out of renderResult.outputs) {
      totalOutputs += 1;
      console.log(`  [OK ${out.format}] ${file} -> ${path.relative(process.cwd(), out.outputPath)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nPipeline falló: ${failures.length} diagrama(s) con errores.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    options.checkOnly
      ? `\nValidación completada con éxito: ${files.length} diagrama(s) sin errores de sintaxis.`
      : `\nRenderizado completado con éxito: ${totalOutputs} archivo(s) (${options.format.toUpperCase()}) generados en ${options.outDir}.`
  );
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[FATAL] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PLANTUML_VERSION,
  PLANTUML_JAR_SHA256,
  PNG_DPI,
  extractDiagramBlocks,
  checkDiagramSyntax,
  renderDiagramOutputs,
  renderDiagramSvg
};
