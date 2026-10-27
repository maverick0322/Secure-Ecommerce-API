const asciidoctor = require('@asciidoctor/core');
const path = require('path');
const fs = require('fs');

const inputFile = path.resolve(__dirname, 'asciidoc', 'index.adoc');
const outputDir = path.resolve(__dirname, '..', 'dist');
const assetsSource = path.resolve(__dirname, 'asciidoc', 'assets');
const assetsDest = path.resolve(outputDir, 'assets');

// Compilar AsciiDoctor a HTML5
asciidoctor.convertFile(inputFile, {
  to_dir: outputDir,
  mkdirs: true,
  safe: 'unsafe'
});

// Copiar assets (diagramas SVG, imágenes) a dist/assets para despliegue en GitHub Pages
if (fs.existsSync(assetsSource)) {
  fs.cpSync(assetsSource, assetsDest, { recursive: true });
  console.log(`Assets copiados exitosamente a ${assetsDest}`);
}

console.log(`Documentación compilada exitosamente en ${outputDir}/index.html`);
