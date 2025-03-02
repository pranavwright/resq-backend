/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

const routes = [
    '/',
    '/otp',
    '/contact',
    // ... other routes
  ];

const indexRoute = (fastify, options, done) => {
    fastify.get('/', (req, reply) => {
        try {
            reply.status(200).send({ message: "Hello World" })
        } catch (error) {
            console.log("Error In Index Route", error);
            reply.status(500).send({ message: "Internal Server Error" })
        }
    })
 
      
      fastify.get('/sitemap.xml', async (req, res) => {
        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            ${routes
              .map(
                (route) => `
              <url>
                <loc>https://www.realsq.tech${route}</loc>
                <lastmod>${new Date().toISOString()}</lastmod>
              </url>
            `
              )
              .join('')}
          </urlset>`;
      
        res.header('Content-Type', 'application/xml');
        res.send(sitemap);
      });
    done();
}
export default indexRoute;