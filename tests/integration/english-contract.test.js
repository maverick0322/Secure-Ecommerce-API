const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const app = require('../../index');
const { Category, Product, User, AuditLog } = require('../../models');
const { generateToken } = require('../../services/jwttoken.service');

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
    const create = jest.spyOn(Category, 'create').mockImplementation(async values => ({ id: 10, ...values }));
    const created = await request(app).post('/api/categories').set('Authorization', `Bearer ${token}`).send({ name: 'Accesorios' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: 10, name: 'Accesorios', protected: false });
    expect(create).toHaveBeenCalledWith({ name: 'Accesorios', protected: false });
    const invalid = await request(app).post('/api/categories').set('Authorization', `Bearer ${token}`).send({ name: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe('Errores de validación en la solicitud.');
    expect(invalid.body.errors[0]).toEqual(expect.objectContaining({ path: 'name', msg: 'El campo name es obligatorio.' }));
  });

  it('limita los cambios del producto a title, description, price y fileId', async () => {
    jest.spyOn(Product, 'findByPk').mockResolvedValue({ id: 1, fileId: 4 });
    const update = jest.spyOn(Product, 'update').mockResolvedValue([1]);
    const response = await request(app).put('/api/products/1').set('Authorization', `Bearer ${token}`).send({
      title: 'Teclado', description: 'Teclado mecánico', price: '950.00', protected: true, id: 999
    });
    expect(response.status).toBe(204);
    expect(update).toHaveBeenCalledWith({ title: 'Teclado', description: 'Teclado mecánico', price: '950.00', fileId: 4 }, { where: { id: '1' } });
  });

  it('solicita la asociación role y excluye el hash en las consultas de usuarios', async () => {
    const findAll = jest.spyOn(User, 'findAll').mockResolvedValue([]);
    const response = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const query = findAll.mock.calls[0][0];
    expect(query.attributes).toEqual(['id', 'email', 'name', 'protected', [expect.any(Object), 'role']]);
    expect(query.include.as).toBe('role');
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
    expect(specification.paths['/api/files/{id}/details'].get.responses[200].schema.$ref).toBe('#/definitions/FileMetadata');
    expect(specification.paths['/api/products/{id}/categories'].post.parameters.find(item => item.in === 'body').schema.properties).toEqual({ categoryId: expect.any(Object) });
    expect(specification.paths['/api/files'].post.parameters).toContainEqual(expect.objectContaining({ name: 'file', type: 'file', in: 'formData' }));
    expect(specification.paths['/api/users'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(specification.paths['/api/files/{id}'].get.security).toEqual([]);
    expect(specification.paths['/api/products'].get.responses[401].description).toMatch(/^Autenticación/);
    expect(specification.definitions.AuditLog.properties).toEqual(expect.objectContaining({ action: expect.any(Object), user: expect.any(Object), date: expect.any(Object) }));
  });
});
