'use strict';

// Las migraciones de 2024 son históricas: sus nombres y contenidos se conservan.
// MySQL 8 confirma cada DDL implícitamente. Las comprobaciones permiten reanudar
// esta migración después de una interrupción, sin copiar ni eliminar registros.
const TABLE_RENAMES = [
  ['archivo', 'files', [['nombre', 'name'], ['indb', 'storedInDatabase'], ['datos', 'data']]],
  ['rol', 'roles', [['nombre', 'name']]],
  ['categoria', 'categories', [['nombre', 'name'], ['protegida', 'protected']]],
  ['producto', 'products', [['titulo', 'title'], ['descripcion', 'description'], ['precio', 'price'], ['archivoid', 'fileId']]],
  ['categoriaproducto', 'product_categories', [['categoriaid', 'categoryId'], ['productoid', 'productId']]],
  ['usuario', 'users', [['passwordhash', 'passwordHash'], ['nombre', 'name'], ['protegido', 'protected'], ['rolid', 'roleId']]],
  ['bitacora', 'audit_logs', [['accion', 'action'], ['elementoid', 'elementId'], ['usuario', 'user'], ['fecha', 'date']]]
];

const FOREIGN_KEY_RENAMES = [
  ['products', 'fileId', 'products_file_id_fk', 'producto_ibfk_1'],
  ['product_categories', 'categoryId', 'product_categories_category_id_fk', 'categoriaproducto_ibfk_1'],
  ['product_categories', 'productId', 'product_categories_product_id_fk', 'categoriaproducto_ibfk_2'],
  ['users', 'roleId', 'users_role_id_fk', 'usuario_ibfk_1']
];

async function renameForeignKeys(queryInterface, Sequelize, reverse) {
  const quote = value => queryInterface.queryGenerator.quoteIdentifier(value);
  for (const [tableName, columnName, englishName, historicalName] of FOREIGN_KEY_RENAMES) {
    // Se leen las reglas reales para preservar incluso restricciones personalizadas.
    const references = await queryInterface.sequelize.query(`
      SELECT k.CONSTRAINT_NAME AS constraintName, k.COLUMN_NAME AS columnName,
             k.REFERENCED_TABLE_SCHEMA AS referencedTableSchema,
             k.REFERENCED_TABLE_NAME AS referencedTableName,
             k.REFERENCED_COLUMN_NAME AS referencedColumnName,
             r.UPDATE_RULE AS updateRule, r.DELETE_RULE AS deleteRule
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
       AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME = :tableName
      ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
    `, { replacements: { tableName }, type: Sequelize.QueryTypes.SELECT });

    const targetName = reverse ? historicalName : englishName;
    const reference = references.find(item => item.columnName === columnName);
    if (!reference || reference.constraintName === targetName) continue;
    const columns = references.filter(item => item.constraintName === reference.constraintName);
    const allowedRules = ['CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL', 'SET DEFAULT'];
    if (!allowedRules.includes(reference.updateRule) || !allowedRules.includes(reference.deleteRule)) {
      throw new Error(`Reglas de clave foránea no reconocidas en ${tableName}.`);
    }
    // Un único ALTER conserva la validación referencial durante el cambio de nombre.
    await queryInterface.sequelize.query(
      `ALTER TABLE ${quote(tableName)} DROP FOREIGN KEY ${quote(reference.constraintName)}, ` +
      `ADD CONSTRAINT ${quote(targetName)} FOREIGN KEY (${columns.map(item => quote(item.columnName)).join(', ')}) ` +
      `REFERENCES ${quote(reference.referencedTableSchema)}.${quote(reference.referencedTableName)} (${columns.map(item => quote(item.referencedColumnName)).join(', ')}) ` +
      `ON UPDATE ${reference.updateRule} ON DELETE ${reference.deleteRule}`
    );
  }
}

async function renameSchema(queryInterface, Sequelize, reverse) {
  const quote = value => queryInterface.queryGenerator.quoteIdentifier(value);
  const tableNames = new Set(await queryInterface.showAllTables());
  const plan = TABLE_RENAMES.map(([historicalName, englishName, columns]) => ({
    source: reverse ? englishName : historicalName,
    target: reverse ? historicalName : englishName,
    columns: columns.map(([historicalColumn, englishColumn]) => reverse
      ? [englishColumn, historicalColumn] : [historicalColumn, englishColumn])
  }));

  // Validar todo antes del primer DDL para no mezclar esquemas incompatibles.
  for (const step of plan) {
    const sourceExists = tableNames.has(step.source);
    const targetExists = tableNames.has(step.target);
    if (sourceExists === targetExists) {
      throw new Error(`Se esperaba una sola tabla entre ${step.source} y ${step.target}; revise el esquema antes de migrar.`);
    }
    step.current = sourceExists ? step.source : step.target;
    step.description = await queryInterface.describeTable(step.current);
    for (const [source, target] of step.columns) {
      if (Object.hasOwn(step.description, source) === Object.hasOwn(step.description, target)) {
        throw new Error(`Se esperaba una sola columna entre ${source} y ${target} en ${step.current}.`);
      }
    }
  }

  // En la reversión, las restricciones se renombran antes de las tablas/columnas.
  // Se usa el esquema inglés, también cuando se reanuda una reversión parcial.
  if (reverse) {
    const englishTables = FOREIGN_KEY_RENAMES.map(([table]) => table);
    if (englishTables.every(table => tableNames.has(table))) {
      await renameForeignKeys(queryInterface, Sequelize, true);
    }
  }
  for (const step of plan) {
    if (step.current === step.source) await queryInterface.renameTable(step.source, step.target);
    for (const [source, target] of step.columns) {
      if (Object.hasOwn(step.description, source)) {
        // RENAME COLUMN preserva tipos, valores, índices y referencias en MySQL 8.
        await queryInterface.sequelize.query(
          `ALTER TABLE ${quote(step.target)} RENAME COLUMN ${quote(source)} TO ${quote(target)}`
        );
      }
    }
  }
  if (!reverse) await renameForeignKeys(queryInterface, Sequelize, false);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await renameSchema(queryInterface, Sequelize, false);
  },
  async down(queryInterface, Sequelize) {
    await renameSchema(queryInterface, Sequelize, true);
  }
};
