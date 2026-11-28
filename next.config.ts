import type { NextConfig } from "next";

// 社内業務システムのため全画面がユーザー依存の動的データ。
// Cache Components は使わず、従来の動的レンダリングで運用する（docs/02 参照）。
const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
