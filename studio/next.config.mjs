/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The guide/index pages are React ports of the Jinja templates and use a few
  // plain <img>/inline-HTML patterns on purpose; don't fail the build on lint.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
