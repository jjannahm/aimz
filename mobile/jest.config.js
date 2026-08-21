module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // React Native's Haste module resolver (via @react-native/jest-preset) opens
  // a real macOS FSEvents/kqueue watcher while building its module map, and
  // never closes it, even for a single, one-shot run with no --watch flag.
  // That handle is invisible to Node's own introspection
  // (process._getActiveHandles(), process.report.getReport()) but very real
  // to the OS (confirmed via lsof: open KQUEUE fds plus the fsevents native
  // addon loaded), and it keeps the process alive for a fixed ~300s after
  // every test run, both locally and in CI. It is outside this project's
  // code, so force the process to exit once Jest has actually collected and
  // reported all results.
  forceExit: true,
};
