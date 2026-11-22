'use strict';

const { select, requireTarget } = require('./support/secure-ecommerce');

const INDEX_NAME = 'categories_normalized_name_unique';

module.exports = {
  async up(queryInterface) {
    await requireTarget(queryInterface);

    const existing = await select(queryInterface, `
      SELECT COLUMN_NAME AS name
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'normalizedName'`);

    if (existing.length > 0) {
      return;
    }

    const duplicates = await select(queryInterface, `
      SELECT LOWER(TRIM(REGEXP_REPLACE(name, '[[:space:]]+', ' '))) AS norm, COUNT(*) AS cnt
      FROM categories
      GROUP BY norm
      HAVING cnt > 1`);

    if (duplicates.length > 0) {
      const sample = duplicates.slice(0, 5).map(row => `"${row.norm}" (${row.cnt})`).join(', ');
      throw new Error(
        `Cannot add categories.normalizedName unique constraint: normalized duplicate category names found (${sample}). Resolve duplicates before migrating.`
      );
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE categories
        ADD COLUMN \`normalizedName\` VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
          GENERATED ALWAYS AS (LOWER(TRIM(REGEXP_REPLACE(\`name\`, '[[:space:]]+', ' ')))) STORED NOT NULL,
        ADD UNIQUE KEY \`${INDEX_NAME}\` (\`normalizedName\`)`);
  },

  async down(queryInterface) {
    await requireTarget(queryInterface);

    const indexes = await select(queryInterface, `
      SELECT INDEX_NAME AS name
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND INDEX_NAME = :indexName`,
    { indexName: INDEX_NAME });

    const columns = await select(queryInterface, `
      SELECT COLUMN_NAME AS name
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'normalizedName'`);

    const clauses = [];
    if (indexes.length > 0) clauses.push(`DROP INDEX \`${INDEX_NAME}\``);
    if (columns.length > 0) clauses.push('DROP COLUMN `normalizedName`');

    if (clauses.length > 0) {
      await queryInterface.sequelize.query(`ALTER TABLE categories\n  ${clauses.join(',\n  ')}`);
    }
  }
};
