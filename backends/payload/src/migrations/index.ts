import * as migration_20261003_140135_initial from './20261003_140135_initial';

export const migrations = [
  {
    up: migration_20261003_140135_initial.up,
    down: migration_20261003_140135_initial.down,
    name: '20261003_140135_initial'
  },
];
