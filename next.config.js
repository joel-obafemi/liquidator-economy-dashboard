/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["@neondatabase/serverless"],
  },
}

module.exports = nextConfig
