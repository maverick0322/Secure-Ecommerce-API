const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const Sequelize = require('sequelize');
const bcrypt = require('bcrypt');
const request = require('supertest');

// Pruebas opcionales: crean y eliminan únicamente bases temporales propias.
const databaseTests = process.env.TEST_MYSQL_URL ? describe : describe.skip;
const rootDirectory = path.resolve(__dirname, '../..');
const historicalMigrations = fs.readdirSync(path.join(rootDirectory, 'migrations'))
  .filter(file => file.startsWith('2024')).sort();

databaseTests('Migración y contratos con MySQL 8 real', () => {
  let server;
  const createdDatabases = new Set();
  const connections = [];

  beforeAll(async () => {
    server = await mysql.createConnection(process.env.TEST_MYSQL_URL);
  });

  afterAll(async () => {
    await Promise.all(connections.map(connection => connection.close()));
    if (server) {
      for (const databaseName of createdDatabases) {
        await server.query(`DROP DATABASE \`${databaseName}\``);
      }
      await server.end();
    }
  });

  async function createDatabase() {
    const databaseName = `backend_names_test_${process.pid}_${Date.now()}`;
    await server.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`);
    createdDatabases.add(databaseName);
    const url = new URL(process.env.TEST_MYSQL_URL);
    url.pathname = `/${databaseName}`;
    const connection = new Sequelize(url.toString(), { logging: false });
    connections.push(connection);
    return { connection, databaseName };
  }

  function runCli(command, databaseName) {
    const url = new URL(process.env.TEST_MYSQL_URL);
    execFileSync(process.execPath, ['node_modules/sequelize-cli/lib/sequelize', command, '--env', 'test'], {
      cwd: rootDirectory,
      env: {
        ...process.env, TEST_DB_HOST: url.hostname, TEST_DB_PORT: url.port || '3306',
        TEST_DB_USER: decodeURIComponent(url.username), TEST_DB_PASSWORD: decodeURIComponent(url.password),
        TEST_DB_DATABASE: databaseName
      },
      timeout: 60000, stdio: 'pipe'
    });
  }

  async function readSnapshot(connection, tables) {
    const result = {};
    for (const tableName of tables) {
      result[tableName] = await connection.query(`SELECT * FROM \`${tableName}\``, {
        type: Sequelize.QueryTypes.SELECT
      });
    }
    return result;
  }

  it('migra una base histórica registrada, conserva datos y permite revertir y volver a migrar', async () => {
    const { connection, databaseName } = await createDatabase();
    const queryInterface = connection.getQueryInterface();
    for (const file of historicalMigrations) {
      await require(path.join(rootDirectory, 'migrations', file)).up(queryInterface, Sequelize);
    }
    await queryInterface.createTable('SequelizeMeta', { name: { type: Sequelize.STRING, primaryKey: true } });
    await queryInterface.bulkInsert('SequelizeMeta', historicalMigrations.map(name => ({ name })));
    const timestamps = { createdAt: new Date('2026-01-01T12:00:00Z'), updatedAt: new Date('2026-01-01T12:00:00Z') };
    const roleId = '09e30209-acbf-4391-baea-c719dd271c5f';
    const userId = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
    const passwordHash = await bcrypt.hash('contraseña-existente', 10);
    // Los campos en español reproducen exclusivamente el contrato histórico.
    await queryInterface.bulkInsert('archivo', [{ id: 101, mime: 'image/jpeg', nombre: 'imagen.jpg', indb: true, datos: Buffer.from([255, 216, 255, 224]), size: 4, ...timestamps }]);
    await queryInterface.bulkInsert('rol', [{ id: roleId, nombre: 'Administrador', ...timestamps }]);
    await queryInterface.bulkInsert('categoria', [{ id: 101, nombre: 'Categoría persistida', protegida: true, ...timestamps }]);
    await queryInterface.bulkInsert('producto', [{ id: 101, titulo: 'Producto persistido', descripcion: 'Conservar descripción', precio: '123.45', archivoid: 101, ...timestamps }]);
    await queryInterface.bulkInsert('categoriaproducto', [{ categoriaid: 101, productoid: 101, ...timestamps }]);
    await queryInterface.bulkInsert('usuario', [{ id: userId, email: 'gvera@uv.mx', nombre: 'Persona existente', passwordhash: passwordHash, rolid: roleId, protegido: true, ...timestamps }]);
    await queryInterface.bulkInsert('bitacora', [{ id: 101, accion: 'usuario.login', elementoid: '101', usuario: 'gvera@uv.mx', ip: '127.0.0.1', fecha: timestamps.createdAt, ...timestamps }]);
    const tables = ['archivo', 'rol', 'categoria', 'producto', 'categoriaproducto', 'usuario', 'bitacora'];
    const original = await readSnapshot(connection, tables);

    runCli('db:migrate', databaseName);
    expect((await queryInterface.showAllTables()).map(table => table.toLowerCase())).toEqual(expect.arrayContaining([
      'files', 'roles', 'categories', 'products', 'product_categories', 'users', 'audit_logs', 'sequelizemeta'
    ]));
    const models = {};
    for (const filename of fs.readdirSync(path.join(rootDirectory, 'models')).filter(file => file !== 'index.js')) {
      const model = require(path.join(rootDirectory, 'models', filename))(connection, Sequelize.DataTypes);
      models[model.name] = model;
    }
    for (const model of Object.values(models)) if (model.associate) model.associate(models);
    const product = await models.Product.findByPk(101, { include: ['categories', 'file'] });
    expect(product.title).toBe('Producto persistido');
    expect(product.price).toBe('123.45');
    expect(product.file.data).toEqual(Buffer.from([255, 216, 255, 224]));
    expect(product.categories[0].name).toBe('Categoría persistida');
    await product.removeCategory(101);
    await product.addCategory(101);
    // Restaurar fechas originales del vínculo para comparar la reversión exacta.
    await queryInterface.bulkUpdate('product_categories', timestamps, { productId: 101, categoryId: 101 });
    const user = await models.User.findByPk(userId, { include: ['role'] });
    expect(user.passwordHash).toBe(passwordHash);
    expect(user.protected).toBe(true);
    expect(user.role.name).toBe('Administrador');
    expect((await models.Role.findByPk(roleId, { include: ['users'] })).users).toHaveLength(1);
    expect((await models.Category.findByPk(101, { include: ['products'] })).products).toHaveLength(1);
    expect((await models.File.findByPk(101, { include: ['products'] })).products).toHaveLength(1);
    expect((await models.AuditLog.findByPk(101)).user).toBe('gvera@uv.mx');
    runCli('db:migrate:undo', databaseName);
    expect(await readSnapshot(connection, tables)).toEqual(original);
    runCli('db:migrate', databaseName);
    runCli('db:seed:all', databaseName);
    runCli('db:seed:all', databaseName);
    expect((await models.User.findByPk(userId)).passwordHash).toBe(passwordHash);
    expect((await models.User.findByPk(userId)).name).toBe('Persona existente');
  }, 90000);

  it('inicializa una base nueva, repite seeders sin duplicados y sirve contratos HTTP reales', async () => {
    const { connection, databaseName } = await createDatabase();
    runCli('db:migrate', databaseName);
    runCli('db:seed:all', databaseName);
    const tables = ['files', 'roles', 'categories', 'products', 'product_categories', 'users', 'audit_logs'];
    const firstSeed = await readSnapshot(connection, tables);
    runCli('db:seed:all', databaseName);
    expect(await readSnapshot(connection, tables)).toEqual(firstSeed);
    expect(firstSeed.categories).toHaveLength(15);
    expect(firstSeed.products).toHaveLength(15);
    expect(firstSeed.product_categories).toHaveLength(15);
    expect(firstSeed.roles).toHaveLength(2);
    expect(firstSeed.users).toHaveLength(2);

    const url = new URL(process.env.TEST_MYSQL_URL);
    const previousEnv = { ...process.env };
    Object.assign(process.env, {
      TEST_DB_HOST: url.hostname, TEST_DB_PORT: url.port || '3306',
      TEST_DB_USER: decodeURIComponent(url.username), TEST_DB_PASSWORD: decodeURIComponent(url.password),
      TEST_DB_DATABASE: databaseName
    });
    jest.resetModules();
    const app = require('../../index');
    const models = require('../../models');
    try {
      const login = await request(app).post('/api/auth').send({ email: 'gvera@uv.mx', password: 'patito' });
      expect(login.status).toBe(200);
      expect(login.body).toEqual({ email: 'gvera@uv.mx', name: 'Guillermo Vera', role: 'Administrador', jwt: expect.any(String) });
      const token = login.body.jwt;
      const products = await request(app).get('/api/products').set('Authorization', `Bearer ${token}`);
      expect(products.status).toBe(200);
      expect(products.body[0]).toEqual(expect.objectContaining({ productId: expect.any(Number), title: expect.any(String), price: expect.any(String), categories: expect.any(Array) }));
      const users = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
      expect(users.status).toBe(200);
      expect(users.body[0].role).toEqual(expect.any(String));
      expect(users.body[0].passwordHash).toBeUndefined();
      const logs = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${token}`);
      expect(logs.status).toBe(200);
      expect(logs.body[0]).toEqual(expect.objectContaining({ action: 'usuario.login', user: 'gvera@uv.mx' }));
      const time = await request(app).get('/api/auth/time').set('Authorization', `Bearer ${token}`);
      expect(time.status).toBe(200);
      expect(time.body.remainingTime).toMatch(/^00:\d{2}:\d{2}$/);
    } finally {
      await models.sequelize.close();
      process.env = previousEnv;
    }
  }, 90000);

  it('reanuda migraciones y reversiones interrumpidas entre instrucciones DDL', async () => {
    const { connection, databaseName } = await createDatabase();
    runCli('db:migrate', databaseName);
    runCli('db:migrate:undo', databaseName);
    const migration = require('../../migrations/20261108000001-normalize-english-schema');
    const queryInterface = connection.getQueryInterface();

    async function interruptColumnRename(direction) {
      const originalQuery = connection.query.bind(connection);
      let columnRenames = 0;
      const spy = jest.spyOn(connection, 'query').mockImplementation((sql, options) => {
        if (typeof sql === 'string' && sql.includes('RENAME COLUMN') && ++columnRenames === 5) {
          throw new Error('Interrupción simulada de DDL');
        }
        return originalQuery(sql, options);
      });
      try {
        await expect(migration[direction](queryInterface, Sequelize)).rejects.toThrow('Interrupción simulada');
      } finally {
        spy.mockRestore();
      }
      await migration[direction](queryInterface, Sequelize);
    }

    await interruptColumnRename('up');
    expect(await queryInterface.describeTable('products')).toHaveProperty('fileId');
    await interruptColumnRename('down');
    expect(await queryInterface.describeTable('producto')).toHaveProperty('archivoid');
    await migration.up(queryInterface, Sequelize);
    // Una segunda ejecución no cambia ni duplica el esquema ya normalizado.
    await migration.up(queryInterface, Sequelize);
    expect(await queryInterface.describeTable('users')).toHaveProperty('passwordHash');
  }, 90000);
});
