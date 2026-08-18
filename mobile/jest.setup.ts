jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Link: 'Link',
  Redirect: 'Redirect',
}));
