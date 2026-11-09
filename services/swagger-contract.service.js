const RESPONSE_DESCRIPTIONS = {
  200: 'Solicitud procesada correctamente.', 201: 'Recurso creado correctamente.',
  204: 'Solicitud procesada sin contenido de respuesta.', 400: 'Solicitud inválida.',
  401: 'Autenticación requerida o credenciales inválidas.', 403: 'Acceso prohibido.',
  404: 'Recurso no encontrado.', 409: 'El recurso ya existe.',
  500: 'No se ha podido procesar la petición.', 503: 'Documentación temporalmente no disponible.'
};

function buildDefinitions() {
  const text = { type: 'string' };
  const integer = { type: 'integer' };
  const boolean = { type: 'boolean' };
  const nullableInteger = { type: 'integer', 'x-nullable': true };
  const timestamp = { type: 'string', format: 'date-time' };
  const object = properties => ({ type: 'object', properties });
  const categoryFields = { name: text, protected: boolean };
  const productFields = { title: text, description: text, fileId: nullableInteger };
  const userFields = { id: text, email: text, name: text, role: { type: 'string', example: 'Usuario' } };
  const fileFields = { mime: text, storedInDatabase: boolean, name: text };
  return {
    ErrorResponse: object({ status: integer, message: { type: 'string', example: 'Recurso no encontrado.' }, errors: { type: 'array', items: { type: 'object' }, description: 'Errores de validación con las claves estándar de express-validator.' } }),
    Category: object({ categoryId: integer, ...categoryFields }),
    CategoryCreated: object({ id: integer, ...categoryFields, createdAt: timestamp, updatedAt: timestamp }),
    Product: object({ productId: integer, ...productFields, price: { type: 'string', example: '950.00', description: 'Las consultas conservan el tipo cadena que devuelve Sequelize para DECIMAL.' }, categories: { type: 'array', items: { $ref: '#/definitions/Category' } } }),
    ProductCreated: object({ id: integer, ...productFields, price: { example: 950, description: 'Conserva el tipo de entrada al crear el producto.' }, createdAt: timestamp, updatedAt: timestamp }),
    User: object({ ...userFields, protected: boolean }),
    UserCreated: object(userFields),
    Role: object({ id: text, name: { type: 'string', example: 'Administrador' } }),
    LoginResponse: object({ email: text, name: text, role: text, jwt: text }),
    SessionTime: object({ remainingTime: { type: 'string', example: '00:19:59' } }),
    FileMetadata: object({ fileId: integer, ...fileFields, size: integer }),
    FileCreated: object({ id: integer, ...fileFields }),
    AuditLog: object({ auditLogId: integer, action: { type: 'string', example: 'producto.crear' }, elementId: { type: 'string', 'x-nullable': true }, ip: text, user: text, date: timestamp })
  };
}

function completeSpecification(specification) {
  specification.definitions = buildDefinitions();
  const resources = { categories: ['categorías', 'Category'], products: ['productos', 'Product'], users: ['usuarios', 'User'], roles: ['roles', 'Role'], files: ['archivos', 'FileMetadata'], 'audit-logs': ['registros de auditoría', 'AuditLog'], auth: ['sesión', 'LoginResponse'] };
  for (const [rawPath, operations] of Object.entries(specification.paths)) {
    const apiPath = rawPath.replace(/\/$/, '');
    if (rawPath !== apiPath) {
      specification.paths[apiPath] = operations;
      delete specification.paths[rawPath];
    }
    const resource = apiPath.split('/')[2];
    for (const [method, operation] of Object.entries(operations)) {
      operation.description = `${{ get: 'Consulta de', post: 'Creación de', put: 'Actualización de', delete: 'Eliminación de' }[method] || 'Operación sobre'} ${resources[resource]?.[0] || 'documentación'}.`;
      const publicRoute = (apiPath === '/api/auth' && method === 'post') || (apiPath === '/api/files/{id}' && method === 'get') || apiPath === '/swagger';
      operation.security = publicRoute ? [] : [{ bearerAuth: [] }];
      if (!publicRoute) {
        operation.responses[401] = { description: RESPONSE_DESCRIPTIONS[401] };
        operation.responses[403] = { description: RESPONSE_DESCRIPTIONS[403] };
      }
      operation.responses[500] = { description: RESPONSE_DESCRIPTIONS[500] };
      for (const [status, response] of Object.entries(operation.responses)) {
        response.description = RESPONSE_DESCRIPTIONS[status] || 'Respuesta del servidor.';
        if (Number(status) >= 400) response.schema = { $ref: '#/definitions/ErrorResponse' };
      }
      // Conservar las claves de entrada inferidas desde los controladores.
      const input = operation.parameters?.find(parameter => parameter.in === 'body');
      if (input) {
        input.description = 'Campos de la solicitud.';
        input.required = true;
        for (const [name, field] of Object.entries(input.schema.properties || {})) {
          field.example = { name: 'Persona o categoría de ejemplo', title: 'Teclado', description: 'Teclado mecánico', price: 950, email: 'demo@example.com', password: 'CambiarAntesDeUsar123', role: 'Usuario', fileId: 1, categoryId: 1 }[name];
        }
      }
      if (resource === 'files' && ['post', 'put'].includes(method)) {
        operation.consumes = ['multipart/form-data'];
        operation.parameters = [...(operation.parameters || []), { name: 'file', in: 'formData', required: true, type: 'file', description: 'Imagen JPG/JPEG de hasta 2 MB.' }];
      }
      if (apiPath === '/api/files/{id}' && method === 'get') {
        operation.produces = ['image/jpeg', 'image/pjpeg'];
        operation.responses[200].schema = { type: 'file' };
        continue;
      }
      let schemaName = resources[resource]?.[1];
      if (apiPath === '/api/auth/time') schemaName = 'SessionTime';
      else if (method === 'post' && ['categories', 'products', 'users'].includes(resource)) schemaName += 'Created';
      else if (resource === 'files' && method === 'post') schemaName = 'FileCreated';
      const status = method === 'post' && resource !== 'auth' ? 201 : 200;
      if (schemaName && operation.responses[status]) {
        const schema = { $ref: `#/definitions/${schemaName}` };
        operation.responses[status].schema = method === 'get' && apiPath === `/api/${resource}` && resource !== 'auth'
          ? { type: 'array', items: schema } : schema;
      }
    }
  }
  return specification;
}

module.exports = { completeSpecification };
