'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('app.js', 'utf8');
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  fetch: async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }),
  Blob: function Blob(){},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  window: { addEventListener: () => {}, BDShowGenerator: { TEAM_DISPLAY: {} }, navigator: { serviceWorker: { register: () => {} } } },
  navigator: { serviceWorker: { register: () => {} } },
  document: {
    getElementById: () => ({ textContent:'', firstChild:null, removeChild:()=>{}, appendChild:()=>{}, style:{}, classList:{toggle:()=>{}}, setAttribute:()=>{}, addEventListener:()=>{}, querySelectorAll:()=>[] }),
    querySelectorAll: () => [],
    createElement: () => ({ appendChild: () => {}, setAttribute: () => {}, style: {}, classList: { add: () => {}, remove: () => {} } }),
    body: { appendChild: () => {}, removeChild: () => {}, classList: { add: () => {}, remove: () => {} } },
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { parseStandingsNote, parseProbableNote, parseTransactionNote, partitionStructuredLeague } = sandbox.module.exports;

assert.deepStrictEqual(parseStandingsNote('Standings: Yankees: 23-11 (PCT .676, GB -) [Division]').team, 'Yankees');
assert.deepStrictEqual(parseProbableNote('Probable: Boston Red Sox (Payton Tolle) @ Detroit Tigers (Tarik Skubal) — Scheduled 2026-05-04T22:40:00Z Comerica Park').homeTeam, 'Detroit Tigers');
assert.deepStrictEqual(parseTransactionNote('League tx: 2026-04-27: New York Mets signed free agent LF Austin Slater.').date, '2026-04-27');
const p = partitionStructuredLeague({ league: { verified_notes: ['Standings: Tigers: 17-17 (PCT .500, GB 0.5) [Division]'], transactions: ['League tx: 2026-04-27: Foo.'] } });
assert.strictEqual(p.standings.length, 1);
assert.strictEqual(p.transactions.length, 1);
console.log('app helper tests passed');
