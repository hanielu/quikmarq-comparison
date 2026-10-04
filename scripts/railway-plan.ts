import { parseSelection, railwayProject } from '../deploy/railway-project.ts';

// Offline, reviewable desired configuration. The provider CLI owns live diff/apply.
const definition = railwayProject(parseSelection(process.env.DEMO_BACKENDS), process.env.QUIKMARQ_SOURCE_REPO);
console.log(JSON.stringify(definition, null, 2));
