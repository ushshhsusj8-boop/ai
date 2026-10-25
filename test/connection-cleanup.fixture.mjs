// Synthetic connection metadata and keys; no provider requests.
export function cleanupConnections(count,modelCount=1){
 return Array.from({length:count},(_,i)=>{
  const models=Array.from({length:modelCount},(_,j)=>'qa-'+String(j).padStart(3,'0')+'-'+'x'.repeat(174));
  return {id:'mine-'+i.toString(16).padStart(24,'0'),label:'合成连接 '+i,apiUrl:'https://models.example.org/v1/chat/completions',protocol:'chat-completions',apiKey:'qa-synthetic-key-'+i,models,model:models[0],vision:false};
 });
}
export const cleanupPayload=connections=>connections.map(({keyConfigured,apiKey,...c})=>({...c,apiKey:''}));
