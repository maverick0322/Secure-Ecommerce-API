const request = require('supertest');
const app = require('../../index');

function loadAppWithEnv(envOverrides = {}) {
  const saved = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    let isolatedApp;
    jest.isolateModules(() => {
      isolatedApp = require('../../index');
    });
    return isolatedApp;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('Pruebas de Integración: Cabeceras de Seguridad y Enrutamiento Base', () => {
  it('CWE-200: la cabecera X-Powered-By no debe ser expuesta en las respuestas HTTP', async () => {
    const res = await request(app).get('/api/ruta-inexistente');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('SEC-05: incluye cabeceras defensivas helmet (nosniff, Referrer-Policy, X-Frame-Options y CSP mínima)', async () => {
    const res = await request(app).get('/api/ruta-inexistente');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it.each([
    '/api/users',
    '/api/users/me',
    '/api/addresses',
    '/api/orders',
    '/api/cart',
    '/api/checkout',
    '/api/audit-logs',
    '/api/auth/time'
  ])('SEC-05: establece Cache-Control: no-store en ruta sensible %s', async route => {
    const res = await request(app).get(route);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('SEC-05: establece Cache-Control: no-store en cualquier petición con cabecera Authorization', async () => {
    const res = await request(app).get('/api/products').set('Authorization', 'Bearer invalid.token.value');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('debe responder con 404 y JSON consistente ante rutas no encontradas (GET)', async () => {
    const res = await request(app).get('/api/recurso-inexistente');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      message: 'Recurso no encontrado'
    });
  });

  it('debe responder con 404 y JSON consistente ante rutas no encontradas (POST)', async () => {
    const res = await request(app).post('/api/endpoint-fantasma').send({});
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      message: 'Recurso no encontrado'
    });
  });

  it('CORS: deniega todos los orígenes por defecto cuando CORS_ORIGIN está vacío', async () => {
    const isolatedApp = loadAppWithEnv({ CORS_ORIGIN: '' });
    const res = await request(isolatedApp)
      .options('/api/categories')
      .set('Origin', 'http://localhost:8080')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-expose-headers']).toBeUndefined();
  });

  it('CORS: permite únicamente orígenes configurados vía CORS_ORIGIN y no expone cabeceras de renovación automática', async () => {
    const isolatedApp = loadAppWithEnv({ CORS_ORIGIN: 'https://shop.example.com' });
    const allowed = await request(isolatedApp)
      .options('/api/categories')
      .set('Origin', 'https://shop.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://shop.example.com');
    expect(allowed.headers['access-control-expose-headers']).toBeUndefined();

    const denied = await request(isolatedApp)
      .options('/api/categories')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS: rechaza comodín * al arrancar', () => {
    expect(() => loadAppWithEnv({ CORS_ORIGIN: '*' })).toThrow(/wildcard access is forbidden/i);
  });

  it('SEC-06: /swagger responde 404 cuando NODE_ENV === production', async () => {
    const prodApp = loadAppWithEnv({ NODE_ENV: 'production', CORS_ORIGIN: '' });
    const res = await request(prodApp).get('/swagger');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ message: 'Recurso no encontrado' });

    const resSlash = await request(prodApp).get('/swagger/');
    expect(resSlash.statusCode).toBe(404);
  });

  it('SEC-06: /swagger permanece disponible cuando NODE_ENV !== production', async () => {
    const devApp = loadAppWithEnv({ NODE_ENV: 'development', CORS_ORIGIN: '' });
    const res = await request(devApp).get('/swagger/');
    expect([200, 503]).toContain(res.statusCode);
  });

  it('SEC-11: GET /health responde 200 sin autenticación y sin exponer datos internos', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
