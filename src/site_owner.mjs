// Run only in the trusted server shell, after a private state/configuration backup.
import {createAccountStore} from './accounts.mjs';
import {createSiteAdministration} from './site_administration.mjs';
import {loadConfig} from './config.mjs';
import {dirname,join} from 'node:path';
const args=process.argv.slice(2);
let [file,username]=args;
if(args.length===1&&args[0]==='--issue-code'){const config=loadConfig();file=config.accountStoreFile||(config.sharedConversationsFile?join(dirname(config.sharedConversationsFile),'accounts.json'):'./data/accounts.json');username='--issue-code';}
if(!file||!username){console.error('Usage: node --env-file=YOUR_ENV src/site_owner.mjs --issue-code | node src/site_owner.mjs ACCOUNT_FILE EXISTING_USERNAME');process.exit(2);}
try{const accounts=createAccountStore(file),administration=createSiteAdministration({file:accounts.administrationFile,findUser:accounts.findUserByUsername,requireUser:accounts.requireUser});
 if(username==='--issue-code'){console.log('One-time website owner binding code (valid 30 minutes):');console.log(administration.issueSetupCode());}
 else {const result=administration.bootstrapOwner(username);console.log(JSON.stringify({configured:true,role:result.role,revision:result.revision}));}
}catch(error){console.error(error.statusCode===404?'Existing website username not found.':error.statusCode===409?'Owner already configured; no change made.':'Owner setup failed; existing state retained.');process.exitCode=1;}
