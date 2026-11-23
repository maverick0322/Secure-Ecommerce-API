#!/usr/bin/env node
'use strict';

/**
 * Compuerta maestra de calidad documental (docs/verify-docs.js).
 *
 * Comprueba:
 *  1a. Términos prohibidos (docs/forbidden-terms.json) en .adoc y .puml
 *      (permitidos solo con `// allow: <término>` y justificación en la misma línea).
 *  1b. Identificadores únicos (CU-*, RF-*, RN-*, RNF-*, RSG-*):
 *      - Definidos UNA sola vez mediante [[ID]] en docs/asciidoc/_registro_ids.adoc.
 *      - Toda referencia <<ID>> resuelve en _registro_ids.adoc.
 *      - Todo RF enlaza a >= 1 CU y todo CU enlaza a >= 1 RF en la matriz.
 *  1c. Constantes centralizadas en docs/asciidoc/_hechos.adoc:
 *      - Los literales numéricos característicos deben referenciarse con {atributo},
 *        nunca repetirse en duro en los capítulos (salvo en _hechos.adoc o // annex-begin..// annex-end).
 *  1d. Trazas: invoca docs/verify-traces.js (rutas, símbolos y cabeceras `' TRACE:` en .puml).
 *  1e. Compilación AsciiDoctor sin advertencias + existencia de todas las imágenes referenciadas.
 *  1f. Diagramas: `node docs/generate-diagrams.js --check-only` + existencia de los 25 .puml del plan
 *      (todos salvo DEP-01 / despliegue.puml) y sus archivos SVG y PNG en docs/asciidoc/assets/.
 *
 * Uso:
 *   node docs/verify-docs.js                # Ejecuta todas las compuertas 1a..1f
 *   node docs/verify-docs.js --skip-stage3  # Omite 1f y cabeceras TRACE previas a Etapa 3
 */

const fs = require('fs');
const path = require('path');
const asciidoctor = require('@asciidoctor/core');

const { runVerification: runTraceVerification } = require('./verify-traces');
const { PLANTUML_VERSION } = require('./generate-diagrams');

const DOCS_DIR = __dirname;
const ASCIIDOC_DIR = path.join(DOCS_DIR, 'asciidoc');
const ASSETS_DIR = path.join(ASCIIDOC_DIR, 'assets');
const DIAGRAMS_DIR = path.join(DOCS_DIR, 'diagrams');
const FORBIDDEN_PATH = path.join(DOCS_DIR, 'forbidden-terms.json');
const REGISTRO_PATH = path.join(ASCIIDOC_DIR, '_registro_ids.adoc');
const HECHOS_PATH = path.join(ASCIIDOC_DIR, '_hechos.adoc');
const PLAN_PATH = path.join(DIAGRAMS_DIR, 'PLAN_DIAGRAMAS.md');

// Constantes cuyo literal no debe repetirse fuera de _hechos.adoc (ni anclas/comentarios)
const LITERAL_CONSTANT_RULES = [
  { regex: /\b32768\b/, attr: '{scrypt-n}' },
  { regex: /\b2097152\b/, attr: '{img-max-bytes}' },
  { regex: /\b2\s*MiB\b/i, attr: '{img-max-mib} MiB' },
  { regex: /\b65535\b/, attr: '{desc-max-bytes}' },
  { regex: /\b90000\b/, attr: '{quote-max-sign-chars}' },
  { regex: /\b100000\b/, attr: '{quote-max-verify-chars}' },
  { regex: /\b8000000\b/, attr: '{img-max-pixels}' },
  { regex: /\b4096\s*px\b/i, attr: '{img-max-dim-px} px' },
  { regex: /\b300\s*s\b/i, attr: '{jwt-ttl-seg} s' },
  { regex: /\b600\s*s\b/i, attr: '{quote-ttl-seg} s' },
  { regex: /\b1800000\b/, attr: '{sesion-inactividad-ms}' },
  { regex: /\b28800000\b/, attr: '{sesion-absoluto-ms}' },
  { regex: /\b200\s+productos\s+activos\b/i, attr: '{cuota-productos-activos} productos activos' },
  { regex: /\b10\s+categor[íi]as\s+activas\b/i, attr: '{cuota-categorias-producto} categorías activas' },
  { regex: /\b30\s+escrituras\b/i, attr: '{catalogo-escrituras-max} escrituras' },
  { regex: /\b512\s*bytes\b/i, attr: '{pwd-max-bytes} bytes' },
  { regex: /\b1092\b/, attr: '{be-tests-pasados}' },
  { regex: /\b1145\b/, attr: '{be-tests-total}' },
  { regex: /\b94\.82\b/, attr: '{be-cov-stmts}' },
  { regex: /\b97\.98\b/, attr: '{be-cov-lines}' }
];

function checkForbiddenTerms(skipStage3 = false) {
  const errors = [];
  if (!fs.existsSync(FORBIDDEN_PATH)) {
    return [`No existe ${FORBIDDEN_PATH}`];
  }
  const forbiddenTerms = JSON.parse(fs.readFileSync(FORBIDDEN_PATH, 'utf8'));

  const filesToScan = [];
  if (fs.existsSync(ASCIIDOC_DIR)) {
    for (const f of fs.readdirSync(ASCIIDOC_DIR).sort()) {
      if (f.endsWith('.adoc')) filesToScan.push({ label: `asciidoc/${f}`, fullPath: path.join(ASCIIDOC_DIR, f) });
    }
  }
  if (!skipStage3 && fs.existsSync(DIAGRAMS_DIR)) {
    for (const f of fs.readdirSync(DIAGRAMS_DIR).sort()) {
      if (f.endsWith('.puml') && f !== '_muestra.puml') {
        filesToScan.push({ label: `diagrams/${f}`, fullPath: path.join(DIAGRAMS_DIR, f) });
      }
    }
  }

  for (const file of filesToScan) {
    const lines = fs.readFileSync(file.fullPath, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const lower = line.toLowerCase();
      for (const term of forbiddenTerms) {
        if (!lower.includes(term.toLowerCase())) continue;
        // Verificar `// allow: <término>` + justificación en la misma línea
        const allowRegex = new RegExp(`//\\s*allow:\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s+\\S+`, 'i');
        const pumlAllowRegex = new RegExp(`'\\s*allow:\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s+\\S+`, 'i');
        if (!allowRegex.test(line) && !pumlAllowRegex.test(line)) {
          errors.push(`[1a TÉRMINO PROHIBIDO] ${file.label}:${idx + 1} contiene "${term}" sin marcador allow justificado.`);
        }
      }
    });
  }

  return errors;
}

function checkIdentifiers() {
  const errors = [];
  if (!fs.existsSync(REGISTRO_PATH)) {
    return [`[1b IDs] No existe ${REGISTRO_PATH}`];
  }

  const definedIds = new Map(); // id -> count
  const adocFiles = fs.readdirSync(ASCIIDOC_DIR).filter((f) => f.endsWith('.adoc')).sort();

  const regContent = fs.readFileSync(REGISTRO_PATH, 'utf8');
  const regLines = regContent.split(/\r?\n/);

  const cuToRf = new Map();
  const rfToCu = new Map();

  for (const f of adocFiles) {
    const fullPath = path.join(ASCIIDOC_DIR, f);
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);

    lines.forEach((line, idx) => {
      // 1. Anchors [[ID]]
      const anchorRegex = /\[\[([A-Z]+-\d+)\]\]/g;
      let am = anchorRegex.exec(line);
      while (am !== null) {
        const id = am[1];
        if (f !== '_registro_ids.adoc') {
          errors.push(`[1b IDs] ${f}:${idx + 1} define [[${id}]] fuera de _registro_ids.adoc.`);
        } else {
          definedIds.set(id, (definedIds.get(id) || 0) + 1);
          if (definedIds.get(id) > 1) {
            errors.push(`[1b IDs] _registro_ids.adoc:${idx + 1} define [[${id}]] más de una vez.`);
          }
        }
        am = anchorRegex.exec(line);
      }
    });
  }

  // Verificar referencias <<ID>> y enlace RF <-> CU en _registro_ids.adoc
  regLines.forEach((line) => {
    const cuDef = line.match(/\[\[(CU-\d+)\]\]/);
    if (cuDef) {
      const cuId = cuDef[1];
      const linkedRfs = [...line.matchAll(/<<(RF-\d+)>>/g)].map((m) => m[1]);
      cuToRf.set(cuId, linkedRfs);
    }
    const rfDef = line.match(/\[\[(RF-\d+)\]\]/);
    if (rfDef) {
      const rfId = rfDef[1];
      const linkedCus = [...line.matchAll(/<<(CU-\d+)>>/g)].map((m) => m[1]);
      rfToCu.set(rfId, linkedCus);
    }
  });

  for (const [cu, rfs] of cuToRf.entries()) {
    if (rfs.length === 0) {
      errors.push(`[1b IDs] ${cu} en _registro_ids.adoc no enlaza a ningún RF.`);
    }
  }
  for (const [rf, cus] of rfToCu.entries()) {
    if (cus.length === 0) {
      errors.push(`[1b IDs] ${rf} en _registro_ids.adoc no enlaza a ningún CU.`);
    }
  }

  // Verificar que todas las referencias <<ID>> en todos los .adoc resuelven en _registro_ids.adoc
  for (const f of adocFiles) {
    const lines = fs.readFileSync(path.join(ASCIIDOC_DIR, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const refRegex = /<<((?:CU|RF|RN|RNF|RSG)-\d+)>>/g;
      let rm = refRegex.exec(line);
      while (rm !== null) {
        const refId = rm[1];
        if (!definedIds.has(refId)) {
          errors.push(`[1b IDs] ${f}:${idx + 1} referencia <<${refId}>> que no está definido en _registro_ids.adoc.`);
        }
        rm = refRegex.exec(line);
      }
    });
  }

  return errors;
}

function checkConstants() {
  const errors = [];
  if (!fs.existsSync(HECHOS_PATH)) {
    return [`[1c CONSTANTES] No existe ${HECHOS_PATH}`];
  }

  const adocFiles = fs.readdirSync(ASCIIDOC_DIR)
    .filter((f) => f.endsWith('.adoc') && f !== '_hechos.adoc' && !f.startsWith('_anexo'))
    .sort();

  for (const f of adocFiles) {
    const lines = fs.readFileSync(path.join(ASCIIDOC_DIR, f), 'utf8').split(/\r?\n/);
    let inAnnex = false;
    let inCodeBlock = false;

    lines.forEach((line, idx) => {
      if (/\/\/\s*annex-begin\b/.test(line)) {
        inAnnex = true;
        return;
      }
      if (/\/\/\s*annex-end\b/.test(line)) {
        inAnnex = false;
        return;
      }
      if (/^\s*(?:----|```)/.test(line)) {
        inCodeBlock = !inCodeBlock;
        return;
      }
      if (inAnnex || inCodeBlock || /^\s*\/\//.test(line)) return;

      for (const rule of LITERAL_CONSTANT_RULES) {
        if (rule.regex.test(line)) {
          errors.push(
            `[1c CONSTANTES] ${f}:${idx + 1} usa literal coincidente con ${rule.regex}; sustitúyelo por ${rule.attr} de _hechos.adoc.`
          );
        }
      }
    });
  }

  return errors;
}

function checkTraces(skipStage3) {
  const errors = [];
  const res = runTraceVerification({ requireDiagramTraceHeaders: !skipStage3 });
  for (const m of res.missingTraceHeaders) {
    errors.push(`[1d TRAZAS] ${m.doc}: ${m.reason}`);
  }
  for (const m of res.missingPaths) {
    errors.push(`[1d TRAZAS] ${m.doc}:${m.line} -> ${m.item} (${m.reason})`);
  }
  for (const m of res.missingSymbols) {
    errors.push(`[1d TRAZAS] ${m.doc}:${m.line} -> ${m.item} (${m.reason})`);
  }
  return errors;
}

function checkAsciidoctor() {
  const errors = [];
  const indexPath = path.join(ASCIIDOC_DIR, 'index.adoc');
  if (!fs.existsSync(indexPath)) {
    return [`[1e ASCIIDOCTOR] No existe ${indexPath}`];
  }

  // Verificar que toda directiva image::archivo[...] existe físicamente en assets/
  const adocFiles = fs.readdirSync(ASCIIDOC_DIR).filter((f) => f.endsWith('.adoc')).sort();
  for (const f of adocFiles) {
    const lines = fs.readFileSync(path.join(ASCIIDOC_DIR, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const im = line.match(/^\s*image::([^[]+)\[/);
      if (im) {
        const relImg = im[1].trim();
        const imgPath = path.join(ASSETS_DIR, relImg);
        if (!fs.existsSync(imgPath)) {
          errors.push(`[1e ASCIIDOCTOR] ${f}:${idx + 1} referencia imagen inexistente en assets/: ${relImg}`);
        }
      }
    });
  }

  const memoryLogger = asciidoctor.MemoryLogger.create();
  asciidoctor.LoggerManager.setLogger(memoryLogger);

  try {
    asciidoctor.convertFile(indexPath, {
      to_file: false,
      safe: 'unsafe',
      base_dir: ASCIIDOC_DIR
    });
  } catch (err) {
    errors.push(`[1e ASCIIDOCTOR] Fallo al compilar index.adoc: ${err.message}`);
    return errors;
  }

  const messages = memoryLogger.getMessages();
  for (const msg of messages) {
    const sev = msg.getSeverity ? msg.getSeverity() : 'WARN';
    const text = msg.getText ? msg.getText() : String(msg);
    errors.push(`[1e ASCIIDOCTOR ${sev}] ${text}`);
  }

  return errors;
}

function getPlannedDiagramsExceptDep01() {
  if (!fs.existsSync(PLAN_PATH)) {
    return [];
  }
  const lines = fs.readFileSync(PLAN_PATH, 'utf8').split(/\r?\n/);
  const files = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*\*\*`([^`]+)`\*\*\s*\|[^|]+\|\s*`([^`]+\.puml)`\s*\|/);
    if (!m) continue;
    const [, id, pumlName] = m;
    if (id === 'DEP-01') continue;
    files.push(pumlName);
  }
  return files;
}

function checkDiagrams(skipStage3) {
  const errors = [];
  if (skipStage3) return errors;

  const { spawnSync } = require('child_process');
  const genScript = path.join(DOCS_DIR, 'generate-diagrams.js');
  const res = spawnSync(process.execPath, [genScript, '--check-only'], {
    cwd: path.resolve(DOCS_DIR, '..'),
    encoding: 'utf8'
  });

  if (res.status !== 0) {
    errors.push(`[1f DIAGRAMAS] generate-diagrams.js --check-only falló (código ${res.status}):\n${res.stderr || res.stdout}`);
  }

  const planned = getPlannedDiagramsExceptDep01();
  if (planned.length !== 25) {
    errors.push(`[1f DIAGRAMAS] Se esperaban 25 diagramas planificados (sin DEP-01) en PLAN_DIAGRAMAS.md, encontrados: ${planned.length}.`);
  }

  for (const pumlName of planned) {
    const pumlPath = path.join(DIAGRAMS_DIR, pumlName);
    if (!fs.existsSync(pumlPath)) {
      errors.push(`[1f DIAGRAMAS] Falta archivo fuente del plan: docs/diagrams/${pumlName}`);
    }
    const base = pumlName.replace(/\.puml$/i, '');
    if (!fs.existsSync(path.join(ASSETS_DIR, `${base}.svg`))) {
      errors.push(`[1f DIAGRAMAS] Falta SVG renderizado: docs/asciidoc/assets/${base}.svg`);
    }
    if (!fs.existsSync(path.join(ASSETS_DIR, `${base}.png`))) {
      errors.push(`[1f DIAGRAMAS] Falta PNG (200 dpi) renderizado: docs/asciidoc/assets/${base}.png`);
    }
  }

  return errors;
}

function main() {
  const skipStage3 = process.argv.includes('--skip-stage3');
  const results = [
    { name: '1a. Términos prohibidos', errors: checkForbiddenTerms(skipStage3) },
    { name: '1b. Identificadores y trazabilidad RF<->CU', errors: checkIdentifiers() },
    { name: '1c. Constantes centralizadas (_hechos.adoc)', errors: checkConstants() },
    { name: '1d. Trazas de rutas y símbolos', errors: checkTraces(skipStage3) },
    { name: '1e. Compilación AsciiDoctor e imágenes', errors: checkAsciidoctor() },
    {
      name: `1f. Diagramas PlantUML v${PLANTUML_VERSION} (${skipStage3 ? 'OMITIDO por --skip-stage3' : '25 diagramas'})`,
      errors: checkDiagrams(skipStage3)
    }
  ];

  let totalErrors = 0;
  for (const gate of results) {
    const status = gate.errors.length === 0 ? 'PASA' : `FALLA (${gate.errors.length})`;
    console.log(`[verify-docs] ${gate.name}: ${status}`);
    for (const err of gate.errors) {
      console.error(`  ${err}`);
    }
    totalErrors += gate.errors.length;
  }

  if (totalErrors > 0) {
    console.error(`\n[verify-docs] FALLÓ con ${totalErrors} error(es).`);
    process.exitCode = 1;
    return;
  }

  console.log('\n[verify-docs] OK: Todas las compuertas pasaron con 0 errores.');
}

if (require.main === module) {
  main();
}

module.exports = {
  checkForbiddenTerms,
  checkIdentifiers,
  checkConstants,
  checkTraces,
  checkAsciidoctor,
  checkDiagrams
};
