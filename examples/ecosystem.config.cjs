module.exports = {
  apps: [
    {
      name: 'pm2-web-logger',
      script: 'dist/cli.js',
      cwd: '/srv/pm2-web-logger',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
