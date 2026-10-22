// Extends app.json. google-services.json (Firebase's Android client config)
// stays out of git: EAS builds get it from the secret file variable
// GOOGLE_SERVICES_JSON (all three environments), local builds from the
// untracked file at the path app.json names.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile,
  },
});
