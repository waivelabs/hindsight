// @ts-nocheck
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
/* Inserted inside the stock banks route module; a is official module25134. */
export async function reflectHistoryProxy(request) {
  const url=new URL(request.url);
  if(!url.searchParams.has("reflect_history_bank"))return null;
  const keys=[...url.searchParams.keys()],bank=url.searchParams.get("reflect_history_bank");
  const reject=(status,message)=>Response.json({error:message},{status,headers:{"cache-control":"no-store"}});
  if(keys.length!==1 || !["ccc-core","ccc-work"].includes(bank))return reject(400,"Invalid Reflect history scope");
  let body;
  if(request.method==="POST") {
    const host=request.headers.get("host");
    const origin=request.headers.get("origin");
    if(!["127.0.0.1:9999","localhost:9999"].includes(host) || origin!=="http://"+host)return reject(403,"Same-origin request required");
    if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return reject(415,"JSON required");
    const reader=request.body?.getReader();if(!reader)return reject(400,"Body required");
    let count=0,chunks=[];
    while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>8388608){await reader.cancel();return reject(413,"Reflect history request too large");}chunks.push(part.value);}
    body=new Uint8Array(count);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  }
  try {
    const response=await fetch(dataplaneBankUrl(bank,"/reflect-history"),{method:request.method==="POST"?"PUT":"GET",headers:getDataplaneHeaders(body?{"content-type":"application/json"}:{}),body,redirect:"error",cache:"no-store"});
    const reader=response.body?.getReader();let count=0,chunks=[];
    if(reader)while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>8388608){await reader.cancel();return reject(502,"Reflect history response too large");}chunks.push(part.value);}
    const output=new Uint8Array(count);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}
    return new Response(output,{status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(_){return reject(502,"Reflect history unavailable");}
}
