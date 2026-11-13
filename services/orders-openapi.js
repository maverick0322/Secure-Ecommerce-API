'use strict';
module.exports=spec=>{
  const id={type:'string',pattern:'^[1-9][0-9]{0,19}$'};
  const money={type:'string',pattern:'^[0-9]{1,10}\\.[0-9]{2}$'};
  const status={type:'string',enum:['PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED']};
  const snapshot={type:'object',additionalProperties:false,properties:Object.fromEntries(
    ['recipientName','street','exteriorNumber','interiorNumber','neighborhood','city','state','postalCode','country'].map(k=>[k,{type:'string',...(k==='interiorNumber'&&{'x-nullable':true})}]))};
  spec.definitions.OrderItem={type:'object',properties:{id,orderId:id,productId:{type:'integer'},productTitle:{type:'string'},quantity:{type:'integer',minimum:1},unitPrice:money}};
  spec.definitions.OrderHistory={type:'object',properties:{id,orderId:id,previousStatus:{...status,'x-nullable':true},newStatus:status,changedByUserId:{type:'string',format:'uuid','x-nullable':true},reason:{type:'string','x-nullable':true},occurredAt:{type:'string',format:'date-time'}}};
  spec.definitions.Order={type:'object',properties:{id,buyerId:{type:'string',format:'uuid'},sellerId:{type:'string',format:'uuid'},checkoutId:{type:'string',format:'uuid'},status,total:money,
    deliveryAddressSnapshot:snapshot,createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'},items:{type:'array',items:{$ref:'#/definitions/OrderItem'}},history:{type:'array',items:{$ref:'#/definitions/OrderHistory'}}}};
  const body=(properties,required)=>({name:'body',in:'body',required:true,schema:{type:'object',additionalProperties:false,properties,required}});
  const operations=[
    ['/api/checkout/quote','post',200,'BUYER: obtiene cotización firmada válida 10 minutos para todo su carrito (1..100 productos). Precios, vendedores y totales provienen del servidor. Debe mostrarla y solicitar confirmación del comprador.',
      [body({addressId:id},['addressId'])],{type:'object',properties:{checkoutId:{type:'string',format:'uuid'},quote:{type:'string'},expiresIn:{type:'integer',example:600},address:snapshot,orders:{type:'array',items:{type:'object',properties:{sellerId:{type:'string'},total:money,items:{type:'array',items:{type:'object',properties:{productId:{type:'integer'},sellerId:{type:'string'},title:{type:'string'},price:money,quantity:{type:'integer'}}}}}}}}}],
    ['/api/checkout','post',201,'BUYER: confirma únicamente la cotización firmada. Si cambiaron precio, contenido o dirección, responde 409 y requiere nueva cotización y reconfirmación. Crea un pedido por vendedor y descuenta stock atómicamente. Reintentos idénticos devuelven 200, incluso después de caducar la cotización ya confirmada.',
      [body({quote:{type:'string',maxLength:100000}},['quote'])],{type:'object',properties:{replayed:{type:'boolean'},orders:{type:'array',items:{$ref:'#/definitions/Order'}}}}],
    ['/api/orders','get',200,'BUYER: pedidos propios. SELLER aprobado: pedidos de su tienda. ADMIN: consulta general. Devuelve hasta 100 pedidos recientes.',[],{type:'array',items:{$ref:'#/definitions/Order'}}],
    ['/api/orders/{id}','get',200,'Propietario BUYER/SELLER aprobado o ADMIN: consulta snapshots e historial sin modificarlos.',[{name:'id',in:'path',required:true,...id}],{$ref:'#/definitions/Order'}],
    ['/api/orders/{id}/status','put',200,'Propietario SELLER aprobado o ADMIN: PENDING → PREPARING → SHIPPED → DELIVERED. BUYER solo cancela PENDING; SELLER/ADMIN pueden cancelar PENDING/PREPARING con motivo. No repone stock automáticamente. Historial y auditoría se insertan en la misma transacción.',
      [{name:'id',in:'path',required:true,...id},body({status:{type:'string',enum:['PREPARING','SHIPPED','DELIVERED','CANCELED']},reason:{type:'string',minLength:1,maxLength:255}},['status'])],{$ref:'#/definitions/Order'}]
  ];
  for(const [path,method,success,description,parameters,schema] of operations){
    const responses={[success]:{description:'Operación completada.',schema}};
    if(path==='/api/checkout') responses[200]={description:'Compra ya confirmada; no descuenta inventario de nuevo.',schema};
    for(const code of [400,401,403,404,409,500]) responses[code]={description:'Solicitud inválida, no autorizada, inexistente, conflicto o error interno.',schema:{$ref:'#/definitions/ErrorResponse'}};
    spec.paths[path]||={};spec.paths[path][method]={description,parameters,security:[{bearerAuth:[]}],responses};
  }
};
