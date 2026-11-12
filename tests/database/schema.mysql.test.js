const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const Sequelize = require('sequelize');
const bcrypt = require('bcrypt');

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
    const target = command === 'db:migrate' ? ['--to', '20261108000001-normalize-english-schema.js'] : [];
    execFileSync(process.execPath, ['node_modules/sequelize-cli/lib/sequelize', command, '--env', 'test', ...target], {
      cwd: rootDirectory,
      env: {
        ...process.env, TEST_DB_HOST: url.hostname, TEST_DB_PORT: url.port || '3306',
        TEST_DB_USER: decodeURIComponent(url.username), TEST_DB_PASSWORD: decodeURIComponent(url.password),
        TEST_DB_DATABASE: databaseName,
        LEGACY_SEED_USER_PASSWORD: require('node:crypto').randomBytes(32).toString('hex')
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
    const [product] = await connection.query(`SELECT p.title, p.price, f.data, c.name AS categoryName
      FROM products p JOIN files f ON f.id = p.fileId JOIN product_categories pc ON pc.productId = p.id
      JOIN categories c ON c.id = pc.categoryId WHERE p.id = 101`, { type: Sequelize.QueryTypes.SELECT });
    expect(product.title).toBe('Producto persistido');
    expect(product.price).toBe('123.45');
    expect(product.data).toEqual(Buffer.from([255, 216, 255, 224]));
    expect(product.categoryName).toBe('Categoría persistida');
    const readHistoricalUser = async () => (await connection.query(`SELECT u.name, u.passwordHash, u.protected,
      r.name AS role FROM users u JOIN roles r ON r.id = u.roleId WHERE u.id = :userId`,
    { replacements: { userId }, type: Sequelize.QueryTypes.SELECT }))[0];
    const user = await readHistoricalUser();
    expect(user.passwordHash).toBe(passwordHash);
    expect(Number(user.protected)).toBe(1);
    expect(user.role).toBe('Administrador');
    expect((await connection.query('SELECT `user` FROM audit_logs WHERE id = 101', { type: Sequelize.QueryTypes.SELECT }))[0].user).toBe('gvera@uv.mx');
    runCli('db:migrate:undo', databaseName);
    expect(await readSnapshot(connection, tables)).toEqual(original);
    runCli('db:migrate', databaseName);
    runCli('db:seed:all', databaseName);
    runCli('db:seed:all', databaseName);
    expect((await readHistoricalUser()).passwordHash).toBe(passwordHash);
    expect((await readHistoricalUser()).name).toBe('Persona existente');
  }, 90000);

  it('inicializa una base histórica nueva y repite sus seeders sin duplicados', async () => {
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
