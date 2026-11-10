import {squeekSnapshot} from '../server/chain.mjs';
const result=await squeekSnapshot('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
console.log(JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v));
