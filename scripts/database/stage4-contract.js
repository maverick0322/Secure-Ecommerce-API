'use strict';

// Independent transcription of the Word dictionary; do not derive from migrations.
// Stage 2 resolved the history status fields to the same ENUM as orders.status.
const uuid = 'char(36)';
const date = 'datetime(3)';
const big = 'bigint unsigned';
const opt = type => ({ type, nullable: 'YES', def: null });
const def = (type, value) => ({ type, nullable: 'NO', def: value });
const dates = { createdAt: date, updatedAt: date };
const soft = { deletedAt: opt(date) };
const orderStatus = "enum('PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED')";
const contract = {
  users: { id: uuid, name: 'varchar(120)', email: 'varchar(254)', phoneNumber: opt('varchar(20)'),
    passwordHash: 'varchar(255)', status: def("enum('ACTIVE','SUSPENDED','DISABLED')", 'ACTIVE'),
    emailVerifiedAt: date, ...dates, ...soft },
  admins: { userId: uuid },
  sellers: { userId: uuid, storeName: 'varchar(120)', status: def("enum('PENDING','APPROVED','REJECTED','SUSPENDED')", 'PENDING'),
    requestedAt: date, reviewedAt: opt(date), reviewedByUserId: opt(uuid), rejectionReason: opt('varchar(255)'), updatedAt: date },
  buyers: { userId: uuid },
  user_addresses: { id: big, buyerId: uuid, label: opt('varchar(40)'), recipientName: 'varchar(120)', street: 'varchar(255)',
    exteriorNumber: 'varchar(20)', interiorNumber: opt('varchar(20)'), neighborhood: 'varchar(120)', city: 'varchar(120)',
    state: 'varchar(120)', postalCode: 'varchar(12)', country: def('char(2)', 'MX'), isDefault: def('tinyint(1)', '0'), ...dates, ...soft },
  categories: { id: 'int', name: 'varchar(120)', protected: def('tinyint(1)', '0'), ...dates, ...soft },
  products: { id: 'int', sellerId: uuid, title: 'varchar(255)', description: opt('text'), price: 'decimal(12,2)',
    stock: def('int unsigned', '0'), imagePublicId: opt('varchar(255)'), ...dates, ...soft },
  product_categories: { productId: 'int', categoryId: 'int', createdAt: date, ...soft },
  carts: { id: big, buyerId: uuid, ...dates, ...soft },
  cart_items: { id: big, cartId: big, productId: 'int', quantity: 'int unsigned', ...dates, ...soft },
  orders: { id: big, buyerId: uuid, sellerId: uuid, checkoutId: uuid, status: def(orderStatus, 'PENDING'),
    total: 'decimal(12,2)', deliveryAddressSnapshot: 'json', ...dates },
  order_items: { id: big, orderId: big, productId: 'int', productTitle: 'varchar(255)', quantity: 'int unsigned', unitPrice: 'decimal(12,2)' },
  order_status_history: { id: big, orderId: big, previousStatus: opt(orderStatus), newStatus: orderStatus,
    changedByUserId: opt(uuid), reason: opt('varchar(255)'), occurredAt: date },
  audit_logs: { id: 'int', actorUserId: opt(uuid), action: 'varchar(80)', targetType: opt('varchar(40)'),
    targetId: opt('varchar(64)'), ipAddress: opt('varchar(45)'), outcome: 'varchar(16)', details: opt('json'), occurredAt: date }
};
const edges = [
  ['admins','userId','users','id'], ['buyers','userId','users','id'], ['sellers','userId','users','id'],
  ['sellers','reviewedByUserId','admins','userId'], ['user_addresses','buyerId','buyers','userId'],
  ['products','sellerId','sellers','userId'], ['product_categories','productId','products','id'],
  ['product_categories','categoryId','categories','id'], ['carts','buyerId','buyers','userId'],
  ['cart_items','cartId','carts','id'], ['cart_items','productId','products','id'],
  ['orders','buyerId','buyers','userId'], ['orders','sellerId','sellers','userId'],
  ['order_items','orderId','orders','id'], ['order_items','productId','products','id'],
  ['order_status_history','orderId','orders','id'], ['order_status_history','changedByUserId','users','id'],
  ['audit_logs','actorUserId','users','id']
];

module.exports = { contract, edges };
