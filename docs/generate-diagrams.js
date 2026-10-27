const fs = require('fs');
const path = require('path');
const https = require('https');

const diagramsDir = path.resolve(__dirname, 'diagrams');
const assetsDir = path.resolve(__dirname, 'asciidoc', 'assets');

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

function fetchSvg(pumlContent) {
  return new Promise((resolve, reject) => {
    const hex = Buffer.from(pumlContent, 'utf-8').toString('hex');
    const url = `https://www.plantuml.com/plantuml/svg/~h${hex}`;
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`PlantUML server responded with status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function generateAll() {
  const files = fs.readdirSync(diagramsDir).filter(f => f.endsWith('.puml'));
  console.log(`Encontrados ${files.length} diagramas PlantUML en ${diagramsDir}`);

  for (const file of files) {
    const baseName = path.basename(file, '.puml');
    const targetSvg = path.join(assetsDir, `${baseName}.svg`);
    const pumlPath = path.join(diagramsDir, file);
    const pumlContent = fs.readFileSync(pumlPath, 'utf-8');

    console.log(`Generando SVG para ${file}...`);
    try {
      const svg = await fetchSvg(pumlContent);
      fs.writeFileSync(targetSvg, svg, 'utf-8');
      console.log(`✓ Guardado: ${targetSvg} (${svg.length} bytes)`);
    } catch (err) {
      console.error(`✗ Error generando ${file}:`, err.message);
    }
  }
  console.log('Generación de diagramas completada con éxito.');
}

if (require.main === module) {
  generateAll();
}

module.exports = { generateAll };
