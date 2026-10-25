import {AsyncLocalStorage} from 'node:async_hooks';
import {configureLimitProvider,LEGACY_LIMITS} from '../public/site_limits.js';
const contexts=new AsyncLocalStorage();
configureLimitProvider(()=>contexts.getStore()||LEGACY_LIMITS);
export const withSiteLimits=(limits,operation)=>contexts.run(limits||LEGACY_LIMITS,operation);
