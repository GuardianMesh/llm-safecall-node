import type {ProviderResponse} from '../types'; export class MockProvider{ async complete(p:string):Promise<ProviderResponse>{return {text:'Mock: '+p}} async *stream(p:string){yield 'Mock: '+p} }
