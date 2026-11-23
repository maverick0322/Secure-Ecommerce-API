'use strict';

const { select, requireTarget, characterOptions } = require('./support/secure-ecommerce');

async function describeDescriptionColumn(queryInterface) {
  const [column] = await select(queryInterface, `
    SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable,
           CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'description'`);
  return column || null;
}

module.exports = {
  async up(queryInterface) {
    await requireTarget(queryInterface);

    const column = await describeDescriptionColumn(queryInterface);
    if (!column) {
      throw new Error('Cannot set products.description to NOT NULL: column products.description does not exist.');
    }

    const [countRow] = await select(queryInterface, `
      SELECT COUNT(*) AS total
      FROM products
      WHERE description IS NULL OR TRIM(description) = ''`);

    const total = Number(countRow?.total || 0);
    if (total > 0) {
      const sample = await select(queryInterface, `
        SELECT id
        FROM products
        WHERE description IS NULL OR TRIM(description) = ''
        ORDER BY id ASC
        LIMIT 5`);
      const sampleIds = sample.map(row => row.id).join(', ');
      throw new Error(
        `Cannot set products.description to NOT NULL: found ${total} product row(s) with NULL or empty description (sample ids: ${sampleIds}). Populate or remove invalid rows before migrating.`
      );
    }

    if (column.isNullable === 'NO') {
      return;
    }

    await queryInterface.sequelize.query(
      `ALTER TABLE products\n  MODIFY COLUMN \`description\` TEXT ${characterOptions(column)} NOT NULL`
    );
  },

  async down(queryInterface) {
    await requireTarget(queryInterface);

    const column = await describeDescriptionColumn(queryInterface);
    if (!column || column.isNullable === 'YES') {
      return;
    }

    await queryInterface.sequelize.query(
      `ALTER TABLE products\n  MODIFY COLUMN \`description\` TEXT ${characterOptions(column)} NULL`
    );
  }
};
