import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';
import critical from './vitest.critical-components.config';

// The main Vitest pass already executes the critical-component tests. Collect
// their coverage here; the later gate reads this report without executing again.
export default mergeConfig(base, defineConfig({ test: { coverage: critical.test?.coverage } }));
