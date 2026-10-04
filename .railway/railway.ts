import { defineRailway } from 'railway/iac';
import { parseSelection, railwayProject } from '../deploy/railway-project.ts';

export default defineRailway(() => railwayProject(
  parseSelection(process.env.DEMO_BACKENDS),
  process.env.QUIKMARQ_SOURCE_REPO,
));
