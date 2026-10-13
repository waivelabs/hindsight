/* Authored CCC UI view state. Durable authenticated view history; never model memory. */
(function installReflectSession(root) {
  "use strict";
  if (!root || root.CCCReflectSession) return;
  const PREFIX = "ccc.reflect-view.v1:";
  const MAX_BYTES = 2 * 1024 * 1024;
  const defaults = Object.freeze({query:"",budget:"mid",maxTokens:4096,includeFacts:true,
    includeToolCalls:true,tab:"answer",result:null,tags:"",tagsMatch:"any",factTypes:Object.freeze([]),
    excludeMentalModels:false,excludeMentalModelIds:"",responseSchema:"",optionsOpen:false,loading:false});
  const persistent = Object.keys(defaults).filter(key => key !== "loading");
  const banks = new Map(), listeners = new Set();
  let epoch = 0, authenticated = false, authPromise = null, authDenied = false;
  const originalFetch = root.fetch.bind(root);
  const bytes = raw => typeof root.TextEncoder === "function" ? new root.TextEncoder().encode(raw).byteLength : raw.length*2;
  const markerKey="ccc.reflect-view.logout";
  const marker=() => {try{return root.localStorage.getItem(markerKey)||"0";}catch(_){return "0";}};
  let seenGeneration=marker();
  let channel = null;
  const notify = () => listeners.forEach(fn => fn());
  function clear(broadcast = true) {
    epoch++; authDenied = true; authenticated = false; authPromise = null; banks.clear();
    if (broadcast) {
      try { channel && channel.postMessage("clear"); } catch (_) {}
      try { root.localStorage.setItem(markerKey,String(Date.now())+":"+Math.random());seenGeneration=marker(); } catch (_) {}
    }
    notify();
  }
  try {
    channel = new root.BroadcastChannel("ccc.reflect-view.logout");
    channel.onmessage = event => { if (event.data === "clear") clear(false); };
  } catch (_) {}
  root.addEventListener("storage",event => { if(event.key === "ccc.reflect-view.logout") clear(false); });
  function validField(key,value) {
    if (!(key in defaults)) return false;
    if (key === "result") {
      if(value===null) return true;
      if(typeof value!=="object" || Array.isArray(value) || typeof value.text!=="string") return false;
      for(const [container,keys] of [["based_on",["memories","mental_models","directives"]],["trace",["tool_calls","llm_calls"]]]) {
        if(value[container]!=null) {
          if(typeof value[container]!=="object" || Array.isArray(value[container])) return false;
          for(const name of keys) if(value[container][name]!=null && !Array.isArray(value[container][name])) return false;
        }
      }
      if(value.usage!=null && (typeof value.usage!=="object" || Array.isArray(value.usage) || Object.values(value.usage).some(x=>typeof x!=="number" || !Number.isFinite(x)))) return false;
      return true;
    }
    if (key === "factTypes") return Array.isArray(value) && value.length <= 3 && value.every(x => ["world","experience","observation"].includes(x));
    if (key === "maxTokens") return Number.isInteger(value) && value >= 1 && value <= 8192;
    if (typeof defaults[key] === "boolean") return typeof value === "boolean";
    if (typeof value !== "string" || value.length > 16000) return false;
    if (key === "budget") return ["low","mid","high"].includes(value);
    if (key === "tab") return ["answer","sources","tools","trace","structured","json"].includes(value);
    if (key === "tagsMatch") return ["any","all","any_strict","all_strict","exact"].includes(value);
    return true;
  }
  function load(bank) {
    let fields={},resultSavedAt=null;
    if (authenticated) try {
      const raw=root.sessionStorage.getItem(PREFIX+encodeURIComponent(bank));
      if (raw && bytes(raw) <= MAX_BYTES) {
        const parsed=JSON.parse(raw);
        if(parsed.version===1 && parsed.bank===bank && parsed.fields && typeof parsed.fields==="object") {
          for(const key of persistent) if(validField(key,parsed.fields[key])) fields[key]=parsed.fields[key];
          if(Number.isFinite(parsed.resultSavedAt)) resultSavedAt=parsed.resultSavedAt;
        }
      }
    } catch (_) {}
    return {fields,resultSavedAt};
  }
  function record(bank) {
    if(!banks.has(bank)) {
      const item=load(bank);banks.set(bank,item);
      if(authenticated)track(hydrate(bank,item,epoch));
    }
    return banks.get(bank);
  }
  function save(bank,item) {
    if(!authenticated) return;
    try {
      const fields={}; for(const key of persistent) if(key in item.fields) fields[key]=item.fields[key];
      const raw=JSON.stringify({version:1,bank,fields,resultSavedAt:item.resultSavedAt,logoutGeneration:marker()});
      const key=PREFIX+encodeURIComponent(bank);
      if(bytes(raw)<=MAX_BYTES) root.sessionStorage.setItem(key,raw);
      // Preserve older recoverable cache when a new snapshot exceeds the local bound.
    } catch (_) {}
  }
  function ensureAuthenticated() {
    if(authDenied || authenticated || authPromise || /(?:^|\/)login(?:\/|$)/.test(root.location.pathname)) return;
    const requestEpoch=epoch;
    authPromise=originalFetch("/api/banks",{credentials:"same-origin",cache:"no-store"})
      .then(response => {
        if(requestEpoch!==epoch) return;
        if(response.status!==200 || response.redirected || !(response.headers.get("content-type") || "").includes("application/json")) { clear(); return; }
        authenticated=true;
        // Discover every legacy cache without modifying or deleting any bytes.
        try {for(let i=0;i<root.sessionStorage.length;i++) {
          const key=root.sessionStorage.key(i);
          if(key && key.startsWith(PREFIX)){const bank=decodeURIComponent(key.slice(PREFIX.length));if(!banks.has(bank))banks.set(bank,{fields:{},resultSavedAt:null});}
        }}catch(_){}
        for(const [bank,item] of banks) {
          const saved=load(bank);
          // Edits made while auth was pending take precedence over cached state.
          item.fields={...saved.fields,...item.fields};
          item.resultSavedAt=item.resultSavedAt || saved.resultSavedAt;
          track(hydrate(bank,item,requestEpoch));
        }
        notify();
      }).catch(() => { /* A failed check reveals no cached data. */ })
      .finally(() => { if(requestEpoch===epoch) authPromise=null; });
  }
  function get(bank,key) {
    const currentGeneration=marker();
    if(currentGeneration!==seenGeneration) {seenGeneration=currentGeneration;clear(false);}
    return authenticated ? record(bank).fields[key] ?? defaults[key] : defaults[key];
  }
  function update(bank,key,value,capturedEpoch) {
    if(capturedEpoch!==epoch || !bank) return;
    const item=record(bank),next=typeof value==="function" ? value(get(bank,key)) : value;
    if(!validField(key,next)) return;
    if(key==="result" && next===null)return;
    item.fields={...item.fields,[key]:next};
    if(key==="result" && next!==null) item.resultSavedAt=Date.now();
    // Preserve the last completed answer during a failed/new generation.
    save(bank,item);
    if(key!=="loading") {
      if(timers.has(bank))root.clearTimeout(timers.get(bank));
      if(key==="result")queueSave(bank,item);
      else timers.set(bank,root.setTimeout(()=>{timers.delete(bank);queueSave(bank,item);},500));
    }
    notify();
  }
  const status = new Map(), saves = new Map(), pending = new Set(), timers = new Map(), acknowledged = new Map();
  function track(task){pending.add(task);task.finally(()=>pending.delete(task)).catch(()=>{});return task;}
  function endpoint(bank) {return "/api/banks?reflect_history_bank="+encodeURIComponent(bank);}
  function snapshot(bank,item) {return {version:1,bank,fields:{...item.fields,loading:undefined},resultSavedAt:item.resultSavedAt};}
  async function request(bank,body,requestEpoch=epoch) {
    const response=await originalFetch(endpoint(bank),{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
    if(response.status===401){if(requestEpoch===epoch)clear();throw new Error("Authentication required");}
    if(!response.ok){const error=new Error("Reflect history unavailable");error.status=response.status;throw error;}
    return response.json();
  }
  function queueSave(bank,item) {
    if(!authenticated)return;
    const capturedEpoch=epoch,body=snapshot(bank,item);
    let raw;try{raw=root.sessionStorage.getItem(PREFIX+encodeURIComponent(bank));}catch(_){}
    status.set(bank,"Saving Reflect view…");notify();
    const previous=saves.get(bank)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>commit(bank,body,capturedEpoch)).then(response=>{
      const winner=response.latest_view && response.latest_view.state;
      if(capturedEpoch===epoch && winner && winner.resultSavedAt>item.resultSavedAt && validField("result",winner.fields?.result)) {
        item.fields={...item.fields,result:winner.fields.result};item.resultSavedAt=winner.resultSavedAt;
      }
      if(raw)acknowledged.set(bank,raw);
      if(capturedEpoch===epoch){status.set(bank,"Saved to this device server");notify();}
    }).catch(()=>{if(capturedEpoch===epoch){status.set(bank,"Could not save Reflect view. Your current answer remains available.");notify();}});
    saves.set(bank,task);track(task);
  }
  function canonical(value) {
    if(Array.isArray(value)) return value.map(canonical);
    if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
    return value;
  }
  function answerState(state) {
    const fields={};
    for(const key of Object.keys(state.fields)) if(!['tab','optionsOpen','loading'].includes(key)) fields[key]=state.fields[key];
    return canonical({...state,fields});
  }
  function identity(state) {return JSON.stringify(answerState(state));}
  async function entry(state) {
    const bytes=new root.TextEncoder().encode(identity(state));
    const hash=await root.crypto.subtle.digest("SHA-256",bytes);
    return {id:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join(""),created_at:new Date(state.resultSavedAt||Date.now()).toISOString(),state:answerState(state)};
  }
  async function commit(bank,state,capturedEpoch,importOnly=false) {
    const imported=await entry(state);
    for(let attempt=0;attempt<3;attempt++) {
      const current=await request(bank,undefined,capturedEpoch);
      const old=current.latest_view,oldState=old&&old.state;
      // Draft controls may change while the last completed answer remains visible.
      // Archive only a new completed result, preserving its generation inputs.
      const changedAnswer=!!state.fields.result && (!oldState ||
        state.resultSavedAt!==oldState.resultSavedAt ||
        JSON.stringify(canonical(state.fields.result))!==JSON.stringify(canonical(oldState.fields?.result)));
      const entries=changedAnswer && state.fields.result && Number.isFinite(state.resultSavedAt) ? [imported] : [];
      const latest=capturedEpoch!==epoch ? old : importOnly && old ? old : {entry_id:changedAnswer?imported.id:old?.entry_id||null,state};
      try{return await request(bank,{schema_version:1,expected_version:current.version,entries,latest_view:latest},capturedEpoch);}
      catch(error){if(error.status!==409 || attempt===2)throw error;}
    }
  }
  async function hydrate(bank,item,capturedEpoch) {
    const originalFields=item.fields;
    try {
      // Import before restore; never erase old session records or returned history.
      if(Object.keys(item.fields).length) {
        let raw;try{raw=root.sessionStorage.getItem(PREFIX+encodeURIComponent(bank));}catch(_){}
        await commit(bank,snapshot(bank,item),capturedEpoch,true);if(raw)acknowledged.set(bank,raw);
      }
      const data=await request(bank,undefined,capturedEpoch);
      if(capturedEpoch!==epoch || !authenticated)return;
      const saved=data.latest_view && data.latest_view.state;
      if(saved && saved.fields && typeof saved.fields==="object") {
        const restored={};for(const key of persistent)if(validField(key,saved.fields[key]))restored[key]=saved.fields[key];
        if(item.fields===originalFields){item.fields=restored;item.resultSavedAt=saved.resultSavedAt;}
        else {const edited={};for(const key of persistent)if(item.fields[key]!==originalFields[key])edited[key]=item.fields[key];item.fields={...restored,...edited};if(!("result" in edited))item.resultSavedAt=saved.resultSavedAt;}
      }
      status.set(bank,"Saved to this device server");notify();
    } catch(_){if(capturedEpoch===epoch){status.set(bank,"Could not load saved Reflect history. Your current answer remains available.");notify();}}
  }
  function useBankState(React,bank,key) {
    if(!(key in defaults)) throw new Error("Unknown Reflect view field");
    const capturedEpoch=epoch;
    const value=React.useSyncExternalStore(fn => {listeners.add(fn);return () => listeners.delete(fn);},
      () => get(bank,key),() => defaults[key]);
    React.useEffect(() => {ensureAuthenticated();},[bank,epoch]);
    const setter=React.useCallback(next => update(bank,key,next,capturedEpoch),[bank,key,capturedEpoch]);
    return [value,setter];
  }
  // Invalidate before logout/login requests, including failed network requests.
  root.fetch=async function(input,init) {
    let ownRequest=false,isLogin=false;
    try {
      const url=new URL(typeof input==="string" ? input : input.url,root.location.href);
      ownRequest=url.origin===root.location.origin;
      isLogin=ownRequest && /\/api\/auth\/login$/.test(url.pathname);
      if(ownRequest && /\/api\/auth\/logout$/.test(url.pathname)) {
        // Wait for existing migrations/saves. Never delete history on logout.
        for(const [bank,timer] of timers){root.clearTimeout(timer);queueSave(bank,record(bank));}timers.clear();
        const flush=[...pending];clear(); // Hide source text before waiting on any network.
        let deadline;await Promise.race([Promise.allSettled(flush),new Promise(resolve=>{deadline=root.setTimeout(resolve,8000);})]);root.clearTimeout(deadline);
        for(const [bank,raw] of acknowledged)try{const key=PREFIX+encodeURIComponent(bank);if(root.sessionStorage.getItem(key)===raw)root.sessionStorage.removeItem(key);}catch(_){}
      }
      if(isLogin)clear();
    } catch (_) {}
    const requestEpoch=epoch;
    const response=await originalFetch(input,init);
    if(requestEpoch===epoch && ownRequest && response.status===401)clear();
    if(requestEpoch===epoch && isLogin && response.ok){authDenied=false;ensureAuthenticated();}
    return response;
  };
  root.addEventListener("beforeunload",event=>{if(pending.size || timers.size){event.preventDefault();event.returnValue="Reflect history is still saving.";}});
  if(/(?:^|\/)login(?:\/|$)/.test(root.location.pathname)) clear(false);
  root.CCCReflectSession={useBankState,clear,
    useStatus(React,bank){return React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>authenticated?status.get(bank)||"":"",()=>"");},
    notice(bank) { if(!authenticated)return "";const item=record(bank);return (status.get(bank)||"")+". "+(item.fields.result && item.resultSavedAt ?
      "Saved Reflect view from "+new Date(item.resultSavedAt).toLocaleString()+". This cached answer may be stale; it was not regenerated." : ""); }};
})(typeof window === "undefined" ? null : window);
