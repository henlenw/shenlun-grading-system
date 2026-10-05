export default {
  poweredByHeader:false,
  async rewrites(){return [{source:'/api/:path*',destination:`${process.env.API_PROXY_URL || 'http://127.0.0.1:4000'}/api/:path*`}];},
  async headers(){return [{source:'/:path*',headers:[{key:'X-Frame-Options',value:'DENY'},{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'}]}];}
};
