const { Product, Category, ProductCategory, User, Seller, Admin, sequelize, Sequelize } = require('../models');
const { AccountError, isActive, respondError } = require('./accounts.service');
const { Op } = Sequelize;

function catalogError(res, error) {
  if (error instanceof Sequelize.UniqueConstraintError || error.original?.code === 'ER_LOCK_DEADLOCK') {
    return respondError(res, new AccountError(409, 'La operación entra en conflicto con otro cambio del catálogo.'));
  }
  return respondError(res, error);
}

function positiveId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || Number(value) > 2147483647) {
    throw new AccountError(400, 'El identificador no es válido.');
  }
  return Number(value);
}

function productInput(body, creating = false) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || !Object.keys(body).length ||
    Object.keys(body).some(key => !['title', 'description', 'price', 'stock'].includes(key))) {
    throw new AccountError(400, 'Solo se admiten title, description, price y stock.');
  }
  const result = {};
  if (creating || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || [...body.title.trim()].length > 255) {
      throw new AccountError(400, 'El título debe tener entre 1 y 255 caracteres.');
    }
    result.title = body.title.trim();
  }
  if (Object.hasOwn(body, 'description')) {
    if (body.description !== null && (typeof body.description !== 'string' || Buffer.byteLength(body.description) > 65535)) {
      throw new AccountError(400, 'La descripción debe ser texto de hasta 65535 bytes o null.');
    }
    result.description = body.description;
  }
  if (creating || Object.hasOwn(body, 'price')) {
    const price = body.price;
    if (!['string', 'number'].includes(typeof price) || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(String(price))) {
      throw new AccountError(400, 'El precio debe ser no negativo y tener como máximo dos decimales.');
    }
    const [integer, fraction = ''] = String(price).split('.');
    result.price = `${integer}.${fraction.padEnd(2, '0')}`;
  }
  if (Object.hasOwn(body, 'stock')) {
    if (!Number.isInteger(body.stock) || body.stock < 0 || body.stock > 4294967295) {
      throw new AccountError(400, 'El inventario debe ser un entero entre 0 y 4294967295.');
    }
    result.stock = body.stock;
  }
  return result;
}

function categoryInput(body) {
  if (!body || Object.keys(body).length !== 1 || typeof body.name !== 'string' || !body.name.trim() || [...body.name.trim()].length > 120) {
    throw new AccountError(400, 'Indique únicamente name, de 1 a 120 caracteres.');
  }
  return body.name.trim();
}

async function checkPricePrecision(price, transaction) {
  if (price === undefined) return;
  const columns = await sequelize.getQueryInterface().describeTable('products', { transaction });
  const precision = /^DECIMAL\((\d+),\s*2\)$/i.exec(columns.price.type);
  if (!precision) throw new AccountError(503, 'El tipo de precio del catálogo requiere revisión.');
  if (price.split('.')[0].length > Number(precision[1]) - 2) {
    throw new AccountError(409, 'Este precio requiere ampliar la precisión del esquema de transición.');
  }
}

async function lockActor(account, transaction, profile) {
  const options = { transaction, lock: transaction.LOCK.UPDATE };
  if (!isActive(await User.findByPk(account.id, options))) throw new AccountError(403, 'La cuenta no está activa.');
  if (profile === 'SELLER' && (await Seller.findByPk(account.id, options))?.status !== 'APPROVED') {
    throw new AccountError(403, 'La cuenta de vendedor debe estar aprobada.');
  }
  if (profile === 'ADMIN' && !await Admin.findByPk(account.id,{transaction})) throw new AccountError(403,'Se requiere ADMIN.');
}

async function ownedProduct(id, sellerId, transaction) {
  const product = await Product.findByPk(id, { transaction, ...(transaction && { lock: transaction.LOCK.UPDATE }) });
  if (!product || product.sellerId !== sellerId) throw new AccountError(404, 'Producto no encontrado.');
  return product;
}

function mutateProduct(account, id, apply, context = {}, action = 'producto.editar', targetId = id) {
  return sequelize.transaction(async transaction => {
    await lockActor(account, transaction, 'SELLER');
    const result = await apply(await ownedProduct(id, account.id, transaction), transaction);
    await require('./audit.service').business(account.id,action,'product',targetId,transaction,context);
    return result;
  });
}

function createProduct(account, input, context = {}) {
  return sequelize.transaction(async transaction => {
    await lockActor(account, transaction, 'SELLER');
    await checkPricePrecision(input.price, transaction);
    const product = await Product.create({ ...input, sellerId: account.id }, { transaction });
    await require('./audit.service').business(account.id,'producto.crear','product',product.id,transaction,context);
    return product;
  });
}

function updateProduct(account, id, input, context = {}) {
  return mutateProduct(account, id, async (product, transaction) => {
    await checkPricePrecision(input.price, transaction);
    return product.update(input, { transaction });
  },context);
}

function removeProduct(account,id,context = {}) {
  return mutateProduct(account,id,(product,transaction)=>product.destroy({transaction}),context,'producto.eliminar');
}

function changeCategory(account, productId, categoryId, removing, context = {}) {
  return mutateProduct(account, productId, async (product, transaction) => {
    if (!await Category.findByPk(categoryId, { transaction, lock: transaction.LOCK.UPDATE })) throw new AccountError(404, 'Categoría no encontrada.');
    const where = { productId: product.id, categoryId };
    const link = await ProductCategory.findOne({ where, paranoid: false, transaction, lock: transaction.LOCK.UPDATE });
    if (removing) {
      if (link && !link.deletedAt) await link.destroy({ transaction });
    } else if (link) {
      if (link.deletedAt) await link.restore({ transaction });
    } else {
      const now = new Date();
      const row = { ...where, createdAt: now };
      await sequelize.getQueryInterface().bulkInsert('product_categories', [row], { transaction }, ProductCategory.rawAttributes);
    }
  },context,removing ? 'productocategoria.remover' : 'productocategoria.agregar',`${productId}:${categoryId}`);
}

function visibleProductQuery() {
  return { where: { price: { [Op.gte]: 0 }, title: { [Op.ne]: null } }, include: [
    { association: 'seller', attributes: [], required: true, where: { status: 'APPROVED' },
      include: [{ association: 'user', attributes: [], required: true, where: { status: 'ACTIVE', emailVerifiedAt: { [Op.ne]: null } } }] },
    { association: 'categories', attributes: ['id', 'name', 'protected'], required: false, through: { attributes: [], paranoid: true } }
  ] };
}

function listProducts(search) {
  const query = visibleProductQuery();
  if (search !== undefined) {
    if (typeof search !== 'string' || search.length > 255) throw new AccountError(400, 'El término de búsqueda no es válido.');
    query.where.title = { [Op.like]: `%${search}%` };
  }
  return Product.findAll({ ...query, order: [['id', 'ASC']] });
}

async function getProduct(id) {
  const query = visibleProductQuery();
  const product = await Product.findOne({ ...query, where: { ...query.where, id } });
  if (!product) throw new AccountError(404, 'Producto no encontrado.');
  return product;
}

function mutateCategory(account, id, name, removing = false, context = {}) {
  return sequelize.transaction({ isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
    await lockActor(account, transaction, 'ADMIN');
    let category;
    if (id) {
      category = await Category.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!category) throw new AccountError(404, 'Categoría no encontrada.');
    }
    if (removing) {
      if (category.protected) throw new AccountError(400, 'No se pueden eliminar categorías protegidas del sistema.');
      await category.destroy({ transaction });
      await require('./audit.service').business(account.id,'categoria.eliminar','category',id,transaction,context);
      return;
    }
    // Lock matching names and gaps while the transition lacks the final unique index.
    const matches = await Category.findAll({ where: { name }, paranoid: false, transaction, lock: transaction.LOCK.UPDATE });
    if (matches.some(row => row.id !== id)) throw new AccountError(409, 'Ya existe una categoría con ese nombre.');
    const result = category ? await category.update({ name }, { transaction }) :
      await Category.create({ name, protected: false }, { transaction });
    await require('./audit.service').business(account.id,id ? 'categoria.editar' : 'categoria.crear','category',result.id,transaction,context);
    return result;
  });
}

module.exports = { catalogError, positiveId, productInput, categoryInput, ownedProduct, mutateProduct,
  createProduct, updateProduct, removeProduct, changeCategory, listProducts, getProduct, mutateCategory };
