const asciidoctor = require('@asciidoctor/core');
const path = require('path');

const inputFile = path.resolve(__dirname, 'asciidoc', 'index.adoc');
const outputDir = path.resolve(__dirname, '..', 'dist');

asciidoctor.convertFile(inputFile, {
  to_dir: outputDir,
  mkdirs: true,
  safe: 'unsafe'
});

console.log(`Documentación compilada exitosamente en ${outputDir}/index.html`);
