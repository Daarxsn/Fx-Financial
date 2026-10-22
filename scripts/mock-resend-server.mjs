import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const token="ci-email-test-only";
const messages=new Map();
const idempotency=new Map();

function reply(response,status,body) {
  response.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
  response.end(JSON.stringify(body));
}
const server=createServer(async(request,response)=>{
  if(request.method==="GET" && request.url==="/health") {
    reply(response,200,{status:"ok"});return;
  }
  if(request.headers["x-test-token"]!==token) {
    reply(response,401,{error:"unauthorized"});return;
  }
  if(request.method==="GET" && request.url==="/__test/messages") {
    reply(response,200,{count:messages.size,messages:[...messages.values()].map(item=>({id:item.id,idempotencyKey:item.idempotencyKey,subject:item.payload.subject,to:item.payload.to,attachmentCount:Array.isArray(item.payload.attachments)?item.payload.attachments.length:0}))});return;
  }
  if(request.method==="POST" && request.url==="/emails") {
    if(request.headers.authorization!=="Bearer ci-resend-test-key") { reply(response,401,{error:"invalid api key"});return; }
    const key=String(request.headers["idempotency-key"]??"");
    if(!key) { reply(response,400,{error:"idempotency key required"});return; }
    let raw="";
    request.on("data",chunk=>{raw+=chunk.toString("utf8");if(raw.length>10*1024*1024)request.destroy();});
    request.on("end",()=>{
      let payload;
      try { payload=JSON.parse(raw); } catch { reply(response,400,{error:"bad json"});return; }
      const existing=idempotency.get(key);
      if(existing) { reply(response,200,{id:existing.id});return; }
      if(!payload.from||!Array.isArray(payload.to)||!payload.to.length||!payload.subject||!payload.text||!payload.html) {
        reply(response,422,{error:"required field missing"});return;
      }
      const id="re_"+randomUUID();
      const item={id,idempotencyKey:key,payload};
      idempotency.set(key,item);messages.set(id,item);
      reply(response,200,{id});
    });
    return;
  }
  reply(response,404,{error:"not found"});
});
server.listen(Number(process.env.MOCK_RESEND_PORT||3030),"127.0.0.1",()=>console.log("Mock email provider ready on localhost."));
