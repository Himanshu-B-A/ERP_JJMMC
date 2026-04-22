// Vercel serverless entry point.
// Re-exports the Express app so Vercel's @vercel/node runtime can handle requests.
module.exports = require('../server.js');
