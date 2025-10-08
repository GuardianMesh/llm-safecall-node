import type {Provider,SafeResult,CallReport} from './types';
import {PolicyEngine} from './policy';
export class SafeCall<T=unknown>{
  private llm:Provider; private outputSchema?:any; private policy:PolicyEngine; private failSafe=true; private failSafeReturn='';
  constructor(opts:{llm:Provider;outputSchema?:any;policy?:PolicyEngine;failSafe?:boolean;failSafeReturn?:string}){
    this.llm=opts.llm; this.outputSchema=opts.outputSchema; this.policy=opts.policy??new PolicyEngine({});
    this.failSafe=opts.failSafe??true; this.failSafeReturn=opts.failSafeReturn??'';
  }
  private attach<V>(value:V,report:CallReport):SafeResult<V>{return {value,report}}
  private async core(prompt:string):Promise<SafeResult<any>>{
    const resp=await this.llm.complete(this.policy.preCall(prompt));
    const text=this.policy.postCall(resp.text, !!this.outputSchema);
    let value:any=text;
    if(this.outputSchema){ try{ value=this.outputSchema.parse(JSON.parse(text)) }catch{ value=this.outputSchema.parse({}) } }
    return this.attach(value,{latencyMs:0});
  }
  async generate(prompt:string){ if(!this.failSafe) return this.core(prompt); try{ return await this.core(prompt) }catch{ return this.attach(this.outputSchema?{}:this.failSafeReturn,{latencyMs:0}) } }
  async *streamGenerate(prompt:string){ try{ for await (const c of this.llm.stream(this.policy.preCall(prompt))){ yield this.policy.postCall(c,false) } }catch(e){ if(this.failSafe){ yield this.failSafeReturn; return } throw e } }
}
