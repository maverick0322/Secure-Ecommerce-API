'use strict';
const fs=require('node:fs');
const path=require('node:path');
const guard=require('./collection-guard');
function build(){
  const folders=[];
  function folder(name){const value={name,item:[]};folders.push(value);return value.item;}
  function add(items,name,method,url,status,{token,body,tests='',file,headers=[]}={}){
    const header=[...headers];if(token)header.push({key:'Authorization',value:'Bearer {{'+token+'}}'});
    const request={method,header,url:'{{baseUrl}}'+url,description:'Solo para la instancia aislada creada por postman/scripts/run.js.'};
    if(body!==undefined){header.push({key:'Content-Type',value:'application/json'});request.body={mode:'raw',raw:JSON.stringify(body),options:{raw:{language:'json'}}};}
    if(file)request.body={mode:'formdata',formdata:[{key:'image',type:'file',src:file}]};
    const script=`pm.test('HTTP ${status}',function(){pm.expect(pm.response.code).to.eql(${status});});
const b=pm.response.code===204?{}:pm.response.json();
if(pm.response.code===${status}) { ${tests} }`;
    items.push({name,request,event:[{listen:'test',script:{type:'text/javascript',exec:script.split('\n')}}]});
  }
  const auth=folder('01 Autenticacion');
  add(auth,'Identidad de la instancia aislada','GET','/__postman/isolation',200,{tests:"pm.test('Providers are simulated',()=>{pm.expect(b.email).to.eql('memory');pm.expect(b.cloudinary).to.eql('memory');});"});
  for(const role of ['admin','buyer','buyerOther','seller','sellerOther']){
    add(auth,'Login '+role,'POST','/api/auth',200,{body:{email:'{{'+role+'Email}}',password:'{{'+role+'Password}}'},
      tests:`pm.test('Session without stored hash',()=>{pm.expect(typeof b.jwt).to.eql('string');pm.expect(b).not.to.have.property('passwordHash');});pm.variables.set('${role}Token',b.jwt);pm.variables.set('${role}Id',b.id);`});
  }
  add(auth,'Password incorrecto','POST','/api/auth',401,{body:{email:'{{adminEmail}}',password:'{{wrongPassword}}'},tests:"pm.variables.set('loginDeniedMessage',b.message);"});
  add(auth,'Cuenta inexistente sin enumeracion','POST','/api/auth',401,{body:{email:'{{unknownEmail}}',password:'{{wrongPassword}}'},tests:"pm.test('Same denial message',()=>pm.expect(b.message).to.eql(pm.variables.get('loginDeniedMessage')));"});
  add(auth,'Registro ADMIN publico prohibido','POST','/api/auth/register/verify',400,{body:{email:'{{registrationEmail}}',code:'123456',name:'Synthetic',password:'{{registrationPassword}}',profile:'ADMIN'}});
  add(auth,'Solicitar verificacion simulada','POST','/api/auth/register',202,{body:{email:'{{registrationEmail}}'}});
  add(auth,'Leer buzon exclusivamente local','GET','/__postman/mailbox?email={{registrationEmail}}',200,{tests:"pm.test('Six digit test code',()=>pm.expect(/^\\d{6}$/.test(b.code)).to.eql(true));pm.variables.set('verificationCode',b.code);pm.variables.set('wrongCode',b.code==='000000'?'000001':'000000');"});
  const registration={email:'{{registrationEmail}}',code:'{{verificationCode}}',name:'Postman registered BUYER',password:'{{registrationPassword}}',profile:'BUYER'};
  add(auth,'Codigo incorrecto','POST','/api/auth/register/verify',400,{body:{...registration,code:'{{wrongCode}}'}});
  add(auth,'Password comun rechazado','POST','/api/auth/register/verify',400,{body:{...registration,password:'Password123456!'}});
  add(auth,'Limite bcrypt sin truncamiento','POST','/api/auth/register/verify',400,{body:{...registration,password:'x'.repeat(73)}});
  add(auth,'Registrar comprador con verificacion real del codigo','POST','/api/auth/register/verify',201,{body:registration,
    tests:"pm.test('BUYER created',()=>pm.expect(b.profile).to.eql('BUYER'));pm.variables.set('registeredBuyerId',b.id);"});
  add(auth,'Codigo consumido no reutilizable','POST','/api/auth/register/verify',400,{body:registration});
  add(auth,'Consultar JWT vigente','GET','/api/auth/time',200,{token:'buyerToken',tests:"pm.test('Session time present',()=>pm.expect(typeof b.remainingTime).to.eql('string'));"});
  const users=folder('02 Usuarios');
  add(users,'ADMIN lista cuentas','GET','/api/users',200,{token:'adminToken',tests:"pm.test('Synthetic profiles persisted',()=>pm.expect(b.length>=6).to.eql(true));"});
  add(users,'BUYER no administra usuarios','GET','/api/users',403,{token:'buyerToken'});
  add(users,'Consultar cuenta','GET','/api/users/{{buyerEmail}}',200,{token:'adminToken',tests:"pm.test('Buyer profile',()=>pm.expect(b.profile).to.eql('BUYER'));"});
  add(users,'Cambiar nombre permitido','PUT','/api/users/{{buyerEmail}}',204,{token:'adminToken',body:{name:'Postman buyer updated'}});
  add(users,'No asignar perfil masivamente','PUT','/api/users/{{buyerEmail}}',400,{token:'adminToken',body:{profile:'ADMIN'}});
  const sellers=folder('03 Vendedores');
  add(sellers,'PENDING no publica','POST','/api/products',403,{token:'sellerToken',body:{title:'Forbidden',price:'1.00',stock:1}});
  add(sellers,'BUYER no aprueba vendedores','PUT','/api/users/sellers/{{sellerId}}/review',403,{token:'buyerToken',body:{status:'APPROVED'}});
  add(sellers,'Rechazo exige motivo','PUT','/api/users/sellers/{{sellerOtherId}}/review',400,{token:'adminToken',body:{status:'REJECTED'}});
  for(const role of ['seller','sellerOther'])add(sellers,'Aprobar '+role,'PUT','/api/users/sellers/{{'+role+'Id}}/review',200,{token:'adminToken',body:{status:'APPROVED'},tests:"pm.test('Reviewed and approved',()=>{pm.expect(b.status).to.eql('APPROVED');pm.expect(b.reviewedByUserId).to.eql(pm.variables.get('adminId'));});"});
  add(sellers,'Revision no se confirma dos veces','PUT','/api/users/sellers/{{sellerId}}/review',409,{token:'adminToken',body:{status:'APPROVED'}});
  const categories=folder('04 Categorias');
  add(categories,'BUYER no crea categorias','POST','/api/categories',403,{token:'buyerToken',body:{name:'Forbidden'}});
  add(categories,'Nombre vacio rechazado','POST','/api/categories',400,{token:'adminToken',body:{name:''}});
  add(categories,'Crear categoria','POST','/api/categories',201,{token:'adminToken',body:{name:'Postman {{isolationRunId}}'},tests:"pm.variables.set('categoryId',b.categoryId);"});
  add(categories,'Nombre duplicado rechazado','POST','/api/categories',409,{token:'adminToken',body:{name:'Postman {{isolationRunId}}'}});
  add(categories,'Categoria protegida conservada','DELETE','/api/categories/1',400,{token:'adminToken'});
  add(categories,'Catalogo de categorias','GET','/api/categories',200,{token:'buyerToken',tests:"pm.test('Categories are an array',()=>pm.expect(Array.isArray(b)).to.eql(true));"});
  const products=folder('05 Productos e imagenes simuladas');
  for(const [role,id,title,price,stock]of [['seller','productId','Postman primary','10.00',10],['sellerOther','otherProductId','Postman secondary','5.50',20]]){
    add(products,'Crear '+title,'POST','/api/products',201,{token:role+'Token',body:{title,price,stock},tests:`pm.variables.set('${id}',b.productId);pm.test('Exact decimal string',()=>pm.expect(typeof b.price).to.eql('string'));`});
  }
  add(products,'BUYER no publica','POST','/api/products',403,{token:'buyerToken',body:{title:'Forbidden',price:'1.00'}});
  add(products,'SELLER ajeno no modifica','PUT','/api/products/{{productId}}',404,{token:'sellerOtherToken',body:{title:'Foreign'}});
  add(products,'Precio negativo rechazado','POST','/api/products',400,{token:'sellerToken',body:{title:'Invalid',price:'-1.00'}});
  add(products,'Inventario negativo rechazado','POST','/api/products',400,{token:'sellerToken',body:{title:'Invalid',price:'1.00',stock:-1}});
  add(products,'Propietario no asignable por cliente','POST','/api/products',400,{token:'sellerToken',body:{title:'Invalid',price:'1.00',sellerId:'{{buyerId}}'}});
  for(const [name,method,url,body]of [
    ['Asociar categoria','POST','/api/products/{{productId}}/categories',{categoryId:'{{categoryId}}'}],
    ['Desasociar logicamente','DELETE','/api/products/{{productId}}/categories/{{categoryId}}'],
    ['Reactivar asociacion','POST','/api/products/{{productId}}/categories',{categoryId:'{{categoryId}}'}]
  ])add(products,name,method,url,204,{token:'sellerToken',body});
  add(products,'Subir PNG a Cloudinary simulado','PUT','/api/products/{{productId}}/image',200,{token:'sellerToken',file:'scripts/fixtures/product.png',tests:"pm.test('Only public image reference',()=>pm.expect(typeof b.imagePublicId).to.eql('string'));pm.variables.set('imagePublicId',b.imagePublicId);"});
  add(products,'Contenido de imagen invalido','PUT','/api/products/{{productId}}/image',400,{token:'sellerToken',file:'scripts/fixtures/not-image.txt'});
  add(products,'Consultar productos activos','GET','/api/products',200,{token:'buyerToken',tests:"pm.test('Both approved sellers visible',()=>pm.expect(b.length).to.eql(2));"});
  const addresses=folder('06 Direcciones');
  const address={recipientName:'Persona ficticia',street:'Calle de pruebas',exteriorNumber:'1',neighborhood:'Distrito ficticio',city:'Ciudad ficticia',state:'Estado ficticio',postalCode:'01000',country:'MX',isDefault:true};
  add(addresses,'Crear direccion propia','POST','/api/addresses',201,{token:'buyerToken',body:address,tests:"pm.variables.set('addressId',b.id);"});
  add(addresses,'Crear nueva predeterminada','POST','/api/addresses',201,{token:'buyerToken',body:{...address,label:'Second'},tests:"pm.variables.set('secondAddressId',b.id);"});
  add(addresses,'Una sola predeterminada activa','GET','/api/addresses',200,{token:'buyerToken',tests:"pm.test('Exactly one default',()=>pm.expect(b.filter(a=>a.isDefault).length).to.eql(1));"});
  add(addresses,'Modificar direccion propia','PUT','/api/addresses/{{addressId}}',204,{token:'buyerToken',body:{city:'Antes del checkout'}});
  add(addresses,'No editar direccion ajena','PUT','/api/addresses/{{addressId}}',404,{token:'buyerOtherToken',body:{city:'Foreign'}});
  add(addresses,'No eliminar direccion ajena','DELETE','/api/addresses/{{addressId}}',404,{token:'buyerOtherToken'});
  add(addresses,'No asignar buyerId','POST','/api/addresses',400,{token:'buyerToken',body:{...address,buyerId:'{{buyerOtherId}}'}});
  add(addresses,'Validar campos requeridos','POST','/api/addresses',400,{token:'buyerToken',body:{city:'Incomplete'}});
  add(addresses,'Elegir predeterminada','PUT','/api/addresses/{{addressId}}/default',204,{token:'buyerToken'});
  const carts=folder('07 Carrito');
  add(carts,'Obtener carrito propio','GET','/api/cart',200,{token:'buyerToken',tests:"pm.test('Empty initial cart',()=>pm.expect(b.items.length).to.eql(0));"});
  add(carts,'Agregar producto principal','POST','/api/cart/items',200,{token:'buyerToken',body:{productId:'{{productId}}',quantity:2},tests:"pm.test('Server subtotal',()=>pm.expect(b.subtotal).to.eql('20.00'));"});
  add(carts,'Agregar segundo vendedor','POST','/api/cart/items',200,{token:'buyerToken',body:{productId:'{{otherProductId}}',quantity:1},tests:"pm.test('Combined subtotal',()=>pm.expect(b.subtotal).to.eql('25.50'));"});
  for(const quantity of [0,-1])add(carts,'Cantidad invalida '+quantity,'PUT','/api/cart/items/{{productId}}',400,{token:'buyerToken',body:{quantity}});
  add(carts,'Producto inexistente','POST','/api/cart/items',404,{token:'buyerToken',body:{productId:2147483647,quantity:1}});
  add(carts,'Precio no aceptado del cliente','POST','/api/cart/items',400,{token:'buyerToken',body:{productId:'{{productId}}',quantity:1,price:'0.01'}});
  add(carts,'No modificar carrito ajeno','PUT','/api/cart/items/{{productId}}',404,{token:'buyerOtherToken',body:{quantity:1}});
  add(carts,'Retirar logicamente','DELETE','/api/cart/items/{{productId}}',204,{token:'buyerToken'});
  add(carts,'Reactivar sin duplicar','POST','/api/cart/items',200,{token:'buyerToken',body:{productId:'{{productId}}',quantity:2},tests:"pm.test('Two unique lines',()=>pm.expect(b.items.length).to.eql(2));"});
  const checkout=folder('08 Cotizacion y checkout');
  add(checkout,'Direccion ajena no cotizable','POST','/api/checkout/quote',404,{token:'buyerOtherToken',body:{addressId:'{{addressId}}'}});
  add(checkout,'Cotizar precios actuales','POST','/api/checkout/quote',200,{token:'buyerToken',body:{addressId:'{{addressId}}'},tests:"pm.variables.set('oldQuote',b.quote);pm.test('Two sellers',()=>pm.expect(b.orders.length).to.eql(2));"});
  add(checkout,'Cambio de precio posterior','PUT','/api/products/{{productId}}',204,{token:'sellerToken',body:{price:'11.00'}});
  add(checkout,'Exigir reconfirmacion del precio','POST','/api/checkout',409,{token:'buyerToken',body:{quote:'{{oldQuote}}'}});
  add(checkout,'Cotizar de nuevo','POST','/api/checkout/quote',200,{token:'buyerToken',body:{addressId:'{{addressId}}'},tests:"pm.variables.set('quote',b.quote);pm.variables.set('addressSnapshot',JSON.stringify(b.address));"});
  add(checkout,'Confirmar pedidos por vendedor','POST','/api/checkout',201,{token:'buyerToken',body:{quote:'{{quote}}'},tests:"pm.test('One order per seller',()=>pm.expect(b.orders.length).to.eql(2));pm.test('Not a replay',()=>pm.expect(b.replayed).to.eql(false));pm.variables.set('orderIds',JSON.stringify(b.orders.map(o=>o.id).sort()));pm.variables.set('orderId',b.orders.find(o=>o.sellerId===pm.variables.get('sellerId')).id);pm.variables.set('otherOrderId',b.orders.find(o=>o.sellerId===pm.variables.get('sellerOtherId')).id);"});
  add(checkout,'Reintento idempotente','POST','/api/checkout',200,{token:'buyerToken',body:{quote:'{{quote}}'},tests:"pm.test('Same persisted orders',()=>{pm.expect(b.replayed).to.eql(true);pm.expect(JSON.stringify(b.orders.map(o=>o.id).sort())).to.eql(pm.variables.get('orderIds'));});"});
  add(checkout,'Cotizacion ligada al comprador','POST','/api/checkout',400,{token:'buyerOtherToken',body:{quote:'{{quote}}'}});
  add(checkout,'Firma alterada rechazada','POST','/api/checkout',400,{token:'buyerToken',body:{quote:'{{quote}}tampered'}});
  add(checkout,'Carrito vaciado tras confirmar','POST','/api/checkout/quote',409,{token:'buyerToken',body:{addressId:'{{addressId}}'}});
  const orders=folder('09 Pedidos e historial');
  add(orders,'Listar pedidos propios','GET','/api/orders',200,{token:'buyerToken',tests:"pm.test('Exactly two orders',()=>pm.expect(b.length).to.eql(2));"});
  add(orders,'Comprador ajeno no consulta','GET','/api/orders/{{orderId}}',404,{token:'buyerOtherToken'});
  add(orders,'Vendedor ajeno no consulta','GET','/api/orders/{{orderId}}',404,{token:'sellerOtherToken'});
  add(orders,'Comprador no prepara','PUT','/api/orders/{{orderId}}/status',403,{token:'buyerToken',body:{status:'PREPARING'}});
  add(orders,'No omitir estados','PUT','/api/orders/{{orderId}}/status',409,{token:'sellerToken',body:{status:'DELIVERED'}});
  for(const status of ['PREPARING','SHIPPED','DELIVERED'])add(orders,'Transicion '+status,'PUT','/api/orders/{{orderId}}/status',200,{token:'sellerToken',body:{status},tests:`pm.test('Persisted state',()=>pm.expect(b.status).to.eql('${status}'));`});
  add(orders,'Cancelacion exige motivo','PUT','/api/orders/{{otherOrderId}}/status',400,{token:'buyerToken',body:{status:'CANCELED'}});
  add(orders,'Cancelar segundo pedido','PUT','/api/orders/{{otherOrderId}}/status',200,{token:'buyerToken',body:{status:'CANCELED',reason:'Cancelacion ficticia controlada'}});
  add(orders,'Cambiar catalogo tras compra','PUT','/api/products/{{productId}}',204,{token:'sellerToken',body:{title:'Changed after checkout',price:'12.00'}});
  add(orders,'Cambiar direccion tras compra','PUT','/api/addresses/{{addressId}}',204,{token:'buyerToken',body:{city:'Despues del checkout'}});
  add(orders,'Snapshots e historial inmutables','GET','/api/orders/{{orderId}}',200,{token:'buyerToken',tests:"pm.test('Immutable product snapshot',()=>{pm.expect(b.items[0].productTitle).to.eql('Postman primary');pm.expect(b.items[0].unitPrice).to.eql('11.00');pm.expect(b.total).to.eql('22.00');});pm.test('Immutable address',()=>pm.expect(b.deliveryAddressSnapshot).to.eql(JSON.parse(pm.variables.get('addressSnapshot'))));pm.test('Complete history',()=>pm.expect(b.history.map(h=>h.newStatus)).to.eql(['PENDING','PREPARING','SHIPPED','DELIVERED']));"});
  const security=folder('10 Seguridad y suspension');
  add(security,'Sin JWT','GET','/api/products',401);
  add(security,'JWT invalido','GET','/api/products',401,{headers:[{key:'Authorization',value:'Bearer invalid.synthetic.token'}]});
  add(security,'CORS no autorizado sin diagnosticos internos','GET','/api/products',500,{token:'buyerToken',headers:[{key:'Origin',value:'https://untrusted.example.invalid'}],tests:"pm.test('No stack or SQL diagnostics',()=>{pm.expect(b).not.to.have.property('stack');pm.expect(b).not.to.have.property('sql');});"});
  add(security,'Ruta roles retirada','GET','/api/roles',410,{token:'adminToken'});
  add(security,'Ruta files retirada','GET','/api/files/1',410);
  add(security,'Suspension sin motivo','PUT','/api/users/sellers/{{sellerId}}/suspend',400,{token:'adminToken',body:{reason:''}});
  add(security,'ADMIN suspende vendedor aprobado','PUT','/api/users/sellers/{{sellerId}}/suspend',200,{token:'adminToken',body:{reason:'Incumplimiento ficticio controlado'},tests:"pm.test('Suspended',()=>pm.expect(b.status).to.eql('SUSPENDED'));"});
  add(security,'Suspension duplicada no confirmada','PUT','/api/users/sellers/{{sellerId}}/suspend',409,{token:'adminToken',body:{reason:'Duplicated'}});
  add(security,'JWT anterior ya no publica','PUT','/api/products/{{productId}}',403,{token:'sellerToken',body:{stock:100}});
  add(security,'Producto suspendido oculto','GET','/api/products/{{productId}}',404,{token:'buyerToken'});
  add(security,'Producto suspendido no comprable','POST','/api/cart/items',409,{token:'buyerToken',body:{productId:'{{productId}}',quantity:1}});
  add(security,'Suspender cuenta compradora auxiliar','PUT','/api/users/{{buyerOtherEmail}}',204,{token:'adminToken',body:{status:'SUSPENDED'}});
  add(security,'JWT de cuenta suspendida bloqueado','GET','/api/auth/time',403,{token:'buyerOtherToken'});
  const audit=folder('11 Auditoria');
  add(audit,'Lectura ADMIN con permiso solo en fixture','GET','/api/audit-logs?limit=100',200,{token:'adminToken',tests:"pm.test('Relevant audit events',()=>{pm.expect(b.length>0).to.eql(true);pm.expect(b.some(e=>e.action==='seller.suspended')).to.eql(true);});pm.test('No private details',()=>pm.expect(b.some(e=>Object.prototype.hasOwnProperty.call(e,'details'))).to.eql(false));"});
  add(audit,'Auditoria no accesible por BUYER','GET','/api/audit-logs',403,{token:'buyerToken'});
  add(audit,'Paginacion invalida','GET','/api/audit-logs?limit=101',400,{token:'adminToken'});
  add(audit,'No hay eliminacion HTTP de auditoria','DELETE','/api/audit-logs/1',404,{token:'adminToken'});
  return {info:{_postman_id:'3872736b-686a-4256-a0ed-1782bf148e51',name:'Secure Ecommerce - isolated MySQL HTTP suite',
    schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description:'Run only with postman/scripts/run.js or its --serve environment. Real Node/MySQL; email and Cloudinary are local simulations. Never point at the habitual API. Run folders in order; tokens/IDs live only in run-scoped pm.variables.'},
    event:[{listen:'prerequest',script:{type:'text/javascript',exec:['('+guard.toString()+')();']}},
      {listen:'test',script:{type:'text/javascript',exec:[
        "pm.test('No X-Powered-By',()=>pm.expect(pm.response.headers.has('X-Powered-By')).to.eql(false));",
        "if(pm.response.code!==204&&!pm.request.url.toString().includes('/__postman/mailbox')){pm.test('No stored password fields',()=>{function inspect(v){if(!v||typeof v!=='object')return;for(const key of Object.keys(v)){pm.expect(['passwordHash','password','apiKey','apiSecret'].includes(key)).to.eql(false);inspect(v[key]);}}inspect(pm.response.json());});}"
      ]}}],item:folders};
}
if(require.main===module){const target=path.join(__dirname,'../collections/secure-ecommerce.postman_collection.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(build(),null,2)+'\n');console.log('Postman v2.1 collection generated.');}
module.exports={build};
