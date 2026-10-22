// Linux runner only. Hold directory handles and never follow user-controlled links.
import {constants} from 'node:fs';
import {open,opendir} from 'node:fs/promises';
import {ARTIFACT_COUNT,ARTIFACT_FILE_BYTES,ARTIFACT_TOTAL_BYTES,validArtifactName} from '../public/code_artifact_tools.js';
export async function collectCodeArtifacts(root) {
  if (process.platform !== 'linux' || constants.O_NOFOLLOW === undefined) throw Error('Safe artifact collection requires Linux');
  const files=[]; let visited=0,total=0,skipped=false;
  const directoryFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
  async function walk(handle,prefix='',depth=0) {
    const directory=await opendir('/proc/self/fd/'+handle.fd,{bufferSize:8});
    for await (const entry of directory) {
      if (++visited>128 || files.length>=ARTIFACT_COUNT) { skipped=true; break; }
      const name=prefix+entry.name;
      if (!validArtifactName(name) || entry.isSymbolicLink()) { skipped=true; continue; }
      const path='/proc/self/fd/'+handle.fd+'/'+entry.name; let child;
      try {
        if(entry.isDirectory()) {
          if(depth>=3) { skipped=true; continue; }
          child=await open(path,directoryFlags);await walk(child,name+'/',depth+1);continue;
        }
        if(!entry.isFile()) { skipped=true; continue; }
        child=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        const stat=await child.stat();
        if(!stat.isFile() || stat.size>ARTIFACT_FILE_BYTES || stat.size<0 || total+stat.size>ARTIFACT_TOTAL_BYTES) { skipped=true; continue; }
        const buffer=Buffer.alloc(stat.size+1);let length=0;
        while(length<buffer.length) {const {bytesRead}=await child.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;}
        if(length!==stat.size) { skipped=true; continue; }
        total+=length;files.push({name,size:length,data:buffer.subarray(0,length).toString('base64')});
      } catch { skipped=true; }
      finally {await child?.close();}
      if(visited>128)break;
    }
  }
  let handle;
  try {handle=await open(root,directoryFlags);await walk(handle);}
  catch(error) {if(error.code!=='ENOENT')skipped=true;}
  finally {await handle?.close();}
  return {files,fileNotice:skipped?'部分生成文件因链接、路径、数量、扫描或大小限制未回传。':''};
}
