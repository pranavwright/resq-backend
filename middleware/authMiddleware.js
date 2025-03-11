import jwt from 'jsonwebtoken';

export const authenticatedUser = async (fastify, req, reply) => {
    try {
        const auth = req.headers.authorization;
        if (!auth) {
            throw new Error('Please add token');
        }

        const idToken = auth.split(' ')[1];
        const decodedToken = jwt.decode(idToken);

        if (!decodedToken || !decodedToken.phoneNumber || !decodedToken._id) {
            throw new Error('Invalid token');
        }

        const { phoneNumber, _id } = decodedToken;
        const user = await fastify.mongo.db.collection('users').findOne({ _id });
        
        if (!user) {
            throw new Error('User not found');
        }

        let returnParam = req.body ?? {};
        if (req.method === 'GET' || req.method === 'DELETE') {
            returnParam = req.query;
        }

        returnParam.uid = user._id;

        return user;
    } catch (error) {
        return reply.status(401).send({ message: error.message || 'You are not authorized' });
    }
};

export const isUserAllowed = async (fastify, req, reply, allowedRoles) => {
    try {
        const user = await authenticatedUser(fastify, req, reply);

        if (!user) {
            throw new Error('User not found');
        }

        if (!allowedRoles.includes(user.roles)) {
            throw new Error('User not allowed');
        }

        return;
    } catch (error) {
        return reply.status(401).send({ message: error.message || 'You are not authorized' });
    }
};
