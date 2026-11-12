'use strict';

const { USER_STATUS, requireTarget, legacyUuid, foreignKey, alter, rejectUndo } = require('./support/secure-ecommerce');

async function up(queryInterface) {
  await requireTarget(queryInterface);
  const uuid = await legacyUuid(queryInterface);
  const nullableDate = 'DATETIME(3) NULL';

  const tables = [
    ['users', {
      phoneNumber: 'VARCHAR(20) NULL',
      status: `${USER_STATUS} NOT NULL DEFAULT 'ACTIVE'`,
      emailVerifiedAt: nullableDate,
      deletedAt: nullableDate
    }],
    ['categories', { deletedAt: nullableDate }],
    ['products', {
      sellerId: `${uuid} NULL`,
      stock: 'INT UNSIGNED NOT NULL DEFAULT 0',
      imagePublicId: 'VARCHAR(255) NULL',
      deletedAt: nullableDate
    }, [foreignKey('products_seller_fk', 'sellerId', 'sellers', 'userId')]],
    ['product_categories', { deletedAt: nullableDate }],
    ['audit_logs', {
      actorUserId: `${uuid} NULL`,
      targetType: 'VARCHAR(40) NULL',
      targetId: 'VARCHAR(64) NULL',
      ipAddress: 'VARCHAR(45) NULL',
      outcome: 'VARCHAR(16) NULL',
      details: 'JSON NULL',
      occurredAt: nullableDate
    }, [foreignKey('audit_logs_actor_fk', 'actorUserId', 'users', 'id')]]
  ];

  for (const [table, columns, constraints = []] of tables) {
    const current = await queryInterface.describeTable(table);
    const names = Object.keys(columns);
    const existing = names.filter(name => Object.hasOwn(current, name));
    if (existing.length === names.length) continue;
    if (existing.length > 0) {
      throw new Error(`Unexpected partial column set in ${table}. Review the schema before resuming.`);
    }
    await alter(queryInterface, table, [
      ...names.map(name => `ADD COLUMN \`${name}\` ${columns[name]}`),
      ...constraints.map(constraint => `ADD ${constraint}`)
    ]);
  }
}

module.exports = { up, down: rejectUndo };
