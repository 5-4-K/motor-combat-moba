// SCAFFOLDING (phases 1-2): removed in phase 3, when cfg() starts throwing.
//
// The shared test suite imports individual modules under src/ directly, not the package's built
// `index.ts` entry point, so index.ts's side-effect import of `modes/registry.js` never runs for a
// test unless something in that test's own import graph happens to reach it. This setup file makes
// the default mode bundle install unconditionally, once, before any test runs, so `cfg()` never
// throws in a suite that has nothing to do with per-mode config.
import "./src/modes/registry.js";
