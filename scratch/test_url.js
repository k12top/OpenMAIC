const { SDK } = require('casdoor-nodejs-sdk');

const config = {
  endpoint: 'http://localhost:8000',
  clientId: 'abc',
  clientSecret: '123',
  certificate: '...',
  orgName: 'built-in',
  appName: 'openmaic',
};

const sdk = new SDK(config);
const redirectUri = 'http://localhost:3000/api/auth/callback';
const signinUrl = sdk.getSignInUrl(redirectUri);

console.log('Original URL:', signinUrl);

const returnUrl = 'http://localhost:3000/soo?content=hello';
const newUrl = signinUrl.replace(`state=${config.appName}`, `state=${encodeURIComponent(returnUrl)}`);

console.log('Modified URL:', newUrl);
