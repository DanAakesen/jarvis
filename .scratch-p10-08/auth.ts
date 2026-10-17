const account = { homeAccountId: 'fixture-account', localAccountId: 'fixture-account' };
export const isSignInRedirectPending = () => false;
export const createAuthClient = () => ({
  initialize: async () => {},
  getActiveAccount: () => account,
  getAllAccounts: () => [account],
  acquireTokenSilent: async () => ({ accessToken: 'synthetic-browser-fixture' }),
});
export const restoreProfile = async () => ({ name: 'Browser fixture' });
export const signIn = async () => {};
