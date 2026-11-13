const RESPONSE_DESCRIPTIONS = {
  200: 'Solicitud procesada correctamente.', 201: 'Recurso creado correctamente.', 202: 'Solicitud recibida.',
  204: 'Solicitud procesada sin contenido de respuesta.', 400: 'Solicitud inválida.',
  401: 'Autenticación requerida o credenciales inválidas.', 403: 'Acceso prohibido.',
  404: 'Recurso no encontrado.', 409: 'Conflicto con el estado del recurso.', 410: 'Operación histórica retirada.',
  413: 'La imagen supera el tamaño permitido.', 429: 'Límite de solicitudes alcanzado.',
  500: 'No se ha podido procesar la petición.', 502: 'Fallo del proveedor de imágenes.', 503: 'Servicio temporalmente no disponible.'
};

function buildDefinitions() {
  const text = { type: 'string' };
  const integer = { type: 'integer' };
  const boolean = { type: 'boolean' };
  const timestamp = { type: 'string', format: 'date-time' };
  const object = properties => ({ type: 'object', properties });
  const categoryFields = { name: text, protected: boolean };
  const productFields = { title: text, description: { type: 'string', 'x-nullable': true },
    sellerId: { type: 'string', format: 'uuid', readOnly: true }, stock: { type: 'integer', minimum: 0, maximum: 4294967295 },
    imagePublicId: { type: 'string', 'x-nullable': true, readOnly: true },
    imageUrl: { type: 'string', format: 'uri', 'x-nullable': true, readOnly: true } };
  const userFields = { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, name: text,
    profile: { type: 'string', enum: ['ADMIN', 'SELLER', 'BUYER'], 'x-nullable': true },
    status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DISABLED'] },
    sellerStatus: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] } };
  return {
    ErrorResponse: object({ status: integer, message: { type: 'string', example: 'Recurso no encontrado.' }, errors: { type: 'array', items: { type: 'object' }, description: 'Errores de validación con las claves estándar de express-validator.' } }),
    Category: object({ categoryId: integer, ...categoryFields }),
    CategoryCreated: object({ id: integer, ...categoryFields, createdAt: timestamp, updatedAt: timestamp }),
    Product: object({ productId: integer, ...productFields, price: { type: 'string', example: '950.00', description: 'Las consultas conservan el tipo cadena que devuelve Sequelize para DECIMAL.' }, categories: { type: 'array', items: { $ref: '#/definitions/Category' } } }),
    User: object(userFields),
    LoginResponse: object({ ...userFields, jwt: {type:'string',description:'Access token RS256, máximo cinco minutos.'},
      refreshToken:{type:'string',minLength:43,maxLength:43,description:'Secreto opaco de un solo uso; sustituirlo en cada refresh.'},
      expiresIn:{type:'integer',enum:[300]},tokenType:{type:'string',enum:['Bearer']} }),
    VerificationRequested: object({ message: text }),
    SellerReview: object({ userId: userFields.id, status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
      rejectionReason: { type: 'string', 'x-nullable': true }, reviewedAt: timestamp, reviewedByUserId: userFields.id }),
    SellerSuspension: object({ userId: userFields.id, status: {type:'string',enum:['SUSPENDED']},
      reviewedAt: timestamp, reviewedByUserId: userFields.id }),
    SessionTime: object({ remainingTime: { type: 'string', example: '00:04:59' } }),
    AuditLog: object({ id: integer, actorUserId: {type:'string',format:'uuid','x-nullable':true},action:{type:'string',maxLength:80},
      targetType:{type:'string','x-nullable':true},targetId:{type:'string','x-nullable':true},
      ipAddress:{type:'string','x-nullable':true},outcome:{type:'string',enum:['SUCCESS','DENIED','ERROR']},occurredAt:timestamp })
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
      const publicRoute = (resource === 'auth' && method === 'post') || (apiPath === '/api/files/{id}' && method === 'get') || apiPath === '/swagger';
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
          field.example = { name: 'Persona o categoría de ejemplo', title: 'Teclado', description: 'Teclado mecánico', price: 950, email: 'demo@example.invalid', password: 'CambiarAntesDeUsar123', categoryId: 1 }[name];
        }
      }
      if (apiPath === '/api/files/{id}' && method === 'get') {
        operation.produces = ['image/jpeg', 'image/pjpeg'];
        operation.responses[200] ||= { description: RESPONSE_DESCRIPTIONS[200] };
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
  addAccountOperations(specification.paths);
  addCatalogOperations(specification.paths);
  addAddressOperations(specification);
  require('./cart-openapi')(specification);
  require('./orders-openapi')(specification);
  for (const operations of Object.values(specification.paths)) {
    for (const operation of Object.values(operations)) if (operation.security?.some(s => s.bearerAuth)) {
      operation.responses[503] = { description:'El almacén de sesiones o su configuración segura no está disponible.', schema:{$ref:'#/definitions/ErrorResponse'} };
    }
  }
  for(const [path,operations] of Object.entries(specification.paths)) {
    if(!/^\/api\/(files|roles)(\/|$)/.test(path)) continue;
    for(const operation of Object.values(operations)) {
      delete operation.responses[200]; delete operation.responses[201];
      operation.responses[410]={description:'Recurso histórico retirado; no consulta tablas ni archivos antiguos.',schema:{$ref:'#/definitions/ErrorResponse'}};
      operation.description='Recurso histórico retirado. Use perfiles e imágenes del producto.';
      operation.produces=['application/json'];
    }
  }
  specification.paths['/api/audit-logs']||={};
  specification.paths['/api/audit-logs'].get||={security:[{bearerAuth:[]}],responses:{200:{description:'Página de auditoría.',schema:{type:'array',items:{$ref:'#/definitions/AuditLog'}}}}};
  const audit = specification.paths['/api/audit-logs'].get;
  if (audit) {
    audit.description='ADMIN: consulta auditoría inmutable paginada; requiere SELECT explícito de columnas en MySQL. No expone details.';
    audit.parameters=[{name:'before',in:'query',type:'string',pattern:'^[1-9][0-9]{0,9}$'},
      {name:'limit',in:'query',type:'integer',minimum:1,maximum:100,default:50}];
    audit.responses[400]={description:'Paginación inválida.',schema:{$ref:'#/definitions/ErrorResponse'}};
    audit.responses[503]={description:'Lectura de auditoría sin aprovisionar.',schema:{$ref:'#/definitions/ErrorResponse'}};
    for(const code of [401,403,500]) audit.responses[code]||={description:'Autenticación, autorización o error interno.',schema:{$ref:'#/definitions/ErrorResponse'}};
  }
  return specification;
}

function addAddressOperations(specification) {
  const properties = {};
  const lengths = { recipientName:120,street:255,exteriorNumber:20,neighborhood:120,city:120,state:120,postalCode:12,label:40,interiorNumber:20 };
  for (const [name,maxLength] of Object.entries(lengths)) properties[name] = { type:'string',minLength:1,maxLength };
  properties.country = { type:'string',pattern:'^[A-Z]{2}$',default:'MX' };
  properties.isDefault = { type:'boolean',default:false };
  properties.label['x-nullable'] = true;
  properties.interiorNumber['x-nullable'] = true;
  specification.definitions.UserAddress = { type:'object',properties:{ ...properties,
    id:{ type:'string',pattern:'^[1-9][0-9]{0,19}$' },buyerId:{type:'string',format:'uuid'},
    createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'} } };
  const id = { name:'id',in:'path',required:true,type:'string',pattern:'^[1-9][0-9]{0,19}$',description:'BIGINT UNSIGNED, hasta 18446744073709551615.' };
  const ref = { $ref:'#/definitions/UserAddress' };
  for (const [path,method,status,description] of [
    ['/api/addresses','get',200,'BUYER: consulta exclusivamente las direcciones propias activas.'],
    ['/api/addresses','post',201,'BUYER: registra una dirección propia; serializa la elección de predeterminada.'],
    ['/api/addresses/{id}','put',204,'BUYER propietario: actualiza campos de la dirección.'],
    ['/api/addresses/{id}','delete',204,'BUYER propietario: elimina lógicamente la dirección.'],
    ['/api/addresses/{id}/default','put',204,'BUYER propietario: establece la única dirección predeterminada activa.']
  ]) {
    const parameters = path.includes('{id}') ? [id] : [];
    if (method === 'post' || (method === 'put' && !path.endsWith('/default'))) {
      parameters.push({ name:'body',in:'body',required:true,schema:{type:'object',additionalProperties:false,
        minProperties:1,properties,...(method === 'post' && { required:Object.keys(lengths).filter(k => !['label','interiorNumber'].includes(k)) }) } });
    }
    const responses = { [status]:{ description:RESPONSE_DESCRIPTIONS[status],...(status !== 204 && {
      schema:method === 'get' ? {type:'array',items:ref} : ref }) } };
    for (const code of [400,401,403,404,500]) responses[code] = {description:RESPONSE_DESCRIPTIONS[code],schema:{$ref:'#/definitions/ErrorResponse'}};
    specification.paths[path] ||= {};
    specification.paths[path][method] = { description,parameters,security:[{bearerAuth:[]}],responses };
  }
}

function addCatalogOperations(paths) {
  const id = name => ({ name, in: 'path', required: true, type: 'integer', minimum: 1, maximum: 2147483647 });
  const productBody = { title: { type: 'string', maxLength: 255 }, description: { type: 'string', 'x-nullable': true },
    price: { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})(\\.[0-9]{1,2})?$', example: '12.50' },
    stock: { type: 'integer', minimum: 0, maximum: 4294967295 } };
  const body = (properties, required = []) => ({ name: 'body', in: 'body', required: true,
    schema: { type: 'object', additionalProperties: false, properties, required } });
  function define(path, method, description, parameters, success, schema, errors = []) {
    const responses = { [success]: { description: RESPONSE_DESCRIPTIONS[success], ...(schema && { schema }) } };
    for (const code of [400, 401, 403, 500, ...errors]) responses[code] = { description: RESPONSE_DESCRIPTIONS[code], schema: { $ref: '#/definitions/ErrorResponse' } };
    paths[path] ||= {};
    paths[path][method] = { description, parameters, security: [{ bearerAuth: [] }], responses };
  }
  const ref = name => ({ $ref: `#/definitions/${name}` });
  define('/api/products', 'get', 'Consulta productos activos de vendedores aprobados.',
    [{ name: 's', in: 'query', type: 'string', maxLength: 255 }], 200, { type: 'array', items: ref('Product') });
  define('/api/products/{id}', 'get', 'Consulta un producto activo.', [id('id')], 200, ref('Product'), [404]);
  define('/api/products', 'post', 'Crea un producto del vendedor autenticado y aprobado.',
    [body(productBody, ['title', 'price'])], 201, ref('Product'), [409]);
  define('/api/products/{id}', 'put', 'Edita precio, inventario o contenido de un producto propio.',
    [id('id'), body(productBody)], 204, null, [404, 409]);
  define('/api/products/{id}', 'delete', 'Oculta un producto propio mediante borrado lógico.', [id('id')], 204, null, [404]);
  define('/api/products/{id}/categories', 'post', 'Asocia o reactiva una categoría de un producto propio.',
    [id('id'), body({ categoryId: { type: 'integer', minimum: 1 } }, ['categoryId'])], 204, null, [404, 409]);
  define('/api/products/{id}/categories/{categoryId}', 'delete', 'Desasocia lógicamente una categoría.',
    [id('id'), id('categoryId')], 204, null, [404]);
  define('/api/products/{id}/image', 'put', 'Reemplaza la imagen de un producto propio. JPEG, PNG o WebP, hasta 2 MB.',
    [id('id'), { name: 'image', in: 'formData', type: 'file', required: true }], 200,
    { type: 'object', properties: { productId: { type: 'integer' }, imagePublicId: { type: 'string' }, imageUrl: { type: 'string', format: 'uri' } } }, [404, 409, 413, 502, 503]);
  paths['/api/products/{id}/image'].put.consumes = ['multipart/form-data'];
  define('/api/products/{id}/image', 'delete', 'Retira la referencia de imagen y programa su limpieza segura.', [id('id')], 204, null, [404]);
  define('/api/categories', 'get', 'Lista categorías activas.', [], 200, { type: 'array', items: ref('Category') });
  define('/api/categories/{id}', 'get', 'Consulta una categoría activa.', [id('id')], 200, ref('Category'), [404]);
  const category = body({ name: { type: 'string', minLength: 1, maxLength: 120 } }, ['name']);
  define('/api/categories', 'post', 'Crea una categoría como ADMIN.', [category], 201, ref('Category'), [409]);
  define('/api/categories/{id}', 'put', 'Renombra una categoría como ADMIN.', [id('id'), category], 204, null, [404, 409]);
  define('/api/categories/{id}', 'delete', 'Desactiva una categoría no protegida como ADMIN.', [id('id')], 204, null, [404]);
  for (const [method, path] of [['post', '/api/files'], ['put', '/api/files/{id}'], ['delete', '/api/files/{id}']]) {
    define(path, method, 'Operación histórica retirada. Use la imagen del producto.', method === 'post' ? [] : [id('id')], 410, ref('ErrorResponse'));
  }
  for(const path of ['/api/files','/api/files/{id}','/api/files/{id}/details','/api/roles']) {
    define(path,'get','Recurso histórico retirado.',path.includes('{id}')?[id('id')]:[],410,ref('ErrorResponse'));
    if(path==='/api/files/{id}') paths[path].get.security=[];
  }
}

function addAccountOperations(paths) {
  const email = { type: 'string', format: 'email', maxLength: 254 };
  const password = { type: 'string', format: 'password' };
  const newPassword = { ...password, minLength: 15, maxLength: 72,
    description: '15 caracteres Unicode como mínimo; 72 bytes UTF-8 como máximo. Sin truncamiento ni normalización. Se rechazan contraseñas comunes y repetitivas mediante una lista local acotada; no se consulta a terceros.',
    'x-max-utf8-bytes':72 };
  const name = { type: 'string', maxLength: 120 };
  const response = (status, schema) => ({ description: RESPONSE_DESCRIPTIONS[status],
    ...(schema && { schema: { $ref: `#/definitions/${schema}` } }) });
  const body = (properties, required) => ({ name: 'body', in: 'body', required: true,
    schema: { type: 'object', properties, ...(required && { required }) } });
  const pathParameter = (key, format) => ({ name: key, in: 'path', required: true, type: 'string', format });
  function define(path, method, description, parameters, success, schema, errors, authenticated = true) {
    const responses = { [success]: response(success, schema) };
    for (const status of [...errors, ...(authenticated ? [401, 403] : []), 500]) responses[status] = response(status, 'ErrorResponse');
    paths[path] ||= {};
    paths[path][method] = { description, parameters, security: authenticated ? [{ bearerAuth: [] }] : [], responses };
  }
  define('/api/auth', 'post', 'Inicia sesión con una cuenta activa y verificada.',
    [body({ email, password }, ['email', 'password'])], 200, 'LoginResponse', [400, 401, 429, 503], false);
  paths['/api/auth'].post.description += ' Emite RS256 de cinco minutos y refresh opaco; inactividad 30 minutos, máximo ocho horas. Cache-Control: no-store. Rechaza JWT HS256 antiguos.';
  paths['/api/auth'].post.parameters[0].schema.additionalProperties = false;
  define('/api/auth/refresh','post','Rota un refresh opaco una sola vez, sin exigir access token. Reutilización revoca toda la sesión; solicitudes simultáneas pueden revocar al ganador. Ante respuesta perdida o resultado incierto, iniciar sesión otra vez. Cache-Control: no-store.',
    [body({refreshToken:{type:'string',minLength:43,maxLength:43,pattern:'^[A-Za-z0-9_-]{43}$'}},['refreshToken'])],200,'LoginResponse',[400,401,429,503],false);
  paths['/api/auth/refresh'].post.parameters[0].schema.additionalProperties = false;
  define('/api/auth/logout','post','Revoca solo la sesión del Bearer RS256 vigente, sin cuerpo ni identificadores ajenos. Access y refresh dejan de funcionar. Repetir con sesión revocada devuelve 401.',[],204,null,[400,429,503]);
  define('/api/auth/register', 'post', 'Solicita un código de verificación por correo.',
    [body({ email }, ['email'])], 202, 'VerificationRequested', [400, 429, 503], false);
  define('/api/auth/register/verify', 'post', 'Verifica el correo y crea la cuenta. SELLER requiere storeName.',
    [body({ email, code: { type: 'string', pattern: '^\\d{6}$' }, name, password: newPassword, storeName: name,
      profile: { type: 'string', enum: ['SELLER', 'BUYER'] } }, ['email', 'code', 'name', 'password', 'profile'])],
    201, 'User', [400, 409, 429, 503], false);
  for(const path of ['/api/auth','/api/auth/register','/api/auth/register/verify']) paths[path].post.description+=' Límite compartido: 30 solicitudes por IP y minuto, además de los límites del código de verificación.';
  define('/api/auth/time', 'get', 'Consulta el tiempo restante del JWT.', [], 200, 'SessionTime', []);
  define('/api/users', 'get', 'Lista cuentas para administración.', [], 200, null, []);
  paths['/api/users'].get.responses[200].schema = { type: 'array', items: { $ref: '#/definitions/User' } };
  const user = [pathParameter('email', 'email')];
  define('/api/users/{email}', 'get', 'Consulta una cuenta por correo.', user, 200, 'User', [400, 404]);
  define('/api/users/{email}', 'put', 'Actualiza datos o estado sin cambiar el perfil. Cambiar password revoca todas las sesiones antes del commit SQL; un rollback no restaura sesiones: autenticar otra vez.',
    [...user, body({ name, password: newPassword, status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DISABLED'] } })], 204, null, [400, 404]);
  paths['/api/users/{email}'].put.parameters.at(-1).schema.additionalProperties = false;
  define('/api/users/{email}', 'delete', 'Cierra una cuenta mediante borrado lógico.', user, 204, null, [400, 404]);
  define('/api/users/sellers/{userId}/review', 'put', 'Revisa una solicitud PENDING. REJECTED requiere rejectionReason.',
    [pathParameter('userId', 'uuid'), body({ status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
      rejectionReason: { type: 'string', maxLength: 255 } }, ['status'])], 200, 'SellerReview', [400, 404, 409]);
  define('/api/users/sellers/{userId}/suspend','put',
    'ADMIN activo: suspende únicamente APPROVED → SUSPENDED. reason es obligatorio, sin secretos. Registra actor, fecha y motivo sanitizado en la misma transacción. Revoca operaciones comerciales y oculta sus productos; conserva pedidos y snapshots. No reactiva vendedores.',
    [pathParameter('userId','uuid'),body({reason:{type:'string',minLength:1,maxLength:255,example:'Incumplimiento de las condiciones de venta.'}},['reason'])],
    200,'SellerSuspension',[400,404,409]);
  paths['/api/users/sellers/{userId}/suspend'].put.parameters.at(-1).schema.additionalProperties=false;
}

module.exports = { completeSpecification };
