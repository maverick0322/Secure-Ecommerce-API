const swaggerAutogen = require('swagger-autogen')();
const fs = require('fs');
const { completeSpecification } = require('./services/swagger-contract.service');

const doc = {
  info: {
    title: 'Backend Node.js API - E-Commerce Seguro',
    description: 'Documentación interactiva de la API REST para E-Commerce con autenticación JWT y roles'
  },
  host: 'localhost:3000',
  schemes: ['http'],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
      description: 'Ingrese el token JWT con el prefijo Bearer (Ej: Bearer eyJhbGci...)'
    }
  }
};

const routes = ['./index.js'];

/* Generar documentación OpenAPI */
async function generateDocumentation(outputFile = './swagger-output.json') {
  const result = await swaggerAutogen(outputFile, routes, doc);
  if (!result.success) throw new Error('No se pudo generar la documentación Swagger.');
  fs.writeFileSync(outputFile, JSON.stringify(completeSpecification(result.data), null, 2) + '\n');
  console.log(`Documentación Swagger generada exitosamente en ${outputFile}`);
}

if (require.main === module) {
  generateDocumentation().catch(error => {
    console.error('Error al generar Swagger:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { generateDocumentation };
