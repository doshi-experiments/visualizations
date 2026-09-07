/* ═══════════════════════════════════════════════════════════════
   5 · BOOT — the registry

   Adding an exhibit is writing one module that default-exports the
   contract described in shell.js, then adding it to this array.
   Order here is the order of the tab strip, and the number keys
   1…n select them.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { boot } from './shell.js';
import growthCage from './growth-cage.js';
import silk from './silk.js';
import divergence from './divergence.js';

boot([growthCage, silk, divergence]);
