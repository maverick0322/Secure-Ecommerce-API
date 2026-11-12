'use strict';
module.exports = specification => {
  const integer = {type:'integer',minimum:1,maximum:4294967295};
  const product = {type:'integer',minimum:1,maximum:2147483647};
  const decimal = {type:'string',pattern:'^[0-9]+\\.[0-9]{2}$'};
  specification.definitions.Cart = {type:'object',properties:{id:{type:'string'},subtotal:decimal,
    items:{type:'array',items:{type:'object',properties:{productId:product,quantity:integer,title:{type:'string','x-nullable':true},
      unitPrice:{...decimal,'x-nullable':true},subtotal:{...decimal,'x-nullable':true},available:{type:'boolean'}}}}}};
  for (const [path,method,status,description] of [
    ['/api/cart','get',200,'BUYER: obtiene o reactiva su carrito persistente y calcula precios actuales.'],
    ['/api/cart/items','post',200,'BUYER: agrega cantidad o reactiva una línea propia; no reserva inventario.'],
    ['/api/cart/items/{productId}','put',200,'BUYER: reemplaza la cantidad positiva de un artículo propio.'],
    ['/api/cart/items/{productId}','delete',204,'BUYER: retira lógicamente un artículo propio.']
  ]) {
    const parameters = path.includes('{productId}') ? [{name:'productId',in:'path',required:true,...product}] : [];
    if (method === 'post' || method === 'put') parameters.push({name:'body',in:'body',required:true,schema:{type:'object',additionalProperties:false,
      required:method === 'post' ? ['productId','quantity'] : ['quantity'],
      properties:method === 'post' ? {productId:product,quantity:integer} : {quantity:integer}}});
    const responses = {[status]:{description:status === 204 ? 'Artículo retirado.' : 'Carrito calculado.',
      ...(status !== 204 && {schema:{$ref:'#/definitions/Cart'}})}};
    for (const code of [400,401,403,404,409,500]) responses[code] = {description:'Solicitud inválida, no autorizada, inexistente, en conflicto o error interno.',schema:{$ref:'#/definitions/ErrorResponse'}};
    specification.paths[path] ||= {};
    specification.paths[path][method] = {description,security:[{bearerAuth:[]}],parameters,responses};
  }
};
