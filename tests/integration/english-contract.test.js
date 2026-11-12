const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const app = require('../../index');
const { Category, Product, User, AuditLog } = require('../../models');
const { generateToken, mockAccountLookups } = require('../support/auth-fixtures');
const catalog = require('../../services/catalog.service');

beforeEach(mockAccountLookups);

describe('Contrato HTTP normalizado al inglés', () => {
  const token = generateToken('admin@example.com', 'Administrador de prueba', 'Administrador');
  let specification;

  beforeAll(() => {
    const outputFile = path.resolve(__dirname, `../../.swagger-contract-${process.pid}.json`);
    try {
      execFileSync(process.execPath, ['-e', "require('./swagger').generateDocumentation(process.argv[1]).catch(error => { console.error(error); process.exitCode = 1; })", outputFile], {
        cwd: path.resolve(__dirname, '../..'), stdio: 'pipe'
      });
      specification = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } finally {
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    }
  });

  beforeEach(() => {
    jest.spyOn(AuditLog, 'create').mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('acepta name y conserva los mensajes de validación en español', async () => {
    const create = jest.spyOn(catalog, 'mutateCategory').mockResolvedValue({ id: 10, name: 'Accesorios', protected: false });
    const created = await request(app).post('/api/categories').set('Authorization', `Bearer ${token}`).send({ name: 'Accesorios' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ categoryId: 10, name: 'Accesorios', protected: false });
    expect(create).toHaveBeenCalledWith(expect.any(Object), null, 'Accesorios',false,{ipAddress:expect.any(String)});
    const invalid = await request(app).post('/api/categories').set('Authorization', `Bearer ${token}`).send({ name: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain('name');
  });

  it('documenta los campos de catálogo administrados por el vendedor', () => {
    const properties = specification.paths['/api/products'].post.parameters[0].schema.properties;
    expect(Object.keys(properties).sort()).toEqual(['description', 'price', 'stock', 'title']);
    expect(specification.definitions.Product.properties).not.toHaveProperty('fileId');
  });

  it('consulta los perfiles y excluye el hash por defecto', async () => {
    const findAll = jest.spyOn(User, 'findAll').mockResolvedValue([]);
    const response = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const query = findAll.mock.calls[0][0];
    expect(query.include.map(item => item.association)).toEqual(['admin', 'seller', 'buyer']);
    expect(User.options.defaultScope.attributes.exclude).toContain('passwordHash');
  });

  it.each(['/api/categorias', '/api/productos', '/api/usuarios', '/api/archivos', '/api/bitacora', '/api/auth/tiempo'])(
    'devuelve 404 para el contrato histórico %s', async apiPath => {
      const response = await request(app).get(apiPath);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Recurso no encontrado' });
    }
  );

  it('documenta rutas, campos, archivos multipart y respuestas en español en Swagger', () => {
    expect(specification.paths['/api/auth/time'].get.responses[200].schema.$ref).toBe('#/definitions/SessionTime');
    expect(specification.paths['/api/files/{id}/details'].get.responses[410]).toBeDefined();
    expect(specification.paths['/api/products/{id}/categories'].post.parameters.find(item => item.in === 'body').schema.properties).toEqual({ categoryId: expect.any(Object) });
    expect(specification.paths['/api/products/{id}/image'].put.parameters).toContainEqual(expect.objectContaining({ name: 'image', type: 'file', in: 'formData' }));
    expect(specification.paths['/api/files'].post.responses[410]).toBeDefined();
    expect(specification.paths['/api/users'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(specification.paths['/api/auth/register/verify'].post.security).toEqual([]);
    expect(specification.paths['/api/users/sellers/{userId}/review'].put.security).toEqual([{ bearerAuth: [] }]);
    expect(specification.paths['/api/files/{id}'].get.security).toEqual([]);
    expect(specification.paths['/api/products'].get.responses[401].description).toMatch(/^Autenticación/);
    expect(specification.definitions.AuditLog.properties).toEqual(expect.objectContaining({ action: expect.any(Object), actorUserId: expect.any(Object), occurredAt: expect.any(Object) }));
  });
});
