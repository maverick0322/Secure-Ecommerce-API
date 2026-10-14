const swaggerAutogen = require('swagger-autogen')();

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

const outputFile = './swagger-output.json';
const routes = ['./index.js'];

/* Generar documentación OpenAPI */
swaggerAutogen(outputFile, routes, doc).then(() => {
  console.log('Documentación Swagger generada exitosamente en swagger-output.json');
});
