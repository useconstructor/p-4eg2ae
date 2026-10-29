import type { NextConfig } from 'next';
const nextConfig:NextConfig={async headers(){return [{source:'/:path*',headers:[{key:'Referrer-Policy',value:'strict-origin'}]}]}};
export default nextConfig;
