'use strict';
const { compareCodeUnits } = require('./canonical-order');

const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const db=require('../models');
const {AccountError,isActive}=require('./accounts.service');
const quotes=require('./checkout-quote.service');
const {cents,money}=require('./cart.service');
const audit=require('./audit.service');
const addressFields=['recipientName','street','exteriorNumber','interiorNumber','neighborhood','city','state','postalCode','country'];
const plain=row=>row.toJSON ? row.toJSON() : row;
const conflict=message=>new AccountError(409,message);

async function buyerLock(id,transaction){
  const user=await db.User.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
  if(!isActive(user)||!await db.Buyer.findByPk(id,{transaction})) throw new AccountError(403,'Se requiere un comprador activo.');
}
function addressSnapshot(address){return Object.fromEntries(addressFields.map(key=>[key,address[key]??null]));}

async function loadCart(buyerId,addressId,transaction){
  const address=await db.UserAddress.findOne({where:{id:addressId,buyerId},transaction,lock:transaction.LOCK.UPDATE});
  if(!address) throw new AccountError(404,'Dirección no encontrada.');
  const cart=await db.Cart.findOne({where:{buyerId},transaction,lock:transaction.LOCK.UPDATE});
  const lines=cart && await db.CartItem.findAll({where:{cartId:cart.id},transaction,order:[['productId','ASC']],lock:transaction.LOCK.UPDATE});
  if(!lines?.length || lines.length>100) throw conflict('El carrito debe contener entre 1 y 100 productos.');
  const initial=await db.Product.findAll({where:{id:lines.map(row=>row.productId)},transaction});
  if(initial.length!==lines.length) throw conflict('Algún producto ya no está disponible.');
  // Match catalog's lock order: seller account, seller profile, then product.
  for(const id of [...new Set(initial.map(row=>row.sellerId))].sort(compareCodeUnits)){
    const user=await db.User.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
    const seller=await db.Seller.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
    if(!isActive(user)||seller?.status!=='APPROVED') throw conflict('Algún vendedor no está disponible.');
  }
  const products=[]; const items=[];
  for(const line of lines){
    const product=await db.Product.findByPk(line.productId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!product || product.sellerId!==initial.find(p=>p.id===line.productId).sellerId || product.stock<line.quantity) throw conflict('Producto no disponible o inventario insuficiente.');
    products.push(product);items.push({productId:product.id,sellerId:product.sellerId,title:product.title,price:String(product.price),quantity:line.quantity});
  }
  return {cart,lines,products,items,address:addressSnapshot(address)};
}

function grouped(items){
  const groups=new Map();
  for(const item of items){
    const group=groups.get(item.sellerId)||{sellerId:item.sellerId,total:0n,items:[]};
    group.total+=cents(item.price)*BigInt(item.quantity);group.items.push(item);groups.set(item.sellerId,group);
    if(group.total>999999999999n) throw conflict('El total supera el límite permitido.');
  }return [...groups.values()];
}
function quote(buyerId,addressId){
  return db.sequelize.transaction(async transaction=>{
    await buyerLock(buyerId,transaction);
    const current=await loadCart(buyerId,addressId,transaction);
    const content={checkoutId:randomUUID(),addressId,items:current.items,address:current.address};
    return {checkoutId:content.checkoutId,quote:quotes.sign(buyerId,content),expiresIn:600,address:current.address,
      orders:grouped(current.items).map(g=>({...g,total:money(g.total)}))};
  });
}
async function fullOrders(rows,transaction){
  const result=[];
  for(const row of rows){
    const items=await db.OrderItem.findAll({where:{orderId:row.id},transaction,order:[['productId','ASC']]});
    result.push({...plain(row),id:String(row.id),items:items.map(item=>({...plain(item),id:String(item.id),orderId:String(item.orderId)}))});
  }return result;
}
function confirm(buyerId,token,ipAddress){
  const content=quotes.verify(token,buyerId);
  return db.sequelize.transaction(async transaction=>{
    await buyerLock(buyerId,transaction);
    const existing=await db.Order.findAll({where:{checkoutId:content.checkoutId},transaction,order:[['sellerId','ASC']]});
    if(existing.length){
      if(existing.some(row=>row.buyerId!==buyerId)) throw conflict('Identificador de compra no disponible.');
      const result=await fullOrders(existing,transaction);
      const replay=result.flatMap(order=>order.items.map(item=>({productId:item.productId,sellerId:order.sellerId,title:item.productTitle,price:item.unitPrice,quantity:item.quantity}))).sort((a,b)=>a.productId-b.productId);
      if(!isDeepStrictEqual(replay,content.items) || result.some(order=>!isDeepStrictEqual(order.deliveryAddressSnapshot,content.address))) throw conflict('El reintento no coincide con la compra confirmada.');
      return {replayed:true,orders:result};
    }
    if(content.exp<=Math.floor(Date.now()/1000)) throw conflict('La cotización caducó; vuelva a revisar y confirmar la compra.');
    const current=await loadCart(buyerId,content.addressId,transaction);
    if(!isDeepStrictEqual(current.items,content.items)||!isDeepStrictEqual(current.address,content.address)) throw conflict('Cambió el precio, contenido o dirección; solicite otra cotización y reconfirme.');
    const created=[];
    for(const group of grouped(current.items)){
      const order=await db.Order.create({buyerId,sellerId:group.sellerId,checkoutId:content.checkoutId,total:money(group.total),deliveryAddressSnapshot:current.address},{transaction});
      for(const item of group.items){
        await db.OrderItem.create({orderId:order.id,productId:item.productId,productTitle:item.title,quantity:item.quantity,unitPrice:item.price},{transaction});
        const product=current.products.find(row=>row.id===item.productId);
        await product.update({stock:product.stock-item.quantity},{transaction});
      }
      await db.OrderStatusHistory.create({orderId:order.id,previousStatus:null,newStatus:'PENDING',changedByUserId:buyerId,occurredAt:new Date()},{transaction});
      await audit.write({actorUserId:buyerId,action:'order.create',targetType:'order',targetId:order.id,ipAddress,details:{checkoutId:content.checkoutId}},{transaction});
      created.push(order);
    }
    for(const line of current.lines) await line.destroy({transaction});
    return {replayed:false,orders:await fullOrders(created,transaction)};
  });
}

function scope(account){
  if(account.profile==='ADMIN') return {};
  return account.profile==='SELLER' ? {sellerId:account.id} : {buyerId:account.id};
}
async function list(account){return db.Order.findAll({where:scope(account),order:[['id','DESC']],limit:100});}
async function get(account,id){
  const order=await db.Order.findOne({where:{id,...scope(account)}});
  if(!order) throw new AccountError(404,'Pedido no encontrado.');
  const [result]=await fullOrders([order]);
  result.history=await db.OrderStatusHistory.findAll({where:{orderId:id},order:[['id','ASC']]});return result;
}
function transition(account,id,{status,reason},ipAddress){
  return db.sequelize.transaction(async transaction=>{
    const user=await db.User.findByPk(account.id,{transaction,lock:transaction.LOCK.UPDATE});
    if(!isActive(user)) throw new AccountError(403,'Cuenta no disponible.');
    const profile=account.profile==='ADMIN' ? await db.Admin.findByPk(account.id,{transaction}) : account.profile==='SELLER' ? await db.Seller.findByPk(account.id,{transaction,lock:transaction.LOCK.UPDATE}) : await db.Buyer.findByPk(account.id,{transaction});
    if(!profile || (account.profile==='SELLER' && profile.status!=='APPROVED')) throw new AccountError(403,'Perfil no disponible.');
    const order=await db.Order.findOne({where:{id,...scope(account)},transaction,lock:transaction.LOCK.UPDATE});
    if(!order) throw new AccountError(404,'Pedido no encontrado.');
    const allowed={PENDING:['PREPARING','CANCELED'],PREPARING:['SHIPPED','CANCELED'],SHIPPED:['DELIVERED'],DELIVERED:[],CANCELED:[]};
    if(!allowed[order.status].includes(status)) throw conflict('Transición no permitida.');
    if(account.profile==='BUYER' && !(order.status==='PENDING'&&status==='CANCELED')) throw new AccountError(403,'El comprador solo puede cancelar pedidos pendientes.');
    if(status==='CANCELED'&&!reason) throw new AccountError(400,'La cancelación requiere un motivo.');
    const previousStatus=order.status;
    // Cancellation does not restock automatically: avoids introducing a second
    // inventory write path or assuming that goods have been returned.
    await order.update({status,updatedAt:new Date()},{transaction,fields:['status','updatedAt']});
    await db.OrderStatusHistory.create({orderId:order.id,previousStatus,newStatus:status,changedByUserId:account.id,reason,occurredAt:new Date()},{transaction});
    await audit.write({actorUserId:account.id,action:'order.transition',targetType:'order',targetId:order.id,ipAddress,details:{status,previousStatus}},{transaction});
    return plain(order);
  });
}
module.exports={quote,confirm,list,get,transition,grouped,addressSnapshot};
