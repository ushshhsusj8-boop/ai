// Pure synthetic streams; shared by Node and served-module browser verification.
export async function streamLineScenarios(root) {
  const {readEventStream,readChatStream}=await import(root+'event_stream.js');
  const encoder=new TextEncoder();
  function stream(text,cut=1){const bytes=encoder.encode(text);return new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=cut)c.enqueue(bytes.slice(i,i+cut));c.close();}});}
  const endings=['\n','\r','\r\n'],failures=[];let combinations=0;
  for(const fieldEnd of endings)for(const blankEnd of endings){
    if(fieldEnd==='\r'&&blankEnd==='\n')continue; // A single CRLF is one line ending.
    const wire='\ufeff: 合成心跳'+fieldEnd+blankEnd+'event: delta'+fieldEnd+'data: 你好🌱'+fieldEnd+'data: next'+fieldEnd+blankEnd+'event: done\r\ndata: {}\r\n\r\n';
    for(const stride of[1,2,3,7,10000]){combinations++;const frames=[];try{for await(const frame of readEventStream(stream(wire,stride)))frames.push(frame);if(JSON.stringify(frames)!==JSON.stringify([{event:'delta',data:'你好🌱\nnext'},{event:'done',data:'{}'}]))failures.push({fieldEnd,blankEnd,stride,frames});}catch(e){failures.push({fieldEnd,blankEnd,stride,error:e.name});}}
  }
  const deltas=[],statuses=[];let final,chatError='';try{final=await readChatStream(new Response(stream('event: status\r\ndata: {"message":"处理中"}\n\r\nevent: delta\ndata: {"text":"合成回答🌱"}\n\revent: done\r\ndata: {"text":"合成回答🌱"}\r\n\r\n',1)),x=>deltas.push(x),x=>statuses.push(x));}catch(e){chatError=e.name;}
  let truncatedText='',truncatedError='';try{await readChatStream(new Response(stream('event: delta\ndata: {"text":"已收到部分"}\n\nevent: done\ndata: {}')),x=>truncatedText+=x);}catch(e){truncatedError=e.message;}
  const notBlank=[];for await(const frame of readEventStream(stream('event: delta\r\ndata: one\r\ndata: two\r\n\r\n',1)))notBlank.push(frame);
  let controller,timer;const open=new ReadableStream({start(c){controller=c;c.enqueue(encoder.encode('event: delta\rdata: now\r\r'));}}),iterator=readEventStream(open);const firstPromise=iterator.next();
  const early=await Promise.race([firstPromise.then(value=>({ready:true,value:value.value})),new Promise(resolve=>timer=setTimeout(()=>resolve({ready:false}),500))]);clearTimeout(timer);controller.enqueue(encoder.encode('\nevent: done\ndata: {}\n\n'));controller.close();const first=await firstPromise;const tail=[];for await(const frame of iterator)tail.push(frame);
  const limited={};for(const[name,payload]of[['event','data: '+ 'x'.repeat(1024*1024+1)],['total','x'.repeat(8*1024*1024+1)]]){let cancelled=false;const bytes=encoder.encode(payload),input=new ReadableStream({start(c){c.enqueue(bytes);},cancel(){cancelled=true;}});try{for await(const frame of readEventStream(input)){}limited[name]={error:''};}catch(e){limited[name]={error:e.message,cancelled};}}
  let cancelledOnReturn=false;const cancellationStream=new ReadableStream({start(c){c.enqueue(encoder.encode('data: one\n\n'));},cancel(){cancelledOnReturn=true;}});for await(const frame of readEventStream(cancellationStream))break;
  return {framing:{combinations,failures},chat:{deltas,statuses,final:final||null,error:chatError},boundaries:{singleCRLF:notBlank,truncatedText,truncatedError,earlyCR:early.ready,earlyFrame:first.value,tail},limits:limited,cancelledOnReturn};
}
