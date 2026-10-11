#!/usr/bin/env node
// Prints source units (text + metadata) by id:  node scripts/show-unit.mjs p014.u02 p015.v1 ...
import { loadUnits } from './lib/content-lib.mjs';
const units = loadUnits();
for (const id of process.argv.slice(2)) {
  const u = units.get(id);
  if (!u) { console.log(`${id}: NOT FOUND`); continue; }
  console.log(`[${u.id} | page ${u.page} | ${u.kind} | ${u.scope}${u.figure ? ` | figure ${u.figure}` : ''}]\n${u.text}\n`);
}
