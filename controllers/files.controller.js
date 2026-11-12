'use strict';
const retired=(req,res)=>res.status(410).json({status:410,message:'Recurso hist?rico retirado. Use las im?genes del producto.'});
module.exports={get:retired,getAll:retired,getDetails:retired,retired};
