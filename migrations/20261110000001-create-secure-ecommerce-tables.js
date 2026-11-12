'use strict';

const {
  SELLER_STATUS, ORDER_STATUS, requireTarget, legacyUuid, foreignKey, rejectUndo
} = require('./support/secure-ecommerce');

const bigId = 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
const date = 'DATETIME(3) NOT NULL';
const timestamps = { createdAt: date, updatedAt: date };
const softDelete = { deletedAt: 'DATETIME(3) NULL' };

async function up(queryInterface) {
  await requireTarget(queryInterface);
  const existing = new Set(await queryInterface.showAllTables());
  const baseline = ['users', 'roles', 'products', 'files', 'categories', 'product_categories', 'audit_logs'];
  if (baseline.some(table => !existing.has(table))) {
    throw new Error('Apply or restore the normalized historical schema before adding secure_ecommerce tables.');
  }
  const uuid = await legacyUuid(queryInterface);
  const profileId = { userId: `${uuid} NOT NULL PRIMARY KEY` };
  const buyerId = `${uuid} NOT NULL`;
  const profileFk = table => foreignKey(`${table}_user_fk`, 'userId', 'users', 'id');

  const tables = [
    ['admins', profileId, [profileFk('admins')]],
    ['sellers', {
      ...profileId,
      storeName: 'VARCHAR(120) NOT NULL',
      status: `${SELLER_STATUS} NOT NULL DEFAULT 'PENDING'`,
      requestedAt: date,
      reviewedAt: 'DATETIME(3) NULL',
      reviewedByUserId: `${uuid} NULL`,
      rejectionReason: 'VARCHAR(255) NULL',
      updatedAt: date
    }, [profileFk('sellers'), foreignKey('sellers_reviewer_fk', 'reviewedByUserId', 'admins', 'userId')]],
    ['buyers', profileId, [profileFk('buyers')]],
    ['user_addresses', {
      id: bigId,
      buyerId,
      label: 'VARCHAR(40) NULL',
      recipientName: 'VARCHAR(120) NOT NULL',
      street: 'VARCHAR(255) NOT NULL',
      exteriorNumber: 'VARCHAR(20) NOT NULL',
      interiorNumber: 'VARCHAR(20) NULL',
      neighborhood: 'VARCHAR(120) NOT NULL',
      city: 'VARCHAR(120) NOT NULL',
      state: 'VARCHAR(120) NOT NULL',
      postalCode: 'VARCHAR(12) NOT NULL',
      country: "CHAR(2) NOT NULL DEFAULT 'MX'",
      isDefault: 'TINYINT(1) NOT NULL DEFAULT 0',
      ...timestamps,
      ...softDelete
    }, [
      foreignKey('user_addresses_buyer_fk', 'buyerId', 'buyers', 'userId'),
      'CONSTRAINT user_addresses_default_valid CHECK (isDefault IN (0, 1))',
      'UNIQUE KEY user_addresses_one_active_default ((CASE WHEN isDefault = 1 AND deletedAt IS NULL THEN buyerId ELSE NULL END))'
    ]],
    ['carts', { id: bigId, buyerId, ...timestamps, ...softDelete }, [
      'UNIQUE KEY carts_buyer_unique (buyerId)',
      foreignKey('carts_buyer_fk', 'buyerId', 'buyers', 'userId')
    ]],
    ['cart_items', {
      id: bigId,
      cartId: 'BIGINT UNSIGNED NOT NULL',
      productId: 'INT NOT NULL',
      quantity: 'INT UNSIGNED NOT NULL',
      ...timestamps,
      ...softDelete
    }, [
      'UNIQUE KEY cart_items_cart_product_unique (cartId, productId)',
      'CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0)',
      foreignKey('cart_items_cart_fk', 'cartId', 'carts', 'id'),
      foreignKey('cart_items_product_fk', 'productId', 'products', 'id')
    ]],
    ['orders', {
      id: bigId,
      buyerId,
      sellerId: `${uuid} NOT NULL`,
      checkoutId: `${uuid} NOT NULL`,
      status: `${ORDER_STATUS} NOT NULL DEFAULT 'PENDING'`,
      total: 'DECIMAL(12,2) NOT NULL',
      deliveryAddressSnapshot: 'JSON NOT NULL',
      ...timestamps
    }, [
      'UNIQUE KEY orders_checkout_seller_unique (checkoutId, sellerId)',
      'CONSTRAINT orders_total_nonnegative CHECK (total >= 0)',
      foreignKey('orders_buyer_fk', 'buyerId', 'buyers', 'userId'),
      foreignKey('orders_seller_fk', 'sellerId', 'sellers', 'userId')
    ]],
    ['order_items', {
      id: bigId,
      orderId: 'BIGINT UNSIGNED NOT NULL',
      productId: 'INT NOT NULL',
      productTitle: 'VARCHAR(255) NOT NULL',
      quantity: 'INT UNSIGNED NOT NULL',
      unitPrice: 'DECIMAL(12,2) NOT NULL'
    }, [
      'CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)',
      'CONSTRAINT order_items_unit_price_nonnegative CHECK (unitPrice >= 0)',
      foreignKey('order_items_order_fk', 'orderId', 'orders', 'id'),
      foreignKey('order_items_product_fk', 'productId', 'products', 'id')
    ]],
    ['order_status_history', {
      id: bigId,
      orderId: 'BIGINT UNSIGNED NOT NULL',
      previousStatus: `${ORDER_STATUS} NULL`,
      newStatus: `${ORDER_STATUS} NOT NULL`,
      changedByUserId: `${uuid} NULL`,
      reason: 'VARCHAR(255) NULL',
      occurredAt: date
    }, [
      foreignKey('order_status_history_order_fk', 'orderId', 'orders', 'id'),
      foreignKey('order_status_history_actor_fk', 'changedByUserId', 'users', 'id')
    ]]
  ];

  for (const [table, columns, constraints] of tables) {
    if (existing.has(table)) {
      const actual = Object.keys(await queryInterface.describeTable(table));
      if (actual.length !== Object.keys(columns).length || actual.some(name => !Object.hasOwn(columns, name))) {
        throw new Error(`Unexpected columns in ${table}. Review the existing table before resuming.`);
      }
      continue;
    }
    const definitions = Object.entries(columns).map(([name, type]) => `\`${name}\` ${type}`);
    await queryInterface.sequelize.query(`CREATE TABLE ${table} (\n  ${[...definitions, ...constraints].join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
}

module.exports = { up, down: rejectUndo };
