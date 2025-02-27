/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

const authRoute = (fastify, options, done) => {
    fastify.get('/login', (req, replay) => {
        try {
            replay.status(200).send({ message: "Auth Route" })
        } catch (error) {
            console.log("Error In Auth Route", error);
            replay.status(500).send({ message: "Internal Server Error" })
        }
    })

    done();
}
export default authRoute;