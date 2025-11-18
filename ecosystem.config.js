module.exports = {
  apps: [
    {
      name: 'solar-admin-dashboard',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      cwd: '/home/ubuntu/solar-admin-dashboard',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_ENV: 'dev',
      },
      env_production: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_ENV: 'prod',
      },
    },
  ],
};
