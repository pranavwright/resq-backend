/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

const indexRoute = (fastify, options, done) => {
    fastify.get('/', (req, reply) => {
        try {
            reply.status(200).send({ message: "Hello World" })
        } catch (error) {
            console.log("Error In Index Route", error);
            reply.status(500).send({ message: "Internal Server Error" })
        }
    })
    done();
}
export default indexRoute;