import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/apps/dashboard', { recursive:true });
mkdirSync('dist/benchmarks', { recursive:true });
cpSync('apps/dashboard/public', 'dist/apps/dashboard/public', { recursive:true, force:true });
cpSync('benchmarks/fixtures', 'dist/benchmarks/fixtures', { recursive:true, force:true });
