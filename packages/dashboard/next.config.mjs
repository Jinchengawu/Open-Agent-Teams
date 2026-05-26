/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_FRONTEND_AGENT_URL: process.env.NEXT_PUBLIC_FRONTEND_AGENT_URL || 'http://localhost:8201',
    NEXT_PUBLIC_BACKEND_AGENT_URL: process.env.NEXT_PUBLIC_BACKEND_AGENT_URL || 'http://localhost:8202',
    NEXT_PUBLIC_TESTING_AGENT_URL: process.env.NEXT_PUBLIC_TESTING_AGENT_URL || 'http://localhost:8203',
    NEXT_PUBLIC_DEVOPS_AGENT_URL: process.env.NEXT_PUBLIC_DEVOPS_AGENT_URL || 'http://localhost:8204',
    NEXT_PUBLIC_PM_AGENT_URL: process.env.NEXT_PUBLIC_PM_AGENT_URL || 'http://localhost:8205',
    SKILLS_DIR: process.env.SKILLS_DIR || '',
  },
};

export default nextConfig;
