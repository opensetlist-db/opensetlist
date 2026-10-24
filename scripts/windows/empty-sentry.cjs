// PowerShell 5.1 removes an environment variable when assigned ''. Set the
// actual empty strings inside Node before Next/npm can load any dotenv file.
for (const name of ['SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN']) {
  process.env[name] = '';
}
