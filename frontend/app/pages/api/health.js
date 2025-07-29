// Health check API endpoint for ALB health checks
// frontend/app/pages/api/health.js

export default function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'cosine-frontend',
      version: process.env.npm_package_version || '1.0.0'
    });
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
