#!/usr/bin/env node
// Validates the bundled trivia bank (data/trivia/questions.json).
//
// This is the landing gate for every trivia batch. It is intentionally STRICTER
// than the runtime validator (isValidQuestion in src/trivia.ts): the runtime only
// needs options.length >= 2 and ignores id/sport/difficulty, but the shipped bank
// must be exactly 4 options, a known sport, an integer difficulty 1..5, and a
// non-empty globally-unique id — so a malformed-but-loadable row can never ship.
//
// It accepts BOTH the bare-array and the wrapped { version, questions } forms;
// the loader (src/trivia.ts loadBundled) must accept the same two forms — keep
// them in lockstep.
//
// Usage:
//   node scripts/validate-trivia.mjs [path]            # default: data/trivia/questions.json
//   node scripts/validate-trivia.mjs [path] --targets  # also check per-sport/per-difficulty target counts
//
// Exits 0 on success; non-zero (naming the first offending id) on any failure.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SPORTS = ['Fighting', 'Soccer', 'Hockey', 'Basketball', 'Golf', 'Baseball', 'Football'];

// PLAN-V2 §1a target tables (final column). Only checked with --targets.
const SPORT_TARGETS = {
  Fighting: 293, Soccer: 293, Hockey: 287, Basketball: 287,
  Golf: 282, Baseball: 282, Football: 276,
};
const DIFFICULTY_TARGETS = { 1: 458, 2: 610, 3: 639, 4: 205, 5: 88 };

const args = process.argv.slice(2);
const checkTargets = args.includes('--targets');
const pathArg = args.find((a) => !a.startsWith('--')) ?? 'data/trivia/questions.json';
const filePath = resolve(process.cwd(), pathArg);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(filePath, 'utf8');
} catch (err) {
  fail(`cannot read ${filePath}: ${err.message}`);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  fail(`invalid JSON in ${filePath}: ${err.message}`);
}

// Accept both the bare array and the wrapped { version, questions } form.
let questions;
if (Array.isArray(parsed)) {
  questions = parsed;
} else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
  questions = parsed.questions;
} else {
  fail('top-level value must be an array or { version, questions: [...] }');
}

if (questions.length === 0) {
  fail('bank is empty (no questions)');
}

const seenIds = new Set();
questions.forEach((q, i) => {
  const id = typeof q?.id === 'string' && q.id.length > 0 ? q.id : `<row ${i} has no valid id>`;

  // Runtime predicate parity (isValidQuestion, src/trivia.ts).
  if (typeof q?.prompt !== 'string') fail(`${id}: prompt must be a string`);
  if (!Array.isArray(q.options)) fail(`${id}: options must be an array`);
  if (!q.options.every((o) => typeof o === 'string')) fail(`${id}: every option must be a string`);
  if (typeof q.correct_index !== 'number') fail(`${id}: correct_index must be a number`);
  if (q.correct_index < 0 || q.correct_index >= q.options.length) {
    fail(`${id}: correct_index ${q.correct_index} out of range for ${q.options.length} options`);
  }

  // Stricter bundled invariants the runtime does NOT enforce.
  if (typeof q.id !== 'string' || q.id.length === 0) fail(`row ${i}: id must be a non-empty string`);
  if (seenIds.has(q.id)) fail(`${q.id}: duplicate id`);
  seenIds.add(q.id);
  if (q.options.length !== 4) fail(`${id}: expected exactly 4 options, got ${q.options.length}`);
  if (!SPORTS.includes(q.sport)) fail(`${id}: sport "${q.sport}" not in ${SPORTS.join('|')}`);
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) {
    fail(`${id}: difficulty must be an integer 1..5, got ${q.difficulty}`);
  }
});

// Tallies.
const bySport = Object.fromEntries(SPORTS.map((s) => [s, 0]));
const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const q of questions) {
  bySport[q.sport]++;
  byDifficulty[q.difficulty]++;
}

console.log(`✓ ${questions.length} questions valid in ${pathArg}`);
console.log('\n  Per sport:');
for (const s of SPORTS) console.log(`    ${s.padEnd(12)} ${bySport[s]}`);
console.log('\n  Per difficulty:');
for (const d of [1, 2, 3, 4, 5]) console.log(`    ${d}  ${byDifficulty[d]}`);

if (checkTargets) {
  let missed = false;
  console.log('\n  Target check (--targets):');
  for (const s of SPORTS) {
    const got = bySport[s];
    const want = SPORT_TARGETS[s];
    if (got !== want) {
      missed = true;
      console.log(`    sport ${s}: ${got}/${want}  (${got - want >= 0 ? '+' : ''}${got - want})`);
    }
  }
  for (const d of [1, 2, 3, 4, 5]) {
    const got = byDifficulty[d];
    const want = DIFFICULTY_TARGETS[d];
    if (got !== want) {
      missed = true;
      console.log(`    difficulty ${d}: ${got}/${want}  (${got - want >= 0 ? '+' : ''}${got - want})`);
    }
  }
  if (missed) fail('one or more per-sport/per-difficulty targets not met');
  console.log('    all targets met');
}
