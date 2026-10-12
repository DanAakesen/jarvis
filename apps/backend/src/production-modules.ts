import type { BackendModule } from './modules.js';

export interface ProductionModules {
  readonly core: BackendModule;
  readonly conversation: BackendModule;
  readonly factory: BackendModule;
  readonly sleep: BackendModule;
  readonly recipes: BackendModule;
  readonly vault: BackendModule | undefined;
  readonly webResearch: BackendModule | undefined;
  readonly htmlResearch: BackendModule | undefined;
  readonly google: BackendModule | undefined;
  readonly githubWebhook: BackendModule;
  readonly pcBridge: BackendModule;
  readonly phoneCall: BackendModule | undefined;
  readonly phoneStatus: BackendModule;
  readonly browserAgent: BackendModule | undefined;
  readonly imageGeneration: BackendModule | undefined;
  readonly htmlView: BackendModule | undefined;
  readonly weather: BackendModule | undefined;
  readonly folio: BackendModule | undefined;
  readonly workspacePins: BackendModule | undefined;
  readonly screenVision: BackendModule | undefined;
  readonly visionWatch: BackendModule | undefined;
  readonly voiceRelay: BackendModule | undefined;
  readonly teamsBot: BackendModule | undefined;
}

export function createProductionModules(modules: ProductionModules): BackendModule[] {
  return [
    modules.core,
    modules.conversation,
    modules.factory,
    modules.sleep,
    modules.recipes,
    ...(modules.vault ? [modules.vault] : []),
    ...(modules.webResearch ? [modules.webResearch] : []),
    ...(modules.htmlResearch ? [modules.htmlResearch] : []),
    ...(modules.google ? [modules.google] : []),
    modules.githubWebhook,
    modules.pcBridge,
    ...(modules.phoneCall ? [modules.phoneCall] : []),
    modules.phoneStatus,
    ...(modules.browserAgent ? [modules.browserAgent] : []),
    ...(modules.imageGeneration ? [modules.imageGeneration] : []),
    ...(modules.htmlView ? [modules.htmlView] : []),
    ...(modules.weather ? [modules.weather] : []),
    ...(modules.folio ? [modules.folio] : []),
    ...(modules.workspacePins ? [modules.workspacePins] : []),
    ...(modules.screenVision ? [modules.screenVision] : []),
    ...(modules.visionWatch ? [modules.visionWatch] : []),
    ...(modules.voiceRelay ? [modules.voiceRelay] : []),
    ...(modules.teamsBot ? [modules.teamsBot] : []),
  ];
}
