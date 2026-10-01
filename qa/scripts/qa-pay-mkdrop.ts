/* eslint-disable */
// helper: create a verified seller + published drop, print its 12-char link id
import { makeSeller, makeDrop, done } from "./qa-pay-lib";
(async()=>{ const s=await makeSeller("ui"); const d=await makeDrop(s,2000,{title:"UI drop"}); console.log(d.link); await done(); })();
