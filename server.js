import fastifyCors from '@fastify/cors';
import AutoLoad from '@fastify/autoload';
import Fastify from 'fastify';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MONGODB_URL } from './configs/index.js';
import FastifyMongoDB from '@fastify/mongodb';
import 'dotenv/config'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({ logger: true });
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '::';


fastify.register(AutoLoad, {
  dir: join(__dirname, 'app'),
  routeParams: true,
});

fastify.register(fastifyCors, {
  origin: '*',
});

fastify.register(FastifyMongoDB, {
	forceClose: true,
	url: MONGODB_URL,
});

// Run the server!
fastify.listen({ port: PORT, host: HOST }).then(address => {
  console.log(`Server listening at ${address}`);
}).catch(err => {
  fastify.log.error(err);
  process.exit(1);
});