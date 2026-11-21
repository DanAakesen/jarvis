import { createHtmlViewModule } from '../../../core/html-view.js';
import { createImageGenerationModule } from '../../../core/image-generation.js';
import { createHtmlResearchModule } from '../../../core/research.js';
import { createWeatherModule } from '../../../core/weather.js';
import { createWebResearchModule } from '../../../core/web-research.js';
import { createWorkspacePinsModule } from '../../../core/workspace-pins.js';
import { createWorkspacesModule } from '../../../core/workspaces.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/** Workspace items and pins, HTML views and charts, weather, image generation and research. */
export const workspaceGroup: GroupFactory = () => ({
  id: 'workspace',
  covers: ['workspaces', 'workspacePins', 'htmlView', 'weather', 'imageGeneration', 'webResearch', 'htmlResearch'],
  modules: [
    createWorkspacesModule(unstubbed('workspaceItems'), unstubbed('workspaceHtmlArtifacts'), unstubbed('workspaceArtifacts')),
    createWorkspacePinsModule(unstubbed('workspacePins')),
    createHtmlViewModule(unstubbed('workspaceHtmlArtifacts'), unstubbed('workspaceItems')),
    createWeatherModule(unstubbed('workspaceHtmlArtifacts'), undefined, unstubbed('workspaceItems')),
    createImageGenerationModule({ generator: unstubbed('imageGenerator'), artifacts: unstubbed('workspaceArtifacts'), workspaceItems: unstubbed('workspaceItems') }),
    createWebResearchModule(unstubbed('foundryClient'), 'test-model'),
    createHtmlResearchModule(unstubbed('foundryClient'), 'test-model', unstubbed('htmlArtifactStore'), {}, unstubbed('workspaceItems')),
  ],
});
