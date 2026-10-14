// Esquemas de identidad estándar basados en especificaciones W3C y WS-Federation
// Utilizados para garantizar interoperabilidad entre plataformas (Node.js, .NET, Java)
const ClaimTypes = {
  Name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  GivenName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  Role: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'
};

module.exports = ClaimTypes;
