/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app lives in a subdir with sibling projects that also have lockfiles;
  // pin the tracing root to this app so Vercel bundles the right files.
  outputFileTracingRoot: import.meta.dirname,
  // Send the old Vercel URL to the canonical custom domain (preserves path + query).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "call-ready.vercel.app" }],
        destination: "https://callready.ng/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
