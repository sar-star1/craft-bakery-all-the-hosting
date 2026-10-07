/** @type {import('next').NextConfig} */
const nextConfig = {
  // Campaign attachments are uploaded through a server action; Vercel caps a
  // request body at 4.5 MB, so stay just under it.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
