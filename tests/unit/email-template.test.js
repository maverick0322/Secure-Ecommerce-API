'use strict';
const templates=require('../../services/email-template.service'),gmail=require('../../services/gmail.service');
it.each(['registration','recovery'])('renders accessible text and escaped HTML without external resources: %s',purpose=>{
  const message=templates.verification({code:'123456',purpose,name:'<script>&"\' Persona'});
  expect(message.text).toContain('123456');expect(message.html).toContain('123456');expect(message.html).toContain('&lt;script&gt;');
  expect(message.html).not.toMatch(/<script|<img|https?:\/\//i);expect(message.text).toContain('10 minutos');
  expect(message.html).toContain('Secure Ecommerce');expect(message.html).toContain('width="100%"');
});
it('builds a correct two-part CRLF MIME envelope with UTF8 base64 parts',()=>{
  const message=templates.verification({code:'123456',purpose:'recovery',name:'José'});
  const mime=Buffer.from(gmail.mimeMessage('sender@example.invalid','buyer@example.invalid',message.subject,message.text,message.html),'base64url').toString('utf8');
  const boundary=/boundary="([^"]+)"/.exec(mime)[1];const parts=mime.split('--'+boundary);
  expect(parts).toHaveLength(4);expect(parts[1]).toContain('text/plain');expect(parts[2]).toContain('text/html');
  for(const [part,text]of [[parts[1],message.text],[parts[2],message.html]]){
    const base64=part.split('\r\n\r\n')[1].trim();expect(Buffer.from(base64,'base64').toString('utf8')).toBe(text);
    expect(base64.split('\r\n').every(line=>line.length<=76)).toBe(true);
  }
  expect(mime).not.toMatch(/(?<!\r)\n/);
});
it.each([{code:'<12345'},{code:123456},{code:['123456']},{code:'123456',purpose:'admin'},{code:'123456',name:'x'.repeat(121)}])('rejects unsafe template inputs %#',input=>expect(()=>templates.verification(input)).toThrow());
it('retains plain text sending and rejects oversized or malformed HTML and header injection',()=>{
  const plain=Buffer.from(gmail.mimeMessage('s@example.invalid','b@example.invalid','Subject','Text'),'base64url').toString();
  expect(plain).toContain('text/plain');expect(plain).not.toContain('multipart');
  for(const html of [null,'x'.repeat(32769),'\0'])expect(()=>gmail.mimeMessage('s@example.invalid','b@example.invalid','Subject','Text',html)).toThrow();
  expect(()=>gmail.mimeMessage('s@example.invalid','b@example.invalid','Bad\r\nBcc: other','Text','<p>text</p>')).toThrow();
});
