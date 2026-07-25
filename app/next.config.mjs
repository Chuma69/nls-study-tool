/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app lives in a subdir with sibling projects that also have lockfiles;
  // pin the tracing root to this app so Vercel bundles the right files.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
