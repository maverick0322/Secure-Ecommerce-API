'use strict';
const http=require('node:http'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const windows=process.platform==='win32'?describe:describe.skip;
const quote=value=>"'"+value.replace(/'/g,"''")+"'";
const helper=path.resolve(__dirname,'../../scripts/http/Invoke-Utf8Json.ps1');
// Test the reviewed function as command source, without changing ExecutionPolicy
// or adding Bypass. Restricted hosts can run commands but cannot dot-source ps1.
const definition=fs.readFileSync(helper,'ascii');
const expected={name:'Electrónica',reason:'Cancelación: niño',address:{recipientName:'María Muñoz',street:'Peña',city:'Mérida'},special:'🙂 e\u0301'};
// ASCII source passed to Windows PowerShell, independent of script-file encoding.
const form="$body = @{ name = ('Electr'+[char]0xF3+'nica'); reason = ('Cancelaci'+[char]0xF3+'n: ni'+[char]0xF1+'o'); address = @{ recipientName = ('Mar'+[char]0xED+'a Mu'+[char]0xF1+'oz'); street = ('Pe'+[char]0xF1+'a'); city = ('M'+[char]0xE9+'rida') }; special = ([char]::ConvertFromUtf32(0x1F642)+' e'+[char]0x301) };";
function powershell(script){
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Local PowerShell fixture timed out'));},15000);
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');});child.stderr.on('data',chunk=>{output+=chunk.toString('utf8');});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error('PowerShell synthetic HTTP fixture failed (exit '+code+'): '+output));});
  });
}
windows('Windows PowerShell native UTF-8 transport, loopback only',()=>{
  let server,url,requests;
  beforeAll(async()=>{
    requests=[];server=http.createServer((req,res)=>{
      const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
        requests.push({method:req.method,headers:req.headers,body:Buffer.concat(chunks)});
        res.writeHead(req.url==='/conflict'?409:200,{'Content-Type':'application/json; charset=utf-8','Connection':'close'});res.end('{"ok":true}');
      });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
  });
  beforeEach(()=>{requests.length=0;});
  afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
  it('reproduces ASCII corruption before curl despite an HTTP UTF-8 header',async()=>{
    await powershell(form+" $OutputEncoding=[System.Text.Encoding]::ASCII; $body | ConvertTo-Json -Depth 32 -Compress | & curl.exe --silent --show-error --noproxy '*' --max-time 5 --header 'Content-Type: application/json; charset=utf-8' --data-binary '@-' "+quote(url)+" | Out-Null; if($LASTEXITCODE -ne 0){throw 'curl fixture failed'}");
    expect(requests).toHaveLength(1);const body=JSON.parse(requests[0].body.toString('utf8'));
    expect(body.name).toBe('Electr?nica');expect(body.reason).toBe('Cancelaci?n: ni?o');
    expect(requests[0].body.includes(Buffer.from('ó','utf8'))).toBe(false);
  },20000);
  it.each(['Object','Json'])('sends exact BOM-free UTF-8 bytes from the %s parameter set without changing global encoding',async mode=>{
    await powershell(definition+'; '+form+" $before=$OutputEncoding.WebName; Invoke-Utf8Json -Uri "+quote(url)+" -Method POST "+(mode==='Object'?'-Body $body':'-Json ($body | ConvertTo-Json -Depth 32 -Compress)')+" | Out-Null; if($OutputEncoding.WebName -ne $before){throw 'Global encoding changed'}");
    expect(requests).toHaveLength(1);const {body,headers}=requests[0];
    expect(body.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))).toBe(false);
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(body.toString('utf8'))).toEqual(expected);expect(body.includes(Buffer.from(expected.special,'utf8'))).toBe(true);
  },20000);
  it('preserves HTTP conflict behavior instead of reporting false success',async()=>{
    await powershell(definition+'; '+form+" try { Invoke-Utf8Json -Uri "+quote(url+'/conflict')+" -Method PUT -Body $body | Out-Null; throw 'Expected HTTP conflict' } catch { if([int]$_.Exception.Response.StatusCode -ne 409){throw}; exit 0 }");
    expect(requests).toHaveLength(1);expect(requests[0].method).toBe('PUT');
  },20000);
  it('rejects encoding ambiguity and invalid Unicode before sending a request',async()=>{
    await powershell(definition+"; $rejected=0; try { Invoke-Utf8Json -Uri "+quote(url)+" -Method POST -Body @{} -Headers @{'Content-Type'='text/plain'} | Out-Null } catch { $rejected++ }; try { Invoke-Utf8Json -Uri "+quote(url)+" -Method POST -Json ([string][char]0xD800) | Out-Null } catch { $rejected++ }; if($rejected -ne 2){throw 'Expected both invalid inputs to fail'}");
    expect(requests).toHaveLength(0);
  },20000);
});
