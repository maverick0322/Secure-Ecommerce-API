#!/usr/bin/env node
'use strict';

/**
 * Pipeline reproducible de validación y renderizado de diagramas PlantUML (.puml -> .svg).
 *
 * Características:
 * 1. Fija la versión exacta de PlantUML a 1.2024.8 desde Maven Central y verifica su
 *    integridad criptográfica mediante hash SHA-256 antes de ejecutarlo.
 * 2. Resuelve directivas locales `!include _skin.puml` fijando el directorio de inclusión
 *    en `docs/diagrams/` y excluyendo archivos parciales que comienzan con `_`.
 * 3. Falla con código de salida distinto de cero (exit 1) ante cualquier error de sintaxis
 *    en los archivos `.puml`, fallo de ejecución de Java/PlantUML o ausencia de SVG válido.
 *
 * Uso:
 *   node docs/generate-diagrams.js                   # Valida sintaxis y genera SVGs en docs/asciidoc/assets/
 *   node docs/generate-diagrams.js --check-only      # Solo valida sintaxis de todos los .puml (no toca SVGs)
 *   node docs/generate-diagrams.js --file <archivo>  # Procesa únicamente un archivo .puml específico
 *   node docs/generate-diagrams.js --out-dir <ruta>  # Define un directorio de salida alternativo para SVGs
 *   node docs/generate-diagrams.js --help            # Muestra esta ayuda
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

const DEFAULT_DIAGRAMS_DIR = path.join(__dirname, 'diagrams');
const DEFAULT_ASSETS_DIR = path.join(__dirname, 'asciidoc', 'assets');
const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'secure-ecommerce-plantuml');

function printHelp() {
  console.log(`
Uso: node docs/generate-diagrams.js [opciones]

Opciones:
  --check-only         Valida la sintaxis de los archivos .puml sin escribir ni modificar archivos .svg.
  --file <nombre.puml> Procesa únicamente el archivo .puml indicado (relativo a docs/diagrams/).
  --out-dir <ruta>     Directorio destino para los archivos .svg (por defecto: docs/asciidoc/assets/).
  --help, -h           Muestra esta ayuda y termina.

Variables de entorno opcionales:
  PLANTUML_JAR_PATH    Ruta personalizada para almacenar/leer plantuml-${PLANTUML_VERSION}.jar.
`.trim());
}

function parseArgs(argv) {
  const options = {
    checkOnly: false,
    singleFile: null,
    outDir: DEFAULT_ASSETS_DIR,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check-only' || arg === '--dry-run') {
      options.checkOnly = true;
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

function checkDiagramSyntax(jarPath, diagramsDir, fileName) {
  const fullPath = path.join(diagramsDir, fileName);
  const content = fs.readFileSync(fullPath, 'utf8');

  if (!content.includes('@startuml') || !content.includes('@enduml')) {
    return {
      ok: false,
      details: 'El archivo debe contener los delimitadores @startuml y @enduml.'
    };
  }

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
    input: content,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
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

function renderDiagramSvg(jarPath, diagramsDir, outDir, fileName, precheckedSvgContent = null) {
  let svgContent = precheckedSvgContent;
  if (!svgContent) {
    const check = checkDiagramSyntax(jarPath, diagramsDir, fileName);
    if (!check.ok) {
      return check;
    }
    svgContent = check.svgContent;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const svgName = fileName.replace(/\.puml$/i, '.svg');
  const svgPath = path.join(outDir, svgName);
  fs.writeFileSync(svgPath, svgContent, 'utf8');

  return { ok: true, svgPath };
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
    `${options.checkOnly ? 'Validando sintaxis de' : 'Renderizando'} ${files.length} diagrama(s)...`
  );

  const failures = [];

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

    const renderResult = renderDiagramSvg(jarPath, DEFAULT_DIAGRAMS_DIR, options.outDir, file, syntaxResult.svgContent);
    if (!renderResult.ok) {
      console.error(`  [ERROR RENDER] ${file}: ${renderResult.details}`);
      failures.push({ file, reason: renderResult.details });
      continue;
    }

    console.log(`  [OK SVG] ${file} -> ${path.relative(process.cwd(), renderResult.svgPath)}`);
  }

  if (failures.length > 0) {
    console.error(`\nPipeline falló: ${failures.length} diagrama(s) con errores.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    options.checkOnly
      ? `\nValidación completada con éxito: ${files.length} diagrama(s) sin errores de sintaxis.`
      : `\nRenderizado completado con éxito: ${files.length} archivo(s) SVG generados en ${options.outDir}.`
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
  checkDiagramSyntax,
  renderDiagramSvg
};
