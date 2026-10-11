import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The replay page reads demo-evidence/ with fs at request time. Next can't see that through
  // process.cwd(), so tell it to ship the folder with the page's serverless function (Vercel).
  outputFileTracingIncludes: {
    "/": ["./demo-evidence/**/*"],
  },
};

export default nextConfig;
