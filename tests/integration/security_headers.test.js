const request = require('supertest');
const app = require('../../index');

describe('Pruebas de Integración: Cabeceras de Seguridad y Enrutamiento Base', () => {
  it('CWE-200: la cabecera X-Powered-By no debe ser expuesta en las respuestas HTTP', async () => {
    const res = await request(app).get('/api/ruta-inexistente');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('debe responder con 404 y JSON consistente ante rutas no encontradas (GET)', async () => {
    const res = await request(app).get('/api/recurso-inexistente');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ mensaje: 'Recurso no encontrado' });
  });

  it('debe responder con 404 y JSON consistente ante rutas no encontradas (POST)', async () => {
    const res = await request(app).post('/api/endpoint-fantasma').send({});
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ mensaje: 'Recurso no encontrado' });
  });

  it('CORS: debe exponer la cabecera Set-Authorization en peticiones de orígenes permitidos', async () => {
    const res = await request(app)
      .options('/api/categorias')
      .set('Origin', 'http://localhost:8080')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(res.headers['access-control-expose-headers']).toContain('Set-Authorization');
  });
});
