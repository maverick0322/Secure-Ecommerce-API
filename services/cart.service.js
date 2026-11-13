'use strict';
const {User,Buyer,Seller,Product,Cart,CartItem,sequelize} = require('../models');
const {AccountError,isActive} = require('./accounts.service');

// All cart mutations serialize on their owner's account, including first creation.
function withCart(buyerId, work, context = {}) {
  return sequelize.transaction(async transaction => {
    const user = await User.findByPk(buyerId,{transaction,lock:transaction.LOCK.UPDATE});
    if (!isActive(user) || !await Buyer.findByPk(buyerId,{transaction})) throw new AccountError(403,'Se requiere un comprador activo.');
    let cart = await Cart.findOne({where:{buyerId},paranoid:false,transaction,lock:transaction.LOCK.UPDATE});
    const action = !cart ? 'cart.create' : cart.deletedAt ? 'cart.restore' : null;
    if (!cart) cart = await Cart.create({buyerId},{transaction});
    else if (cart.deletedAt) await cart.restore({transaction});
    const result = await work(cart,transaction);
    if (action) await require('./audit.service').business(buyerId,action,'cart',cart.id,transaction,context);
    return result;
  });
}

async function availableProduct(id, transaction) {
  const initial = await Product.findByPk(id,{transaction});
  if (!initial) throw new AccountError(404,'Producto no disponible.');
  const user = await User.findByPk(initial.sellerId,{transaction,lock:transaction.LOCK.UPDATE});
  const seller = await Seller.findByPk(initial.sellerId,{transaction,lock:transaction.LOCK.UPDATE});
  if (!seller || seller.status !== 'APPROVED' || !isActive(user)) throw new AccountError(409,'Vendedor no disponible.');
  const product = await Product.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
  if (!product || product.sellerId !== initial.sellerId) throw new AccountError(409,'Producto no disponible.');
  return product;
}

// Integer cents avoid floating point arithmetic, including large line subtotals.
function cents(price) {
  if (!/^\d{1,10}\.\d{2}$/.test(String(price))) throw new AccountError(409,'Precio no disponible.');
  return BigInt(String(price).replace('.',''));
}
function money(value) { return `${value/100n}.${String(value%100n).padStart(2,'0')}`; }

async function snapshot(cart,transaction) {
  const rows = await CartItem.findAll({where:{cartId:cart.id},transaction,order:[['productId','ASC']]});
  const items = []; let subtotal = 0n;
  for (const item of rows) {
    const product = await Product.findByPk(item.productId,{transaction});
    const seller = product && await Seller.findByPk(product.sellerId,{transaction});
    const user = seller && await User.findByPk(seller.userId,{transaction});
    const available = Boolean(product && seller?.status === 'APPROVED' && isActive(user) && product.stock >= item.quantity);
    const line = product ? cents(product.price)*BigInt(item.quantity) : null;
    if (line !== null) subtotal += line;
    items.push({productId:item.productId,quantity:item.quantity,title:product?.title || null,
      unitPrice:product ? String(product.price) : null,subtotal:line === null ? null : money(line),available});
  }
  return {id:String(cart.id),items,subtotal:money(subtotal)};
}

function get(buyerId,context = {}) { return withCart(buyerId,snapshot,context); }
function put(buyerId,productId,quantity,add = false,context = {}) {
  return withCart(buyerId,async (cart,transaction) => {
    const product = await availableProduct(productId,transaction);
    const item = await CartItem.findOne({where:{cartId:cart.id,productId},paranoid:false,transaction,lock:transaction.LOCK.UPDATE});
    if (!add && (!item || item.deletedAt)) throw new AccountError(404,'Artículo no encontrado.');
    const next = add && item && !item.deletedAt ? item.quantity+quantity : quantity;
    if (next > 4294967295 || product.stock < next) throw new AccountError(409,'Inventario insuficiente.');
    if (!item) await CartItem.create({cartId:cart.id,productId,quantity:next},{transaction});
    else {
      if (item.deletedAt) await item.restore({transaction});
      await item.update({quantity:next},{transaction});
    }
    await cart.changed('updatedAt',true);
    await cart.save({transaction});
    await require('./audit.service').business(buyerId,add ? 'cart.add' : 'cart.update','cart',productId,
      transaction,{ipAddress:context.ipAddress,details:{productId,quantity:next}});
    return snapshot(cart,transaction);
  },context);
}
function remove(buyerId,productId,context = {}) {
  return withCart(buyerId,async (cart,transaction) => {
    const item = await CartItem.findOne({where:{cartId:cart.id,productId},transaction,lock:transaction.LOCK.UPDATE});
    if (!item) throw new AccountError(404,'Artículo no encontrado.');
    await item.destroy({transaction});
    await require('./audit.service').business(buyerId,'cart.remove','cart',productId,transaction,context);
  },context);
}
module.exports = {get,put,remove,cents,money};
